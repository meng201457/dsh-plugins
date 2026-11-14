# dsh-api-proxy

让 DeepSeek Harness 的**模型 API 请求**走 HTTP/HTTPS（CONNECT）代理，代理地址可自定义 IP 与端口，并按「当前 DSH 配置里手动填写的 API 地址」逐个勾选是否走代理。

## 功能

- 设置页：**设置 → 网络代理**（独立设置区块）
- 可指定：代理 IP/主机、端口、可选用户名/密码
- 目标来自当前 DSH 里配置的 API 地址（如 `llm-pi-ai` 的 `providers.*.baseURL`），逐个勾选
- 默认跳过私有网段（`10.x` / `172.16-31.x` / `192.168.x` / `*.local`），可在页面上关闭该跳过
- 支持额外域名/通配（`*.example.com`）
- 「测试连接」按当前填写值实际穿透代理探测目标，返回状态码与耗时
- 保存即生效，无需重启

## 实现要点

- **Host 半**：包装进程内的 `globalThis.fetch`，只对命中的目标使用自实现的 HTTP/CONNECT 隧道（`node:http` + `node:tls`）；其余请求原样走原 fetch。OpenAI SDK 在构造客户端时解析 `globalThis.fetch`，pi-ai 每次请求都会新建客户端，因此补丁立即生效。
- **零依赖**：本地目录安装的 bundle 会被链进 profile，只有 Node 内置模块能从它自身路径解析，所以不使用任何第三方包。
- **持久化**：保存到 `%USERPROFILE%\.dsh\dsh-api-proxy.json`（若存在 `DSH_PROFILE_DIR` 则放在该 profile 目录下）；页面底部显示实际路径。
- **Client 半**：在 `settings.section` 注册页面，通过 `/api/dsh-api-proxy` 路由读写配置。

## 注意

- 只作用于 Host 主进程发出的请求；浏览器页面到本机的请求不受影响。
- 代理密码以明文保存在上述 JSON 配置文件里。
- 若某个请求走代理失败，错误会原样抛给调用方（不会静默回退直连），设置页会显示最近一次失败原因。

## 文件

| 文件 | 说明 |
|---|---|
| `index.js` | Host 插件：fetch 拦截、代理转发、`/api/dsh-api-proxy` 路由、端点探测 |
| `client.js` | Client 插件：`settings.section` 设置页 |
| `cordis.patch.yml` | 向 profile 插入该插件条目 |
| `locale/{zh,en}.json` | 插件显示名与描述 |
