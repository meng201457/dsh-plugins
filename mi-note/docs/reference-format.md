# 小米云笔记正文 XML 格式 & Markdown ↔ XML 转换规格

> 来源：开源项目 `ceynri/mi-note-cli`（`main` 分支，抓取于 2026-11-13）。
> 依据文件：`src/converter.ts`（全量逐行核对）、`tests/converter.test.ts`、`tests/fixtures/round-trip.md`、`src/types.ts`、`src/note.ts`、`LICENSE`。
> 本文所有标签、属性、正则、期望值均原样取自上述源码/测试，未编造。凡源码中不存在的构造，一律在末节列为「未确认」。

---

## A. XML 语法精确定义

### A.1 容器：没有根元素、没有命名空间、没有 XML 声明

正文**不是**一个完整 XML 文档，而是「每行一个元素」的**片段（fragment）**，字符串整体存进笔记条目的 `content` 字段（JSON 里）：

```ts
export interface RawNoteEntry {
  id: number | string;
  folderId?: number | string;
  subject?: string;      // 笔记标题（与正文分离）
  content?: string;      // 正文 XML 片段
  snippet?: string;
  createDate?: number;   // epoch ms
  modifyDate?: number;
  extraInfo?: string | Record;  // JSON：title / note_content_type / mind_content ...
  setting?: NoteSetting;        // setting.data[] = 附件列表（rawId/fileId/digest + mimeType）
  files?: RawNoteFile[];
}
```

- 无 `<root>`、无 `xmlns`、无 `<?xml ...?>`。测试直接传入裸片段，例如 `xmlToMarkdown("<text><size>大标题</size></text>")`。
- 小米客户端真实笔记的首行常带一个空标记 `<new-format/>`（**无空格**，紧贴 `/>`）。本实现读取时用 `/<new-format\s*\/>/g` 剥掉，**写入时不生成**：

```xml
<new-format/><order indent="1" inputNumber="1" />第一段
<text indent="1">然后我说了一些中间的话</text>
<order indent="1" inputNumber="2" />然后是第二段
```

- 另一个空标记 `<0/>` 也会被剥掉（见 A.5）。
- 解析前提：**一个块级元素必须独占一行**。读取时 `xmlToMarkdown` 先按 `\n` 切分、再对每行 `line.trim()` 后整行正则匹配；唯一例外是 `<quote>`（见下，内部换行先被替换成 `\u2028` 占位符再整体当一个 token 处理）。

### A.2 块级元素（一行一个，平铺，互不嵌套）

| 语义 | 真实写法 | 必需属性 | 备注 |
|---|---|---|---|
| 空行/空段落 | `<text indent="1"></text>` | `indent`（可省略） | 读回 `{type:"blank"}` |
| 段落 | `<text indent="1">正文</text>` | `indent` 可省略（缺省=0级） | 内容 `trim()` |
| 一级标题 | `<text indent="1"><size>标题</size></text>` | — | `size` 必须占满整个 text 内容 |
| 二级标题 | `<text indent="1"><mid-size>标题</mid-size></text>` | — | |
| 三级标题 | `<text indent="1"><h3-size>标题</h3-size></text>` | — | |
| 无序列表 | `<bullet indent="1" />项目` | `indent`（自闭合形态必填） | 自闭合 + 后置文本 |
| 有序列表 | `<order indent="1" inputNumber="1" />项目` | `indent` 必填；`inputNumber` 可省 | 自闭合 + 后置文本 |
| 复选框 | `<input type="checkbox" indent="1" level="3" checked="true" />完成` | `type="checkbox"`；`indent`；`level="3"`（客户端固定写 3，含义未明） | 未勾选时省略 `checked` 属性 |
| 引用 | `<quote><text indent="1">第一行</text>` + 换行 + `<text indent="1">第二行</text></quote>` | — | **可跨行**，唯一允许多行的元素 |
| 分割线 | `<hr />` | — | 读正则容忍 `<hr/>` |
| 图片 | `<img fileid="abc123" imgshow="0" imgdes="" />` | `fileid` | `imgshow="0"` / `imgdes=""` 为固定常量 |
| 音频 | `<sound id="…" />`（属性名可为 `id` / `fileid` / `data`） | 属性值须命中 `setting.data` 里某附件的 rawId | 只读，无写入路径 |
| 视频 | `<video id="…" />`（同上三种属性名） | 同上 | 只读，无写入路径 |
| 居中/对齐块 | `<align align="center">文本</align>` | `align` ∈ center/left/right | 只读，无写入路径 |

