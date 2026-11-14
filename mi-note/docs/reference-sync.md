# mi-note-cli 双向同步算法 —— 工程规格（供重实现）

> 依据：`ceynri/mi-note-cli` 主分支（2026-11-13 抓取）：`src/sync.ts`（执行层）、`src/sync-diff.ts`（纯函数决策层）、`src/config.ts`（状态读写）、`src/converter.ts`（落盘路径/转换）、`src/utils.ts`（文件名清洗）、`src/types.ts`（结构）、`src/commands/sync.ts`（CLI/交互）、`tests/sync.test.ts`、`tests/sync-diff.test.ts`。标注「未确认」的点不要当成已知行为实现。

## 0. 总览

一次 sync = **构建计划（纯读）** → **逐条执行（写）**。

```text
buildSyncPlan(client, outputDir, mode):
  state = loadState(outputDir)                  # output 内 .mi-note-cli.state.json
  stateChanged = dedupeStatePaths(state)        # 修复历史重复映射
  {entries, folders} = client.getAllNotes(200)  # 云端全量列表，分页 200
  for id in (云端 entries 的 id ∪ Object.keys(state.notes)):
      读本地文件（若 filePath 存在）→ localHash
      if remote.modifyDate == base.remoteModify and localHash == base.localHash: continue   # 免拉详情
      getNote(id) → parseNoteEntry → xmlToMarkdown → remoteHash（仅在可能变化时）
      认领（无基线时把已存在的同名本地文件绑定为该笔记，见 C.5）
      scenario = classify({baseHash, remoteHash, localHash});  action = decide(scenario, mode)
  扫描未跟踪 .md → 追加 local-new 项（id = "local:<绝对路径>"）
  return {plan, state, folders, stateChanged}

executeSyncPlan(...): for item of plan（串行、顺序执行）
  conflict → 有 resolver 则询问，否则计入 conflicts 并跳过（不改数据）
  dryRun   → 只计数
  否则 applyAction(...)；每满 SAVE_INTERVAL=10 条落盘 state；结束时落盘（lastSync=now）
```
计划阶段绝不写云端/本地/state；state 只在内存中被认领与去重修正，由调用方决定是否落盘。

## A. 状态文件

### A.1 位置

| 项 | 值 |
|---|---|
| 文件名 | `.mi-note-cli.state.json` |
| 位置 | **output 目录内部**：`getStatePath(outputDir) = join(outputDir, STATE_FILENAME)` |
| 绑定 | 与 output 目录 1:1；换 output 各自独立；不入版控 |
| 勿混淆 | 用户配置在 `<项目根>/.mi-note-cli/config.json`（`syncMode` / `output` / `fileNameTemplate`），`MI_NOTE_CLI_CONFIG_DIR` 可覆盖项目根 |

`filePath` 存相对 output 的路径，因此 **output 目录可整体搬迁后继续同步**。

### A.2 结构与字段

```ts
interface SyncState {
  lastSync: number | null;              // 上次同步完成时间戳(ms)，从未同步为 null
  syncTag?: string;                     // 保留字段，源码注释：目前未使用
  notes: Record<string, SyncNoteState>; // 键 = 笔记 id 字符串
  folders: Record<string, never>;       // 空容器（泛型参数在抓取文本中被转义，未逐字确认；源码无写入点，见 A.6）
}
interface SyncNoteState {
  id: string;              // 笔记 id（与键冗余）
  subject: string;         // 上次已知标题（已 sanitize），只用于报告，不参与决策
  filePath: string | null; // 相对 output 的路径，如 "工作/周报.md"；null=无本地文件
  folderId?: string;       // 上次已知云端文件夹 id（供本地同目录新文件建回同一文件夹）
  baseHash?: string;       // 上次同步成功时的正文哈希 = 三方比较的 base
  localHash?: string;      // 上次同步时的本地哈希（判断本地是否改动）
  remoteModify?: number;   // 上次同步时云端 modifyDate（免拉详情的快速判据）
  empty?: boolean;         // 声明存在，sync 从不写入（仅 export 缓存用）
}
```

### A.3 形状样例（`saveState` = `JSON.stringify(state, null, 2)`；哈希值为示例）

