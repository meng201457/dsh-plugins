# 归档会话管理（dsh-archive-manager）

在侧边栏加一个「归档会话」入口，打开一个按工作区分区的归档会话管理器：
可以取消归档，也可以单个或勾选多个永久删除。

DSH 自带「归档」但**没有删除会话的任何入口**（会话持久化、`ctx.sessions` 与
`session/*` 全部 25 个端点都没有删除能力），所以本插件自带 Host 半边补齐这一步。

## 功能

- 左侧栏新增一行入口（`sidebar.panellist`），点开是主区域页面（`main` 的 keyed 槽）。
- 按工作区分区：分区头是工作区标题 + 目录路径 + 该工作区归档数，可折叠；
  没有任何工作区认领的归档会话单独归到「未归属工作区」。
- 每行显示标题、更新时间与占用体积；缺少标题的旧会话显示「未命名会话」。
- 单行操作：`取消归档`、`删除`。
- 多选：行内复选框 / 分区全选 / 顶部 `全选`，选中后出现 `删除所选` 与 `取消归档所选`。
- 破坏性操作一律先弹确认框，列出将被删除的会话名；`Esc` 或点遮罩可取消。
- 仍被某个窗口打开着的会话会标记 `使用中`，复选框与删除被禁用——Host 拒绝删除
  附着在运行中 Harness 上的会话，界面提前把这一状态说清楚。

## 结构

```
package.json        清单：dsh.bundle.patch + dsh.client（无构建步骤，纯 ESM/JS）
cordis.patch.yml    insert 一行 dsh-archive-manager（Host 半边）
index.js            Host 半边：/api/dsh-archive-manager/{health,state,delete,unarchive}
client.js           Client 半边：sidebar.panellist 图标 + main 页面（React.createElement）
locale/{zh,en}.json 插件列表里的标题/描述
icon.svg            插件图标
```

## Host 半边

路由注册在**鉴权过的 `/api` 桥**上（`ctx.connection.fetch.register`），而不是
`webServer` 的 `/api/...` 前缀路由：后者按最长前缀优先匹配，会绕过浏览器鉴权，
删除这种破坏性接口不能走那条路。走 `connection.fetch` 时请求必须带浏览器会话
cookie，且只有 owner 身份通过。

- `GET  /api/dsh-archive-manager/health`   自检：服务是否就绪、归档条数、当前 live 会话
- `GET  /api/dsh-archive-manager/state`    工作区 + 归档会话（标题/时间/体积/live）
- `POST /api/dsh-archive-manager/delete`   `{ ids: [...] }` 永久删除
- `POST /api/dsh-archive-manager/unarchive` `{ ids: [...] }` 取消归档

数据来自 Host 自己的真相：`ctx.workspaceRegistry`（归档集合 global、工作区成员）、
`ctx.sessionQuery`（标题折叠、会话头）、`ctx.sessionPersistence.stat()`（日志路径/大小）。
归档集合是**全局**的，所以"按工作区分区"是 `workspace.sessionIds ∩ archivedSessionIds`
的客户端侧联接。

删除顺序（关键）：

1. 拒绝 live 会话（`ctx.sessions.get(id) !== undefined`）；
2. `unarchiveSession` 把它从归档集合里摘掉；
3. 对每个工作区 `detachSession`（必要时 `unpinSession`）；
4. 最后才 `rm -rf` 会话日志目录与投影缓存。

先动注册表、后动文件：注册表这一步失败就整体中止；文件这一步失败只记 warning，
不会留下"注册表已经没有、磁盘上还在、重启后被 bootstrap 重新挂回来"的半删状态。

## 安装 / 卸载

安装（等价于 `pnpm add link:<path>` 的效果，不需要联网）：

```powershell
node _agent_tmp\install-archive-manager.mjs
```

它会在 `%USERPROFILE%\.dsh\profiles\desktop\node_modules` 里建 junction，
并在 profile 的 `package.json` 里补 `dependencies` 与 `dsh.profile.bundles`。
改 profile 清单本身就会触发 dsh-hmr 的 profile 对账，**不需要重启 DSH**。

卸载：从 `dsh.profile.bundles` 里去掉 `dsh-archive-manager`（同样热生效），
再按需删掉依赖条目、junction 与 `plugins\dsh-archive-manager` 目录。
禁用前的 profile 清单备份在 `_agent_tmp\profile-backup\package.json.bak`。

## 已知边界

- Host 侧没有"关闭/释放某个会话"的公开 API，因此**使用中**的会话只能等它被释放
  （切换离开、闲置淘汰或重启 DSH）之后才能删除；界面会提前禁用并说明原因。
- 删除只移除归档集合/工作区成员、会话日志目录与投影缓存，不动任何工作区目录里的文件。
- 多个窗口同时打开时，删除后其它窗口的归档列表要等下一次 `workspace/follow` 增量
  或重新打开面板才刷新。