**读取用正则（原样，实现必须逐字对齐）**：

```js
/^<order\s+indent="(\d+)"(?:\s+inputNumber="(\d+)")?\s*\/(.*)$/
/^<bullet\s+indent="(\d+)"\s*\/(.*)$/                    // 自闭合形态
/^<bullet(?:\s+indent="(\d+)")?\s*>([\s\S]*?)<\/bullet>$/ // 包裹形态
/^<input\s+([^>]*?)type="checkbox"([^>]*?)\s*\/(.*)$/
/^<quote>([\s\S]*?)<\/quote>$/
/^<text(?:\s+indent="(\d+)")?\s*>([\s\S]*?)<\/text>$/
/^<hr\s*\/>$/
/^<align\s+align="(center|left|right)">([\s\S]*?)<\/align>$/
/<img\s+[^>]*fileid="([^"]+)"[^>]*\/>/g   // 全局替换，非整行锚定
```

- `<text>` 只接受 `indent` 一个属性；写成 `<text style="...">` 会落到「兜底分支」= 去掉所有 `<...>` 只留文本。
- `<bullet>` 的**自闭合形态必须带 `indent`**；`<bullet />文本`（无 indent）不匹配，退化为纯文本。
- `<order>` 的**包裹形态 `<order>…</order>` 不被支持**（源码注释：会被吞内容），只有自闭合形态有效。

### A.3 缩进语义（最容易写错的地方）

- 属性 `indent` 是 **1 基层级**：`level = max(0, Number(indent||0) - 1)`。
- 读：`indent="1"` → 0 个前导空格；`indent="2"` → 2 空格；`indent="3"` → 4 空格；即 `"  ".repeat(indent-1)`。
- 写：Markdown 前导空白宽度（空格=1、Tab=4）经**栈式相对缩进**换算成层级，**从 1 起算**：第一个列表项无论原来缩进多少，一律 `indent="1"`；比栈顶更宽 → 层级 +1；等宽 → 同层；更窄 → 弹栈。
- 因此 `1.` / `2.` 空格 / `3.` 空格 / 4 空格 / Tab 混用都能正确分层（测试 `列表缩进按栈式相对算法推断（兼容 2/3/4 空格）`）。
- 遇到普通段落、标题、hr、quote、图片时缩进栈**重置**；遇到空行**不重置**（允许列表中间夹空行）。
- 段落层级只认 Tab：行首是 `\t` → `indent="2"`，否则 `indent="1"`（并去掉这一个 Tab）。

### A.4 行内元素

| 语义 | XML | 读回 Markdown |
|---|---|---|
| 加粗 | `<b>粗</b>` | `**粗**` |
| 斜体 | `<i>斜</i>` | `*斜*` |
| 删除线 | `<delete>删</delete>` | `~~删~~` |
| 下划线 | `<u>下划</u>` | `<u>下划</u>`（原样保留内联 HTML） |
| 背景高亮 | `<background color="BBGGRR">文字</background>` | `<mark style="background:#RRGGBB">文字</mark>` |
| 标题字号（行内出现时） | `<size>/<mid-size>/<h3-size>` | 降级为 `**…**` |

读取用正则：

```js
/<b>([\s\S]*?)<\/b>/g
/<i>([\s\S]*?)<\/i>/g
/<delete>([\s\S]*?)<\/delete>/g
/<u>([\s\S]*?)<\/u>/g
/<background\s+color="([^"]+)">([\s\S]*?)<\/background>/g
```