```json
{
  "lastSync": 1763000000000,
  "notes": {
    "4821937461": { "id": "4821937461", "subject": "周报", "filePath": "工作/周报.md", "folderId": "f1", "baseHash": "b7c3f0a9d2e1456c8b0a17f3e5d94c2a6f80b1d3e7c495a2b6d8f0e1c3a57b9d", "localHash": "b7c3f0a9d2e1456c8b0a17f3e5d94c2a6f80b1d3e7c495a2b6d8f0e1c3a57b9d", "remoteModify": 1762999900000 },
    "4821937462": { "id": "4821937462", "subject": "读书笔记", "filePath": null, "folderId": "0", "baseHash": "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f809", "localHash": "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f809", "remoteModify": 1762980000000 }
  },
  "folders": {}
}
```
字段顺序 = 对象插入顺序（`lastSync` → `syncTag?` → `notes` → `folders`；每笔记 `{id, subject, filePath, folderId, baseHash, localHash, remoteModify}`），读取时不依赖顺序。

### A.4 基线正文：**不存在**

原实现**不保存「上次同步时的正文副本」**，没有影子目录、`*.base.md` 或三方合并文件；基线只有 `baseHash`（+ `localHash` / `remoteModify` 做快速短路）。由此必须遵守：

1. 三方比较在**哈希空间**完成；无 base 文本 ⇒ **不做行级三方合并**（`diffLines` 仅用于给用户看冲突差异）。
2. 冲突解决只能「整篇选一侧」（`actionForSide`），无自动 merge。
3. 基线更新只有这些时机：下行 `update-local`/`create-local` 成功 → `baseHash = localHash = computeHash(remoteMarkdown)`、`remoteModify = item.remote.modifyDate`；上行 `update-remote` 成功 → `baseHash = localHash = computeHash(item.localMarkdown)`、`remoteModify = updated.modifyDate`；`create-remote` 成功 → 同上，`remoteModify = created.modifyDate`；以及认领且两侧已一致时的隐式建基线（C.5）。
4. 因此**没有「基线文件命名规则」可给**；需要正文副本的实现属于偏离，须自定义命名与清理。

### A.5 哈希：算法与输入

```ts
computeHash(content) = createHash("sha256").update(content, "utf-8").digest("hex")  // 64 位小写 hex
```
- 本地输入：`readFile(filePath, "utf-8")` 的**原始字符串，不做任何归一化**（不 trim、不统一换行、不压缩空行）。
- 云端输入：`xmlToMarkdown(note.content, note.files, assetPrefixFor(desired, outputDir))` 的结果（已转 Markdown、附件引用已按目标位置改写）。
- 可直接比较：下行写盘用的就是同一个 `remoteMarkdown` 字符串（`writeFile(filePath, item.remoteMarkdown, "utf-8")`），回读哈希一致。
- **换行敏感**：本地被改成 CRLF → 哈希必变 → 判为「本地改」，无防护。
- **哈希依赖路径**：`assetPrefixFor(filePath, outputDir) = relative(dirname(filePath), join(outputDir,"assets"))`，分隔符归一为 `/` 并追加 `/`（根目录 `assets/`，一级子目录 `../assets/`）。换目录层级会改变 remoteHash ⇒ 判为 `remote-changed`。
- **转换器即规格**：Markdown↔XML 不无损时 round-trip 改变哈希 ⇒ 被判单边改动并触发覆盖（README 明确警告）。

### A.6 读写与容错

- `loadState`：文件缺失/JSON 解析失败 → 空壳 `{lastSync:null, notes:{}, folders:{}}`，不抛错、不备份、不迁移。
- `saveState`：`ensureFileDir` 后整文件 `JSON.stringify(state, null, 2)` 覆盖写，**非原子**、无备份。
- 落盘节奏：每处理 10 条一次（同时刷新 `lastSync`）；结束再落一次（`lastSync = Date.now()`）；`dryRun` 完全不落盘。
- 计划为空但 `stateChanged` 为真（认领/去重修正）时，命令层仍 `saveState`。
- `state.folders` 会被读出但**已读源码无写入点**；`buildSyncPlan` 返回的 `folders` 来自实时 `getAllNotes`。→ 未确认是否有其它命令写入，重实现可视为恒 `{}`。

## B. 决策矩阵

### B.1 三方输入

```ts
interface ThreeWayInput { baseHash?: string; remoteHash?: string; localHash?: string }
// undefined 分别表示：上次同步时不存在 / 云端不存在 / 本地不存在
```

### B.2 判定顺序（严格照此，`classify` 原样）

