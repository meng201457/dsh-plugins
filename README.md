# dsh-plugins

DeepSeek Harness 插件合集。每个子目录是一个独立插件：纯 ESM / JavaScript，**无构建步骤、零运行时第三方依赖**，
通过自带的 `cordis.patch.yml` 把自己插入 DSH profile。

## 插件

| 目录 | 包名 | 版本 | 说明 |
| --- | --- | --- | --- |
| [dsh-api-proxy](./dsh-api-proxy) | `dsh-api-proxy` | 1.0.5 | 让 DSH 的模型 API 请求按端点逐个走 HTTP/HTTPS（CONNECT）代理，设置页在「设置 → 网络代理」 |
| [dsh-archive-manager](./dsh-archive-manager) | `dsh-archive-manager` | 1.0.0 | 侧边栏「归档会话」管理器：按工作区分区浏览归档会话，可取消归档、单个或批量永久删除 |
| [dsh-lan-gateway](./dsh-lan-gateway) | `dsh-lan-gateway` | 1.2.0 | 把 Web UI 反向代理到固定端口供局域网/外网访问，并在启动时通过 OneBot v11 把访问令牌推到 QQ |
| [mi-note](./mi-note) | `mi-note` | 0.1.0 | 扫码连接小米账号，把小米云笔记双向镜像成本地 Markdown；推送/发布经 `mi_note_sync` 工具显式指定文件 |

每个插件目录里的 `README.md` 有完整功能说明、设置项表格与实现要点。

## 共同结构

```
<plugin>/
  package.json       清单：dsh.bundle.patch + dsh.client（无构建步骤）
  cordis.patch.yml   向 profile 插入该插件的 Host 条目
  index.js           Host 半边：路由 / 服务 / 拦截
  client.js          Client 半边：React 页面（createElement，无 JSX 编译）
  locale/{zh,en}.json  插件列表里的显示名与描述
  icon.svg           插件图标
  README.md
```

## 安装

插件以「本地目录」形式安装：把某个插件目录放进 DSH profile 的 `node_modules` 下
（`~/.dsh/profiles/<profile>/node_modules/<包名>`，目录链接或复制均可），
DSH 启动时按其自带 `cordis.patch.yml` 把条目插入 profile 的 `cordis.yml`。

## 环境要求

- Node.js >= 20（见各 `package.json` 的 `engines`）
- DeepSeek Harness（Desktop 版，带 Web 客户端）
- 各 `package.json` 均为 `"private": true`，不发布到 npm

## 版本

各插件独立演进，版本号以各自 `package.json` 为准。