- `<background color>` 的值是 **BGR**，读取时 `bgrToRgb()` 交换首尾字节转成 `#RRGGBB`（长度 < 6 时原样返回）。
- 标题标签在段落中**任意位置**出现都会被降级成 `**…**`；只有当整个 text 内容就是 `<size>…</size>` 时才升级成 `#` 标题。
- `fontColor`、`backColor`、`size` **属性**在本项目源码中不存在（行内字号是标签不是属性）；见末节「未确认」。

### A.5 转义与空白

写入（`escapeXml`，顺序固定，**只转三个字符**）：

```js
text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
```

- **不转** `"`、`'`、换行、空格、方括号、反引号、星号（`*`/`_` 等 Markdown 记号会原样留在 XML 文本里）。
- 读取（`decodeHtmlEntities`，`/&([a-z]+);/gi`）：`amp→&`、`lt→<`、`gt→>`、`quot→"`、`apos→'`、`nbsp→`（普通空格）。未登记的实体**原样保留**（如 `&copy;`）。
- 空白：行首行尾空白被 `trim()` 丢弃（段落靠 `indent` 表达缩进）；文本内部空格原样保留；`\r\n` → `\n`；`<text>` 内容为空或全空白 → 视为空段落。
- `<0/>` 在预处理与复选框尾部都被剔除；`<new-format/>` 在预处理剔除。

---

## B. Markdown → XML 映射表

`markdownToXml(markdown, imageMap)`：按行处理，输出行数组 `out.join("\n")`。匹配顺序即下表自上而下的顺序（先图片，再标题，再 hr，再 checkbox/bullet/order，再空行，最后普通段落）。

| Markdown 构造 | 生成的 XML | 注意事项/限制 |
|---|---|---|
| 普通段落 `普通` | `<text indent="1">普通</text>` | 行尾空白先被剥掉 |
| 行首 Tab 的段落 | `<text indent="2">…</text>` | 只吃一个 Tab |
| 空行 | `<text indent="1"></text>` | 文末连续空段落会被弹出丢弃 |
| 多个连续空行 | 每行一个空 text，文末全丢 | 读回时 `\n{3,}` → `\n\n`，**连续空行压成一个** |
| `# 标题` | `<text indent="1"><size>标题</size></text>` | `#` 与文字间**必须有空格** |
| `## 二级` | `<text indent="1"><mid-size>二级</mid-size></text>` | |
| `### 三级` | `<text indent="1"><h3-size>三级</h3-size></text>` | |
| `#### H4` ~ `###### H6` | 无标题映射 → `<text indent="1">#### H4</text>` | 正则只认 `#{1,3}`，H4+ 退化为普通段落文本 |
| `- 项` / `* 项` | `<bullet indent="N" />项` | `\s+` 必需，`-项` 是段落 |
| `1. 项` | `<order indent="N" inputNumber="1" />项` | **总是**写显式 `inputNumber`（用户写的数字原样） |
| 嵌套列表（任意缩进） | `indent` 由栈式相对缩进推得，从 1 起 | 层级不封顶（测试覆盖到 indent="4"） |
| `- [ ] 待办` | `<input type="checkbox" indent="N" level="3" />待办` | `]` 后必须有空白 |
| `- [x] 完成` | `<input type="checkbox" indent="N" level="3" checked="true" />完成` | `[X]` 也接受 |
| `> 引用` | `<quote><text indent="1">引用</text></quote>` | 单行也用多行形态 |
| `> 甲`↵`> 乙` | `<quote><text indent="1">甲</text>`↵`<text indent="1">乙</text></quote>` | 连续 `>` 行先合并成一个块 |
| `---` / `***` / `___`（≥3） | `<hr />` | 必须是整行；`- - -`、`* * *` 不匹配 |
| 行内 `**粗**` | `<b>粗</b>` | `.+?`，空串不匹配 |
| 行内 `*斜*` | `<i>斜</i>` | 正则 `(?<!\*)\*(?!\*)([^*]+?)\*(?!\*)`；`_斜_` **不支持** |
| 行内 `~~删~~` | `<delete>删</delete>` | |
| 行内 `<u>下划</u>` | `<u>下划</u>` | 内容先抽占位符再统一转义，故 `<u>a < b</u>` → `<u>a &lt; b</u>` |
| 行内样式组合 | 按 bold → italic → delete 顺序逐个套 | 无嵌套语义，`***x***` 会切错（见 D） |
| `[文字](url)` 链接 | 无映射 → 段落文本 `[文字](url)` | 方括号不转义；不生成任何链接标签 |
| 图片 `![alt](minote://image/ID)` | `<img fileid="ID" imgshow="0" imgdes="" />` | **整行被替换**，同行其它文字丢失；`alt` 被丢弃 |
| 图片 `![alt](assets/x.jpg)` | 同上，`fileid` 取自 `imageMap` | 未命中 map → 不转成 img，退化为文本 |
| 图片 `![alt](https://…)` | 退化为文本 | 外链图片刻意保留为文本 |
| 独占行图片 | 生成 `<img>` 并重置缩进栈 | 「图片需独占一行」，否则 `assertAttachmentsResolvable` 抛错 |
| 代码围栏（含语言标识） | 无映射 → 围栏行与内部每行各自变成一个 `<text indent="1">` 段落 | **不建代码块**；围栏内的 `#`、`- `、`**强调**` 会被误解释；语言标识仅作字面文本保留 |
| 表格 `\| a \| b \|` | 每行一个 `<text indent="1">\| a \| b \|</text>` | 无表格标签；分隔行 `\|---\|---\|` 因含 `\|` 不会被误判成 hr |
| 脚注 `[^1]` / 定义列表 | 无映射 → 普通段落文本 | 纯文本保留 |
| 内嵌 HTML（`<div>`、`<br>` 等） | 转义成 `&lt;div&gt;` | 除 `<u>` 外一律变字面文本；读回时实体解码还原字符串 |
| 音频/视频链接 `[🔊 a](assets/a.mp3)` | 无映射 | `findUnresolvedAttachments` 判为「暂不支持回写的附件」并抛错 |