```text
if not hasBase:                                    # 本次新建立的关系
    if hasRemote and not hasLocal: "remote-new"    # 5
    if not hasRemote and hasLocal: "local-new"     # 6
    if both: (remoteHash == localHash) ? "in-sync" : "both-changed"
    return "in-sync"                               # 三方皆无，不可达

remoteChanged = hasRemote and remoteHash != baseHash
localChanged  = hasLocal  and localHash  != baseHash

if not hasRemote and not hasLocal: "both-deleted"                      # 11
if not hasRemote and hasLocal:     localChanged ? "remote-deleted-local-changed"  # 8
                                               : "remote-deleted-local-clean"     # 7
if hasRemote and not hasLocal:     remoteChanged ? "local-deleted-remote-changed" # 10
                                                : "local-deleted-remote-clean"    # 9

if not remoteChanged and not localChanged: "in-sync"        # 1
if remoteChanged and not localChanged:     "remote-changed" # 2
if not remoteChanged and localChanged:     "local-changed"  # 3
return (remoteHash == localHash) ? "in-sync" : "both-changed"   # 4 两边改成一样 → 已同步
```
顺序陷阱：**先判「是否存在」、再判「是否变化」**；删除分支里另一半的「改过没有」是**相对 base**，不是相对当前。

### B.3 场景 × 模式 → 动作

| # | scenario | cloud-first | local-first | two-way | manual |
|---|---|---|---|---|---|
| 1 | `in-sync` | skip | skip | skip | skip |
| 2 | `remote-changed` | update-local | skip | update-local | **update-local** |
| 3 | `local-changed` | skip | update-remote | update-remote | conflict |
| 4 | `both-changed` | update-local | update-remote | conflict | conflict |
| 5 | `remote-new` | create-local | skip | create-local | create-local |
| 6 | `local-new` | skip | create-remote | create-remote | conflict |
| 7 | `remote-deleted-local-clean` | delete-local | **create-remote** | delete-local | conflict |
| 8 | `remote-deleted-local-changed` | delete-local | create-remote | conflict | conflict |
| 9 | `local-deleted-remote-clean` | **create-local** | delete-remote | delete-remote | conflict |
| 10 | `local-deleted-remote-changed` | update-local | delete-remote | conflict | conflict |
| 11 | `both-deleted` | drop-state | drop-state | drop-state | drop-state |

该表逐格被 `tests/sync-diff.test.ts` 的 `EXPECT` × `ALL_MODES` 循环断言固化，是行为规格权威。三个反直觉点：**`remote-changed` 在 `manual` 下也自动 `update-local`**（`decide` 只对 `local-first` 特判）⇒ manual ≠ 全问，只有 7 个场景会问；`local-first` 对 `remote-changed` 是 `skip`（不动作），不是「保留本地并记录差异」；`cloud-first` **永不上行**，测试有性质断言遍历全场景不产出 `update-remote`/`create-remote`/`delete-remote`。

```ts
decide(scenario, mode):
  in-sync → skip
  remote-changed → (mode=="local-first") ? skip : update-local
  local-changed  → (local-first||two-way) ? update-remote : (manual ? conflict : skip)
  remote-new     → (local-first) ? skip : create-local
  local-new      → (local-first||two-way) ? create-remote : (manual ? conflict : skip)
  remote-deleted-local-clean → local-first ? create-remote : (manual ? conflict : delete-local)
  local-deleted-remote-clean → cloud-first ? create-local : (manual ? conflict : delete-remote)
  both-deleted → drop-state
  both-changed / remote-deleted-local-changed / local-deleted-remote-changed → resolveConflict(mode)
  default → skip

resolveConflict(mode): cloud-first→actionForSide(scenario,"remote"); local-first→actionForSide(scenario,"local");
                       two-way|manual→conflict
```
「以某侧为准」映射（`actionForSide`，交互冲突界面复用）：

```ts
LOCAL_WINS  = { local-changed: update-remote, both-changed: update-remote, local-new: create-remote,
                remote-deleted-local-clean: create-remote, remote-deleted-local-changed: create-remote,
                local-deleted-remote-clean: delete-remote, local-deleted-remote-changed: delete-remote }
REMOTE_WINS = { remote-changed: update-local, both-changed: update-local, remote-new: create-local,
                local-deleted-remote-clean: create-local, local-deleted-remote-changed: update-local,
                remote-deleted-local-clean: delete-local, remote-deleted-local-changed: delete-local }
// 查不到 → "skip"（如 local-new「以云为准」不删本地，仅不上传）
```

### B.4 结果对象

```ts
interface SyncPlanItem { id: string;                    // 云端 id；本地新增为 "local:<绝对路径>"
  subject: string; scenario: Scenario; action: SyncAction;
  remote?: RawNoteEntry;      // 云端原始 entry（含 tag / modifyDate）
  filePath: string | null;    // 绝对路径
  localMarkdown?: string; remoteMarkdown?: string }   // 已改写附件前缀的云端正文
interface SyncResult { total: number;
  applied: Record<SyncAction, number>;   // 键初始化为全 9 个 action，值从 0 起
  conflicts: SyncPlanItem[];             // 未解决的冲突（数据未改动）
  errors: SyncError[];                   // 失败 + 「已生效但有告警」
  outputDir: string; mode: SyncMode; dryRun: boolean }
interface SyncError { id: string; subject: string; action: SyncAction; error: string }
// SyncAction 9 值：skip|update-local|update-remote|create-local|create-remote|delete-local|delete-remote|drop-state|conflict
```

