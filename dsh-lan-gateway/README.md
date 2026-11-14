# dsh-lan-gateway — 局域网 / 外网访问 + QQ 启动通知

把当前 Harness 的 Web 界面反向代理到本机固定端口（默认 `0.0.0.0:3080`），让同一局域网或路由器反代后的设备打开；每次 DSH 启动时，还可以把**本次进程的访问令牌（纯 token，不含完整链接）**通过 OneBot v11 推送到指定的 QQ 群 / 私聊。只有先在设置里配置了外部域名，才会发送通知。

## 它解决什么

Desktop 版 DSH 的 Web 界面跑在随机回环端口上，并且要求每个进程启动时生成的访问令牌；直接做端口转发会得到 401。本插件自动完成：

1. 通过 `ctx.webServer.getOrigin()` 读取当前 DSH 的监听地址与端口；
2. 通过 `ctx.connection.authenticatedUrl()` 读取本次进程的访问令牌；
3. 用令牌换取 DSH 的浏览器会话 Cookie（只在插件内部保存）；
4. 在 `0.0.0.0:3080` 上启动 HTTP 反向代理：把 `Host` 和同源 `Origin` 改写成回环地址、注入会话 Cookie，于是局域网/外网设备只需要一条带令牌的链接就能使用完整 Web UI（含 `/api/remote.mux` WebSocket）；
5. 启动完成后，把**访问令牌本身**（可选标题 / 时间戳）通过 OneBot v11 发到 QQ（可选群聊 / 私聊）。**未配置外部域名时不会发送**（安全策略）；域名只用于生成访问链接，不会拼进 QQ 消息。

设置页在 **设置 → 局域网访问**，包含网关与 QQ 推送两块配置。

## 设置项

### 网关

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 是否启动网关。保存后立即生效。 |
| `port` | `3080` | 本机监听端口；路由器反代指向这里。 |
| `bindHost` | `0.0.0.0` | `0.0.0.0` 允许局域网访问；`127.0.0.1` 仅本机。 |
| `requireToken` | `true` | 首次访问必须带 `?token=<访问令牌>`，之后通过 HttpOnly 会话 Cookie 保持登录。 |
| `publicUrl` | `""`（留空） | 外部域名 / 路由器反代入口，用于生成访问链接；也是 QQ 启动推送的**安全开关**——留空则不会发送（会被规范化为 origin，不含路径）。 |

### QQ 启动通知（OneBot v11）

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `notifyOnStartup` | `true` | 是否在 DSH 启动后推送（还需配置 `publicUrl` 和至少一个目标）。 |
| `notifyGroup` / `groupId` | `true` / `""`（留空） | 群聊开关与真实群号。 |
| `notifyPrivate` / `userId` | `false` / `""` | 私聊开关与好友 QQ 号。两个目标可同时启用、互不影响。 |
| `oneBotWsUrl` | `ws://127.0.0.1:3001` | OneBot v11 正向 WebSocket 地址（NapCat / Lagrange 等实现监听的端口）。 |
| `oneBotAccessToken` | 空 | OneBot 的 access_token；**只保存在 Host 进程 / 设置文件里，不会下发到浏览器**。表单留空表示保持不变。 |
| `notifyTitle` | `DSH 已启动` | 消息首行标题，留空则省略。 |
| `includeTimestamp` | `true` | 是否附带 `时间：YYYY-MM-DD HH:mm:ss`。 |
| `notifyTimeoutMs` | `15000` | 连接与单次发送超时。 |

设置保存在 `$DSH_HOME/dsh-lan-gateway.json`（Desktop 默认是 `C:\Users\<你>\.dsh\dsh-lan-gateway.json`），不会改写 profile 的 `cordis.patch.yml`。

## 使用

1. 安装并启用本 bundle（Plugin Manager → 安装本地包，或 `plugin_manager install_bundle` 指向本目录）。
2. **设置 → 局域网访问**：确认「网关状态：运行中」「DSH 上游」正确；把「外部域名」填成路由器反代入口（例如 `https://dsh.example.com`）。
3. 在「QQ 启动通知」里填 OneBot WS 地址与 access_token，勾选群聊并填群号（或勾选私聊填 QQ 号），保存。
4. 点「发送测试消息」确认真能收到；消息内容是纯访问令牌（不含域名/链接）。之后每次 DSH 启动都会自动推送一次（同一进程只推一次）；未配置外部域名时不会发送。
5. 路由器上的反代服务保持指向本机 `3080` 端口即可；HTTPS 可以在路由器终止。

## 安全提示

- **QQ 消息里的令牌等于 owner 级凭据**：拿到 token 的人拼上外部域名即可完全控制这台 DSH（执行命令、读写文件）。只发到可信的群 / 私聊；群成员能看到这条消息。\n- **未配置外部域名时不发送**：这是刻意的安全策略，避免在不知道访问入口的情况下把令牌发出去。
- 关闭 `requireToken` 后，任何能连到网关端口的设备都可以直接打开界面。仅在完全可信的局域网中关闭。
- `oneBotAccessToken` 以明文存放在本机设置文件里（和 DSH 的其它本地凭据同一信任级）；设置页只返回「是否已设置」。
- DSH 重启后启动令牌会变，旧链接失效；网关的 LAN 会话 Cookie 也会随进程重置，需要重新打开新链接。

## 实现要点

- Host 半：`index.js`（仅 Node 内置模块，无第三方依赖）。
- Client 半：`client.js`（`window.__ModuleLoader__` 工厂，React 来自模块表）。
- 设置接口挂在 DSH Web 服务器上，且自身要求已认证的 owner 会话：
  - `GET /api/dsh-lan-gateway/state`
  - `POST /api/dsh-lan-gateway/save`
  - `POST /api/dsh-lan-gateway/test`（令牌 → Cookie → 通过网关取 index.html）
  - `POST /api/dsh-lan-gateway/test-notify`（真的发一条 QQ 消息）
- 反向代理：`Host` → `127.0.0.1:<DSH 端口>`，同源 `Origin` → 同一回环地址，丢弃 `Referer`，注入 DSH 会话 Cookie；跨站 `Origin` 原样转发，由 DSH 的 Host/Origin 栅栏返回 403（不引入 CSRF 缺口）。
- WebSocket 在 TCP 层转发升级请求，握手同样改写 `Host`/`Origin`/`Cookie`。
- 令牌读取失败时**拒绝访问**（fail closed，503）；`requireToken` 关闭时才是开放模式。
- 启动推送在 `connection` 就绪且 Loader 整棵树 settle 之后执行，与 Web app 报告 URL 的时序一致；`publicUrl` 为空时直接跳过（不发送）。群/私聊共用一个 OneBot 连接但独立成败；任何失败只记日志，不阻断启动。
- OneBot 消息使用 `[{type:"text",data:{text}}]` 段数组，token 中的 `[` `]` `&` 不会被当作 CQ 码；access_token 通过 `?access_token=` 传递（Node 内置 WebSocket 不支持自定义头）。\n- 消息正文只拼 `notifyTitle` + 访问令牌 + 时间戳；不会拼接外部域名或完整 URL。`/test-notify` 返回 `token` / `content` 供页面展示。
- 推送失败/成功状态显示在设置页「上次推送」（`notify.lastAt` / `lastOk` / `lastError`）。
- `/manifest.webmanifest`、`/favicon.ico` 不校验网关令牌（浏览器取这两个资源不带 Cookie）。