---

## C. XML → Markdown 映射表

`xmlToMarkdown(content, files, assetPrefix="assets/")`：预处理（附件替换、去空标记、quote 折叠）→ 逐行 `trim()` 后匹配 → 在块之间按 `needsBlankLine` 插空行 → `\n{3,}`→`\n\n` → 末尾 `trim()`。

| XML | Markdown | 说明 |
|---|---|---|
| `<text indent="1">段落</text>` | `段落` | `indent="N"` → `"  ".repeat(N-1)` 前导空格 |
| `<text indent="1"></text>` | 空行 | `type:"blank"` |
| `<text indent="1"><size>标题</size></text>` | `# 标题` | 标签须占满内容 |
| `<text indent="1"><mid-size>二</mid-size></text>` | `## 二` | |
| `<text indent="1"><h3-size>三</h3-size></text>` | `### 三` | |
| `<bullet indent="1" />项` | `- 项` | 包裹形态 `<bullet indent="1">项</bullet>` 同样支持 |
| `<order indent="1" inputNumber="1" />项` | `1. 项` | 显式数字直接用 |
| `<order indent="1" />项` | 按同层计数器 +1 | 首次出现为 1 |
| `<order indent="1" inputNumber="0" />项` | 同层计数器 +1 | `0` 等价于缺省 |
| `<input type="checkbox" … />文本` | `- [x] 文本` / `- [ ] 文本` | 仅 `checked="true"` 算勾选 |
| `<quote><text indent="1">甲</text>…</quote>` | `> 甲`↵`> 乙` | 内部逐 `<text>` 一行；旧形态 `<quote>inline</quote>` 也支持 |
| `<hr />` | `---` | |
| `<img fileid="ID" … />`（未登记在 `setting.data`） | `![](minote://image/ID)` | alt 为空 |
| `<img>`（登记在 `setting.data`，按 rawId 匹配 `id/fileid/data`） | `![{type}_{YYYY-MM-DD_HH-mm-ss}_{id末8位}.{suffix}](assets/同名文件)` | 整行替换；`type`/`suffix` 由 mime 推断（image→img、audio→audio、video→video、其它→file/bin，`jpeg`→`jpg`） |
| `<sound>` / `<video>` | `[🔊 名](assets/x.mp3)` / `[🎬 名](assets/x.mp4)` | 只读 |
| `<b>/<i>/<delete>/<u>` | `** **` / `* *` / `~~ ~~` / `<u>…</u>` | |
| `<background color="BBGGRR">x</background>` | `<mark style="background:#RRGGBB">x</mark>` | BGR→RGB |
| `<align align="center">x</align>` | `<div align="center">x</div>` | |
| `<new-format/>`、`<0/>` | 删除 | |
| `☺ <rawId>`（旧版内联图标记） | `![名](assets/…)` | 兼容分支 |
| 无法识别的标签行 | 去掉 `<...>`、行内样式照转，非空则作段落 | 兜底 |