### B.5 冲突时保留什么、展示什么

- **数据**：`action === "conflict"` 且无 resolver ⇒ 该条**完全不写**：不写本地、不写云端、不动 `state.notes[id]`。测试断言 `creates + updates === 0` 且本地内容不变。
- **展示**：逐条打印 `[id] subject — <场景中文> → <动作中文>`；场景文案只有 7 条映射（`both-changed` / `remote-deleted-local-changed` / `local-deleted-remote-changed` / `local-changed` / `local-new` / `remote-deleted-local-clean` / `local-deleted-remote-clean`），未命中者回落原始字符串。
- **交互**（仅当 `!isJsonMode() && stdout.isTTY && !--yes` 时构造 resolver）：`l`→`actionForSide(scenario,"local")`（如「用本地内容覆盖云端笔记」）；`r`→以云为准（如「把云端笔记移到回收站」）；`d`→`formatDiff(diffLines(remoteMarkdown, localMarkdown))`，头 `--- 云端 / +++ 本地`，一侧缺失则改印「（云端不存在，本地内容如下）」+原文；`s`/其它/空→`skip`。
- **非交互**：跳过并提示「可在交互式终端重跑 sync 逐条处理，或指定 --mode 决定优先方」；**冲突本身不改退出码**（仅 `errors.length > 0` 置部分失败码）。`--dry-run` 只打印计划、`applied` 只计数、不接触数据。

## C. 路径与身份

### C.1 落盘路径

```ts
getNoteFilePath(note, folders, outputDir, template?):
  folderName = note.folderId ? sanitizeFileName(folders[note.folderId]?.subject ?? "") : ""
  baseName   = template?.trim() ? renderFileNameTemplate(template, note) : note.subject
  return folderName ? join(outputDir, folderName, `${baseName}.md`) : join(outputDir, `${baseName}.md`)
```
- 层级**只有一层**：云端 folder → output 一级子目录（文件夹嵌套不在同步里展开）。
- `note.subject` 来源链（`deriveTitle`）：`extraInfo.title` → 笔记 `subject` → 正文首行（`xmlToMarkdown(snippet ?? content)` 首个非空行）→ `formatDateTime(createDate || now)`；再 `sanitizeFileName`。
- `fileNameTemplate`（可选）：`${YYYY} ${YY} ${MM} ${DD} ${HH} ${mm} ${ss} ${title} ${subject} ${id}`，时间取 `createDate` 本地时区；`[...]` 条件段「内部所有 `${var}` 非空才渲染」；`${title}` 是**未 sanitize 的真实标题，无标题为空串**（不回退正文首行），`${subject}` 永非空；渲染为空则回退 `formatDateTime(ts)`；模板不产目录（`/` 被清洗成 `_`）。
- 附件目录固定 `join(outputDir,"assets")`，引用前缀按 A.5 计算。

### C.2 文件名清洗（`sanitizeFileName`，逐条精确）

```text
1) < > : " / \ | ? * 与 \x00-\x1f → "_"     2) 连续空白 \s+ → 单个空格     3) trim
4) 去掉开头连续点 /^\.+/                     5) 去掉结尾 "." 或空白 /[.\s]+$/
6) trim，slice(0, 200)
```
源码未处理（属实现缺口，重实现需自行决定）：Windows 保留名（`CON`/`PRN`/`AUX`/`NUL`/`COM1`…）、Unicode NFC/NFD 归一、`slice(0,200)` 按 UTF-16 码元切可能劈开代理对。
**大小写**：`pathKey(p) = resolvePath(p)`，仅 `darwin`/`win32` 上 `.toLowerCase()`。所有路径相等比较（去重、认领、旧文件清理）都走 `pathKey`：Windows/macOS 上 `A.md` 与 `a.md` 同路径，Linux 区分。

### C.3 重名不覆盖

```ts
withIdSuffix(filePath, id) = `${去掉 .md 后缀的路径}_${id}.md`     // "购物清单" → "购物清单_2.md"
assignUniquePaths(items: {id, createDate?, desired}[]):
  按 pathKey(desired) 分组；组内按 (createDate ?? 0) 升序、再 id.localeCompare
  第 0 个保留 desired，其余 withIdSuffix(desired, id)
```
- `export` 用它且确定性：**同路径下创建最早者保留原名**。
- `sync` 不用它，用运行时 `claimFilePath(desired, item, state, outputDir)`：目标路径被其它笔记的 state 记录占用，或磁盘上已有该文件 → `withIdSuffix(desired, item.id)`。故 sync 里谁保留原名取决于**处理顺序**。
- 上行标题回退（`titleFromPath`）：仅当 `id` 不以 `local:` 开头、文件名以 `_<id>` 结尾且更长时剥掉后缀；否则用整段文件名；`trim()` 后空则 `"未命名"`。

### C.4 本地目录 → 云端文件夹（仅上行新建时）

```text
filePath 为 null → "0"；relative(outputDir, filePath) 段数 < 2 → "0"（根目录文件）
dirName = 第一段
1) 遍历 state.notes：某笔记 dirname(filePath) 的 pathKey 等于该目录，且其 folderId 在当前 folders 中存在 → 复用（← 云端改名后本地旧目录名仍能对上）
2) 遍历 folders：sanitizeFileName(folder.subject) === dirName → 复用
3) 都无 → client.createFolder(dirName)，塞进内存 folders，返回新 id
```
- **云端文件夹改名**：不重命名本地目录；下次下行 `getNoteFilePath` 用新名算新路径，写完新文件后按 `pathKey` 差异 `rm` 旧文件（本地跟着搬家）。上行时旧目录新文件仍回原 `folderId`（第 1 步），不会误建新文件夹（有专门测试）。
- **云端移动笔记**（`folderId` 变）：对单条只是路径变化 → `update-local` + 删旧文件。
- **本地移动/改名**：无「移动到云端文件夹」的动作；且会**断开身份**（见 C.5 第 2 条）：旧路径消失 → #9 删云端原件，新文件 → #6 `create-remote`（此时才用 `resolveFolderId` 决定归属）。已关联笔记的 `update-remote` 用 `folderId: current.folderId`（云端现值），**不会**因本地换目录而改云端文件夹。

### C.5 「改名/移动」如何识别为同一篇

**依据只有三条，无 inode / 文件 id / 内容指纹索引：**

1. **云端侧改名/移动靠 id**：笔记 id 不变 ⇒ 标题或 `folderId` 变化只是 `remote-changed`（`desired` 路径变 → 下行写新路径并删旧文件）。这是**唯一**能自动跟随改名/移动的情形。
2. **本地侧改名/移动不被识别**：身份绑定在 `state.notes[id].filePath`。用户改名或把文件移到别的目录后，旧路径 `fileExists` 失败 ⇒ `localHash = undefined` ⇒ 若云端未变则 `classify` 判为 #9 `local-deleted-remote-clean`（two-way 下 `delete-remote`，原件进回收站），同时新文件作为未跟踪文件判 `local-new` → `create-remote`。净效果：云端多一条新笔记（标题取自新文件名）、原件进回收站；附件会被重新上传（未确认 `uploadLocalImages` 对 `assets/` 下已存在文件的处理）。**因此本地改名/移动不是安全操作**，源码没有「按内容哈希反查身份」的兜底；仅当该路径无任何 id 关联（无基线）时，第 3 条的路径认领才会生效。
3. **无基线时按落盘位置认领**（`buildSyncPlan` claim 分支）：`state.notes[id]` 不存在、云端存在，且 `getNoteFilePath(...)` 算出的**期望路径**上已有文件、该路径未被任何笔记占用（`trackedPaths` 不含）时：

```text
filePath = desired; localMarkdown = readFile(desired); localHash = computeHash(localMarkdown)
if localHash != remoteHash and legacyHash() == localHash: baseHash = localHash   # 只差旧版附件前缀 → 视为仅云端变化
scenario = classify({baseHash, remoteHash, localHash})
if scenario == "in-sync":     # 含 localHash == remoteHash
    state.notes[id] = {id, subject, filePath: rel, folderId, baseHash: remoteHash,
                       localHash: remoteHash, remoteModify: remoteDetail.modifyDate}
    stateChanged = true       # plan 为空也要落盘基线
```
**无法唯一确定时**：`localHash == remoteHash` → 认领记基线（不重复上传）；不等 → `both-changed`/`conflict`，**不猜**（cloud-first 会 `update-local` 覆盖本地，local-first 会 `update-remote` 覆盖云端）。另由 `dedupeStatePaths` 先修：把 `state.notes` 中指向同一 `pathKey` 的多条记录分组，只保留 `baseHash === 当前文件哈希` 的那条，其余从 state 删除（随后按「云端新增」重新落盘，加 `_<id>` 后缀）；**全对不上则整组删除**，文件退回未跟踪文件，参与认领/冲突，不擅自归属。若期望路径已被**另一条**笔记占用 → 不认领，走 `_<id>` 兜底或 `create-local`。