**空行插入规则**（`needsBlankLine(prev, curr)`，逐条，命中即返回）：

1. `prev` 为空 → 不加；
2. `prev === curr` 且是列表类型（checkbox/bullet/order）→ 不加；
3. `text` → `text` → **加**；
4. `heading`/`hr`/`quote` 任一侧出现 → 加；
5. 「是否列表」发生变化 → 加；
6. 其余 → 不加。

---

## D. 丢失 / 降级清单（原始实现的实际取舍）

| 构造 | 往返结果 | 实现细节 |
|---|---|---|
| 代码块 | **完全失去代码语义** | 无围栏标签：```` ``` ```` 与内容都变成 `<text>` 段落；内容里的 `**x**` 会变 `<b>x</b>`，`- ` / `# ` / `1. ` 行会被当列表/标题。语言标识仅作为字面文本保留，无任何代码块标记 |
| 表格 | **降级为逐行段落** | 不生成任何表格标签，`\|` 原样保留在文本里；读回得到同样的文本行，但已不是表格 |
| H4–H6 | **降级为纯文本** | 只映射 `#{1,3}`；`#### x` 写成 `<text indent="1">#### x</text>`，读回仍是 `#### x` 字面 |
| 链接 | **降级为纯文本** | `[文字](url)` 原样进 `<text>`；无链接标签，超链接不可点击 |
| 脚注 / 定义列表 | 降级为纯文本 | 无对应标签 |
| 内嵌 HTML | 变字面字符 | 除 `<u>` 外全部 `&lt;…&gt;` 转义，读回解码为字符串 |
| 强调嵌套 | 结构被破坏 | 无嵌套支持；`***x***` 先被 `/\*\*(.+?)\*\*/` 命中切成 `<b>*x</b>` 再剩一个 `*`（由正则推导，无测试断言） |
| `_斜体_` | 不识别 | 只认 `*斜*`，下划线原样保留 |
| 连续空行（≥2） | 压成 1 个空行 | 读回时 `\n{3,}` → `\n\n` |
| 文末换行 | 丢弃 | 写入时弹出尾部空段落；读取时 `trim()` |
| 段落内软换行 `a`↵`b` | 变成两个段落 | 两行各自成 `<text>`，读回因 `text→text` 插空行，得到 `a`↵空行↵`b` |
| 段落行首/行尾空格 | 丢失 | 读取侧 `inner.trim()`；缩进只能靠 `indent` |
| 图片 alt 文本 | 丢失 | 恒写 `imgdes=""`；读回 alt 为空 |
| 图片同行文字 | 丢失 | 整行被 `<img>` 替换；`assertAttachmentsResolvable` 把「图片需独占一行」当错误抛出 |
| 外链图片 | 不转成附件 | `![](https://…)` 保守保留为文本，避免引用失效 |
| 有序列表编号 | **保留** | 写入恒带 `inputNumber`；读取显式值优先，`0`/缺省才自增（这正是 regression `#order-renumber` 修复的点） |
| 列表缩进宽度 | 归一化 | 读 → `indent-1` 级×2 空格；写 → 任意缩进按相对关系重算，首项恒 `indent="1"` |
| 音频/视频 | 单向 | 只能读出，不能回写（`assertAttachmentsResolvable` 抛「暂不支持回写的附件」） |
| 高亮 / 对齐 | 单向 | `<background>`→`<mark>`、`<align>`→`<div align>` 只有下行；上行会把它们转义成文本 |
| `<order>` 包裹形态 | 被 `assert` 为不可用 | 源码注释：「闭合包裹形式 `<order>…</order>` 会被吞内容」，写入一律自闭合 |