### C.6 本地删除 vs 云端删除

| 情况 | 场景 | 动作 | 后果 |
|---|---|---|---|
| 本地文件消失、云端未变 | #9 | `delete-remote`（cloud-first 反向 `create-local`） | 云端**移入回收站**，非永久删除 |
| 本地文件消失、云端改过 | #10 | `conflict`（two-way/manual） | 不动数据 |
| 云端消失、本地未改 | #7 | `delete-local` | `rm -f` 本地文件 + 删 state 记录 |
| 云端消失、本地改过 | #8 | `conflict`（two-way/manual） | 不动数据 |
| 两侧都消失 | #11 | `drop-state` | 只删 state 记录 |
| local-first 下重建 | #7/#8 → `create-remote` | 新建云端笔记 | **id 变**：先 `delete state.notes[旧id]` 再以新 id 建记录 |

## D. 写入与安全

### D.1 顺序与单条内部步骤

- 计划阶段只读（`getAllNotes` → 逐条 `getNote` → 读本地），不写。
- 执行阶段**严格串行**、按 plan 顺序，下行与上行在同一循环交错——没有「先全推再全拉」，也没有并发。
- 下行（`update-local`/`create-local`）：`assertLocalUnchanged` → `claimFilePath` → `ensureFileDir` → `writeFile(remoteMarkdown)` → 更新 `state.notes[id]` → 路径变化则 `rm` 旧文件 → `downloadAttachments`（失败只记 error，不回滚正文）。
- 上行 `update-remote`：`assertLocalUnchanged` → `getNote(id)` → 比 `modifyDate` → `uploadLocalImages` → `markdownToXml` → `updateNote` → 写 `state.notes[id]`（用响应 `updated.modifyDate`）。
- 上行 `create-remote`：`assertLocalUnchanged` → `uploadLocalImages(new Map())` → `markdownToXml` → `resolveFolderId` → `createNote` → 删旧 id 记录 + 建新 id 记录。
- `delete-local`：`assertLocalUnchanged` → `rm(force)` → 删 state 记录。`delete-remote`：`client.deleteNote(id, item.remote.tag, false)`（`purge=false`）→ 删记录。`drop-state`：只删记录。

### D.2 原子替换：没有

`writeFile(filePath, content, "utf-8")` 直接覆盖（无 temp+rename、无 fsync），写前仅 `ensureFileDir`。中断可能留截断文件，下次同步会当「本地改动」→ 冲突或覆盖。改用 temp+rename 属**偏离**，须自定恢复策略。

### D.3 `tag` 乐观锁

`tag` **不持久化**（`SyncNoteState` 无 tag 字段），每次上行现取：

```text
current = client.getNote(id)                     # 最新 tag / status / colorId / folderId / setting / extraInfo
if item.remote.modifyDate !== undefined and current.modifyDate !== item.remote.modifyDate:
    throw "云端笔记在生成同步计划后又被修改，已跳过，请重新运行 sync"
entry = { id, tag: current.tag, status: current.status,
          createDate: current.createDate ?? now, modifyDate: now, colorId: current.colorId ?? 0,
          content: markdownToXml(...), setting: withAttachments(current.setting, uploaded),
          folderId: String(current.folderId ?? "0"), alertDate: current.alertDate ?? 0,
          extraInfo: 原样保留, subject: current.subject, snippet: extractSnippet(xml) }
updated = client.updateNote(id, entry)
state.notes[id].remoteModify = updated.modifyDate    # 下次的并发判据
```
跨进程一致性靠 **`modifyDate` 比对**（列表旧值 vs 刚拉到的值），不靠 tag 历史；tag 只在单次提交内用。`delete-remote` 用**列表 entry 的 tag**（`item.remote?.tag`，来自 `remoteDetail ?? remote`），缺 tag 抛 `云端笔记缺少 tag，无法删除`。`create-remote` 用同一个 `now = Date.now()` 作 `createDate` 与 `modifyDate`。

### D.4 过期计划的两道防护（均为单条粒度放弃）

1. 本地：`assertLocalUnchanged(item)` 重读盘，与 `item.localMarkdown` **严格不等**即抛「本地文件在生成同步计划后又被修改，已跳过，请重新运行 sync」。
2. 云端：`modifyDate` 比对不一致即抛「云端笔记在生成同步计划后又被修改」。

### D.5 结果不确定（超时/中断）如何核对

源码事实：`createNote` **无幂等键、无请求去重标记、无「创建中」占位**；失败只进 `errors`，state 不动 ⇒ 中断后云端可能已存在新笔记而本地不知情。实际的「事后核对」依赖下次运行的两个既有机制：

1. **落盘位置认领**（C.5）：中断的 `create-remote` 用的是 `getNoteFilePath` 的路径，文件仍在原处时会被当作「云端新增」认领（内容一致 → in-sync 并记基线），不重复创建——覆盖「同路径重跑」的常见情形。
2. **重名兜底**：认领不成立（同路径被占、或标题/模板/文件夹导致路径不同）会产生新的 `create-remote` ⇒ **可能重复**，测试未覆盖，源码无补救。

结论：**原实现没有可靠的超时幂等保证**。要保证须自行引入（如创建前记录「待验证创建」意图，再按标题/路径/内容哈希扫描云端）——属于新增设计。

### D.6 失败粒度

- 每条独立 `try/catch`：抛错记入 `errors`（`{id, subject, action, error}`），继续下一条；单篇失败不影响其它篇。
- **已生效但有告警**也进 `errors`（附件下载失败、图片无法还原等），此时 `applied[action]` 仍 +1；文案如 `附件下载失败：<文件名列表>（正文已写入）`。
- 附件失败**不回滚正文**（注释：一个坏附件不应让整篇笔记永远同步不下来）；正文与 state 已落。
- state 每 10 条落一次 ⇒ 中断最多丢 10 条状态更新（下次重跑据内容/`modifyDate` 重新判定，不会误删）。
- 退出码：`errors.length > 0` → 部分失败码（README 说明为 2；`--json` 下 `ok: true` + `data.errors`）；仅冲突不置失败码。

## E. 测试固化的回归场景

来自 `tests/sync.test.ts`（假客户端 + 临时目录，零网络）与 `tests/sync-diff.test.ts`。

1. **同名笔记下行不互相覆盖**：两条「购物清单」（「牛奶」「鸡蛋」）`cloud-first` 后目录 = `["购物清单.md","购物清单_2.md"]`，两笔记 `filePath` 不同；**再跑 `two-way` 计划长度 0**（不得把一条内容当另一条的本地改动上传）。
2. **export 产物上首次同步要认领**：先 `exportNotes` 再 `buildSyncPlan(two-way)` → `plan.length === 0`、`stateChanged === true`、`state.notes["1"].filePath === "周报.md"`、`creates.length === 0`。
3. **认领时内容不一致 → 冲突且不改数据**：本地改成「本周进展\n\n本地补充」后 `two-way` → `conflicts.length === 1`、`scenario === "both-changed"`、`creates + updates === 0`、本地内容不变。
4. **本地编辑带图笔记后上行，云端图片保留**：`updates.length === 1`，提交 XML 仍含原 fileId（`buildImageMap` 把 `assets/...` 还原为 fileId）。
5. **本地删除 → 云端只进回收站**：`client.deletes === [{id:"1", tag:"tag-1-1", purge:false}]`。
6. **子目录新文件建到同名云端文件夹，缺失自动创建**：`工作/a.md`→`folderId === "f1"`；`createdFolders === ["生活"]`，`生活/b.md` 落到新建文件夹。
7. **计划后云端又被改 → 放弃上行**：`buildSyncPlan` 后 `client.touch("1")` 再执行 → `updates.length === 0`、`errors.length === 1` 且匹配 `/云端/`。
8. **计划后本地又被改 → 不覆盖本地**：计划 action=`update-local`，写入「用户刚写的」再执行 → `errors.length === 1`，文件仍为「用户刚写的」。
9. **修复旧版同名笔记共用一个文件的状态**：两条记录都指向 `日记.md` → `updates.length === 0`（不得用 B 覆盖 A）、`applied["create-local"] === 1`、`日记.md` 仍「B 的内容」、`日记_A.md`「A 的内容」。
10. **local-first 下云删本地改 → 云端重建且旧记录移除**：`creates.length === 1`、`state.notes["1"] === undefined`、剩 1 条记录且 `filePath === "计划.md"`（新 id）。
11. **子目录附件前缀 `../assets/`，旧版 `assets/` 认领时不报冲突**：旧前缀写 `旅行/京都.md`，`buildSyncPlan` 只 1 项且 `scenario === "remote-changed"`（非 both-changed），同步后改写为 `../assets/<name>`，`errors.length === 0`。
12. **本地新增图片自动上传并登记**：新建 `pic.png` + `![](./pic.png)` → `uploads === ["pic.png"]`，XML 含上传返回值，`setting.data` 被写入。
13. **无法还原的附件使该条中止**：`![](./pic.png)`（文件不存在）+ `[🔊 a.mp3](assets/a.mp3)` → `errors.length === 1`、**`uploads === []`**（先校验后上传），其它笔记不受影响。
14. **本地新文件以文件名为云端标题**：`读书笔记.md`（内容 `# 第一章\n\n正文`）→ `JSON.parse(creates[0].extraInfo).title === "读书笔记"`（非首行标题）。
15. **云端文件夹改名后旧目录新文件仍建到原文件夹**：`f1`「工作」→「工作归档」，本地仍叫「工作」，新建 `新想法.md` → `createdFolders === []`、`creates[0].folderId === "f1"`。
16. **附件下载失败时正文照常同步**：`applied["create-local"] === 1`、`errors.length === 1` 匹配 `/附件下载失败/`、`旅行.md` 存在。
17. **export 增量**：未变笔记不拉详情（`getNoteCalls === []`、`skipped === 2`）；云端改动/本地被改/文件夹改名时重拉并刷新；`--force` 全量重拉；附件失败的笔记**不进缓存**，下次重试。
18. **export 同名减少后清理旧去重文件**：删一条后目录 `["会议.md","会议_10.md"]` → `["会议.md"]`，内容为保留那条（「第二次」）。
19. **decide 全表性质**：11 场景 × 4 模式逐格断言；`manual`/`two-way` 对 3 个真冲突必 `conflict`；`cloud-first` 永不产出 `update-remote`/`create-remote`/`delete-remote`。
20. **classify 边界**：#4 两边改成相同内容 → `in-sync`；无基线两端都有且相同 → `in-sync`，不同 → `both-changed`。