---

## E. 往返样例（原样摘自 `tests/converter.test.ts`）

**E1. 标题：双向**

```js
assert.equal(xmlToMarkdown("<text><size>大标题</size></text>"), "# 大标题");
assert.equal(xmlToMarkdown("<text><mid-size>二级</mid-size></text>"), "## 二级");
assert.equal(xmlToMarkdown("<text><h3-size>三级</h3-size></text>"), "### 三级");
assert.equal(markdownToXml("# 标题"), '<text indent="1"><size>标题</size></text>');
assert.equal(markdownToXml("## 二级"), '<text indent="1"><mid-size>二级</mid-size></text>');
```

**E2. 列表与复选框（含未勾选省略 `checked`）**

```js
assert.equal(markdownToXml("- 项目"), '<bullet indent="1" />项目');
assert.equal(markdownToXml("1. 项目"), '<order indent="1" inputNumber="1" />项目');
assert.equal(markdownToXml("- [x] 完成"),
  '<input type="checkbox" indent="1" level="3" checked="true" />完成');
assert.equal(markdownToXml("- [ ] 待办"),
  '<input type="checkbox" indent="1" level="3" />待办');
// —— 另一条测试：xmlToMarkdown 读包裹形态 <bullet> ——
const xml = `<bullet indent="1">项一</bullet>\n<bullet indent="1">项二</bullet>`;
assert.equal(xmlToMarkdown(xml), "- 项一\n- 项二");
```

**E3. 序号语义（显式值优先 / 缺省自增 / 链表被非 order 打断即重置）**

```js
// 显式 inputNumber=2 → 2；缺省 → 同层计数 +1 得 3；bullet 出现即打断 order 链
const xml =
  `<order indent="1" inputNumber="2" />显式二\n<order indent="1" />缺省接续\n<bullet indent="1" />无序项`;
assert.equal(xmlToMarkdown(xml), "2. 显式二\n3. 缺省接续\n- 无序项");
```

```js
// 显式 inputNumber 后接 inputNumber=0 → 基于显式值续号
const xml = [
  '<order indent="1" inputNumber="5" />A',
  '<order indent="1" inputNumber="0" />B',
  '<order indent="1" inputNumber="0" />C',
].join("\n");
const md = xmlToMarkdown(xml);
assert.ok(md.includes("5. A"));  assert.ok(md.includes("6. B"));  assert.ok(md.includes("7. C"));
```

**E4. 多级列表反向解析（小米客户端真实形态，整段严格断言）**

```js
const xml = [
  '<order indent="1" inputNumber="3" />一级第三段',
  '<order indent="2" inputNumber="0" />二级',
  '<order indent="2" inputNumber="0" />二级第二段',
  '<order indent="2" inputNumber="0" />二级第三段',
  '<order indent="3" inputNumber="0" />三级',
  '<order indent="3" inputNumber="0" />三级第二段',
  '<order indent="4" inputNumber="0" />四级',
  '<order indent="4" inputNumber="0" />四级第二段',
  '<order indent="3" inputNumber="0" />三级第三段',
  '<order indent="1" inputNumber="0" />一级第四段',
].join("\n");
assert.equal(xmlToMarkdown(xml), [
  "3. 一级第三段",
  "  1. 二级",
  "  2. 二级第二段",
  "  3. 二级第三段",
  "    1. 三级",
  "    2. 三级第二段",
  "      1. 四级",
  "      2. 四级第二段",
  "    3. 三级第三段",
  "4. 一级第四段",
].join("\n"));
```

**E5. 多行引用：双向严格相等**

```js
const md = "> 第一行\n> 第二行\n> 第三行";
assert.equal(
  markdownToXml(md),
  `<quote><text indent="1">第一行</text>\n<text indent="1">第二行</text>\n<text indent="1">第三行</text></quote>`,
);
const xml = `<quote><text indent="1">第一行</text>\n<text indent="1">第二行</text></quote>`;
assert.equal(xmlToMarkdown(xml), "> 第一行\n> 第二行");
assert.equal(markdownToXml("> 引用"), '<quote><text indent="1">引用</text></quote>');
```

**E6. 图片：`<img>` ↔ `minote://` 严格互通**

```js
const xml = '<img fileid="1234.abcdEFG" imgshow="0" imgdes="" />';
const md = xmlToMarkdown(xml);
assert.equal(md, "![](minote://image/1234.abcdEFG)");
assert.equal(markdownToXml(md), xml);
assert.equal(markdownToXml("![图](minote://image/abc123)"),
  '<img fileid="abc123" imgshow="0" imgdes="" />');
```

**E7. 转义与下划线**

```js
assert.equal(markdownToXml("a < b & c"), '<text indent="1">a &lt; b &amp; c</text>');
assert.equal(xmlToMarkdown("<text>a &amp; b &lt; c</text>"), "a & b < c");
assert.equal(markdownToXml("含**粗体**字"), '<text indent="1">含<b>粗体</b>字</text>');
assert.equal(markdownToXml("<u>a < b</u>"), '<text indent="1"><u>a &lt; b</u></text>');
assert.equal(markdownToXml("文字<u>下划</u>结束"), '<text indent="1">文字<u>下划</u>结束</text>');
```

**E8. 文末空段落 + 文件级往返（夹具守恒）**

```js
assert.equal(markdownToXml("最后一段\n"), '<text indent="1">最后一段</text>');
assert.equal(markdownToXml("最后一段\n\n"), '<text indent="1">最后一段</text>');
assert.equal(markdownToXml("上一段\n\n下一段\n"),
  '<text indent="1">上一段</text>\n<text indent="1"></text>\n<text indent="1">下一段</text>');

const md = readFileSync(join(FIXTURES_DIR, "round-trip.md"), "utf-8");
const xml = markdownToXml(md);
const back = xmlToMarkdown(xml);
assert.equal(back.trim(), md.trim());   // 只 trim 末尾，其余字节相等
```

`tests/fixtures/round-trip.md` 是仓库自带的黄金夹具（H1–H3、四种行内样式、三级嵌套无序列表、被段落打断后重排的有序列表、显式续号 4/5、复选框、三行引用、`---`、尾段）。上面最后四条断言（夹具往返）即该文件的全部校验方式：**除末尾 trim 外字节相等**，写实现时应原样复刻该夹具。

---

## F. 许可证

`LICENSE` 文件为 **MIT License**，版权行：

```
MIT License

Copyright (c) 2026 ceynri
```

归属说明写法：`Based on mi-note-cli (https://github.com/ceynri/mi-note-cli), Copyright (c) 2026 ceynri, MIT License.` 分发时需随附完整 MIT 文本。

---

## G. 未确认清单（源码中查不到，不要凭空实现）

1. **无根元素 / 无命名空间**是否需要：本实现只发片段，读取时丢弃 `<new-format/>`，写入时不生成；没有任何测试断言云端要求它。
2. `level="3"` 的确切语义：源码注释原文「level 含义未明但小米客户端固定写 3」。
3. `fontColor` / `backColor` / `size` 等**行内属性**：全项目不存在（行内字号/颜色用的是 `<size>` 标签与 `<background color>` 标签）。
4. 代码块、表格、链接、脚注、定义列表是否有云端原生标签：源码无任何对应分支，故本项目**没有**这些映射。
5. `imgdes` 非空时的读回行为：实现恒写 `imgdes=""` 且读取时忽略该属性。
6. `<order>…</order>` 包裹形态「会被吞内容」只有注释说明，无测试用例佐证。
7. `<mark>` / `<div align>` 的上行（Markdown→XML）路径未实现，是否能被客户端接受未确认。
8. 附件文件名格式 `${type}_${formatDateTime(createDate)}_${rawId 最后 8 位}.${suffix}` 中的 `formatDateTime` 格式为 `YYYY-MM-DD_HH-mm-ss`（由 `renderFileNameTemplate` 测试断言 `"2026-06-06_14-03-00"` 推得，`utils.ts` 本体未抓取核对）。