## F. 明确不做

1. **`cloud-first` 永不上行**：不产 `update-remote`/`create-remote`/`delete-remote`；`local-new` 与 `local-changed` 直接 `skip`（本地文件保留但永不同步）。
2. **`local-first` 永不下行**：`remote-changed`/`remote-new` → `skip`（本地不会因云端变化而更新，也不会新建本地文件）；冲突以本地为准，必要时 `create-remote`/`delete-remote`。
3. **真冲突不自动猜**：`two-way`/`manual` 对 `both-changed`、`remote-deleted-local-changed`、`local-deleted-remote-changed` 一律 `conflict`；非交互环境跳过且不改数据（README：「绝不擅自删数据」）。
4. **同步删除只进回收站**：`deleteNote(id, tag, false)`；`purge=true` 只存在于手动 `delete --purge`。
5. **`manual` 并非「全部询问」**：`remote-changed`/`remote-new` 仍自动下行（B.3），与 README 描述有出入，以测试表为准。
6. **不做三方文本合并**：无 base 正文，冲突只能整篇选一侧。
7. **不追踪文件身份**：无 inode/文件 id/xattr；文件被移出 output 或被外部改名而 state 未更新 → 表现为「#9 删云端原件 + #6 新建」两条计划（无基线时才走路径认领），可能产生重复笔记。
8. **不支持多层子目录**：`scanMarkdownFiles` 只扫顶层 + 一级子目录（跳过名为 `assets` 的目录），更深 `.md` 不参与「本地新增」检测；未跟踪 `.md` 若 `trim() === ""` 也不入计划。
9. **附件只支持图片上行**：音频/视频只能导出；含此类引用、图片与文字同行、图片找不到文件时，该条报错跳过，不降级为纯文本。
10. **不删/不改云端文件夹、不把本地目录结构推成云端结构**：上行只可能 `createFolder`（C.4 第 3 步）。
11. **不清理孤儿本地文件**：`drop-state`/`skip`/人工遗留的文件不会被主动清扫。
12. **无并发保护**：源码未见锁文件/互斥（未确认其它模块）；两个 sync 同时跑会互相覆盖 state 并可能重复创建。
13. **`syncTag` 增量未实现**：字段保留不用，每次全量 `getAllNotes`（分页 200）后逐条判。
14. **`--dry-run` 不落盘**，也丢弃认领产生的 `state` 修正。
15. **不跨设备同步 state**：state 跟 output 走、不入版控，两端各自独立，靠内容哈希收敛。

## G. 未确认清单

- `client.downloadFile` 内部是否真「已存在则跳过」（`downloadAttachments` 注释如此声称，未读 `src/client.ts`）。
- `getAllNotes(200, ...)` 的分页终止条件（`lastPage` 还是空页）与重试策略。
- 是否有其它命令写入 `state.folders`（已读四文件无写入点）。
- 并发/锁：`src/index.ts`、`src/commands/shared.ts` 未读，无法确认是否存在跨进程互斥。
- 小米服务端对 `createNote` 是否有幂等/去重（源码未传幂等键）。
- `modifyDate` 的服务端精度（代码按毫秒处理，未从 API 文档确认）。
- 交互冲突界面在 Windows 终端下的表现（`process.stdout.isTTY` 判定）未实测。
