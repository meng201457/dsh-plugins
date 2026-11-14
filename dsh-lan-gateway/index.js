/**
 * dsh-lan-gateway — expose this Harness' Web UI to the LAN.
 *
 * The Desktop Host runs the Web composition on a random loopback port and keeps the
 * browser session behind a per-process launch token plus a Host/Origin fence
 * (`dsh-client-connection`). That makes a plain port forward useless. This plugin
 * therefore:
 *
 *   1. reads the live Web server origin through `ctx.webServer.getOrigin()`;
 *   2. reads the process launch token through `ctx.connection.authenticatedUrl()`;
 *   3. exchanges that token once for the signed browser-session cookie;
 *   4. serves an HTTP reverse proxy on a stable local port (default 0.0.0.0:3080) that
 *      rewrites `Host`/`Origin` to the loopback authority and injects the cookie, so any
 *      LAN device only needs the token link shown in Settings → LAN access.
 *
 * WebSocket upgrades (`/api/remote.mux` and friends) are proxied at the socket level with
 * the same rewritten handshake, and the Settings page talks to a small JSON API mounted on
 * the DSH Web server itself.
 *
 * The plugin is dependency-free on purpose: a locally installed bundle is linked into the
 * profile, so only Node built-ins resolve from its directory.
 */
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'

export const name = 'dsh-lan-gateway'
export const inject = []

const API_PREFIX = '/api/dsh-lan-gateway'
const STORE_FILE = 'dsh-lan-gateway.json'
const RUNTIME = Symbol.for('dsh-lan-gateway/runtime')
const COOKIE_NAME = 'dsh_lan_session'
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const DEFAULT_PORT = 3080

/** Per-request headers that belong to one hop only. */
const HOP_REQUEST_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

/** Response headers owned by the hop (Node computes length/transfer framing itself). */
const HOP_RESPONSE_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

/** Upgrade handshakes must keep `Connection`/`Upgrade`; only per-hop proxy headers go. */
const UPGRADE_DROP_HEADERS = new Set([
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
])

/**
 * Subresources some browsers fetch without credentials (Chromium omits cookies for the Web
 * App Manifest and the favicon). The upstream serves static assets without authentication,
 * so the gate lets these through instead of breaking PWA metadata.
 */
const PUBLIC_PATHS = new Set(['/manifest.webmanifest', '/favicon.ico'])

/** OneBot v11 endpoint the startup notice talks to by default. */
const DEFAULT_ONEBOT_WS = 'ws://127.0.0.1:3001'
/** Connect + per-action timeout for the startup notice. */
const NOTIFY_TIMEOUT_MS = 15000
/** One startup announcement per process, even across plugin reloads. */
const ANNOUNCED_ROOTS = new WeakSet()

const UNAUTHORIZED_PAGE = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>需要访问令牌 · DSH 局域网访问</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0b1220; color: #e8eefc;
         font: 15px/1.7 "Segoe UI", system-ui, -apple-system, sans-serif; }
  main { width: min(440px, calc(100vw - 40px)); padding: 28px 30px; border-radius: 18px;
         background: #111a2c; border: 1px solid #23324c; box-shadow: 0 24px 60px rgba(0,0,0,.35); }
  h1 { margin: 0 0 8px; font-size: 19px; letter-spacing: .01em; }
  p { margin: 0 0 14px; color: #a9b7d0; font-size: 13.5px; }
  form { display: flex; gap: 8px; margin-top: 18px; }
  input { flex: 1; min-width: 0; padding: 9px 12px; border-radius: 9px; border: 1px solid #2b3d5c;
          background: #0d1728; color: #e8eefc; font: inherit; }
  input:focus { outline: 2px solid #3b82f6; outline-offset: 1px; }
  button { padding: 9px 16px; border-radius: 9px; border: 1px solid #3b82f6; background: #2563eb;
           color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
  button:hover { background: #1d4ed8; }
  code { background: #0d1728; border: 1px solid #23324c; border-radius: 6px; padding: 1px 6px; font-size: 12.5px; }
  .hint { margin-top: 16px; font-size: 12px; color: #7f8ea8; }
</style>
</head>
<body>
<main>
  <h1>需要访问令牌</h1>
  <p>这个地址由 DSH 局域网访问网关提供，需要在 DSH 的「设置 → 局域网访问」中复制带令牌的链接。</p>
  <form method="get" action="/">
    <input name="token" type="text" autocomplete="off" spellcheck="false" placeholder="粘贴访问令牌">
    <button type="submit">进入</button>
  </form>
  <p class="hint">Access token required. Open <code>Settings → LAN access</code> in DSH and copy the token link.</p>
</main>
</body>
</html>`

/* ----------------------------------------------------------------- runtime */

function runtime() {
  if (globalThis[RUNTIME] === undefined) {
    globalThis[RUNTIME] = {
      ctx: undefined,
      settings: normalize({}),
      defaults: normalize({}),
      storePath: '',
      server: undefined,
      listening: false,
      actualPort: 0,
      startedAt: 0,
      upstream: undefined,
      token: '',
      tokenUrl: '',
      secret: randomBytes(32),
      cookie: { value: '', expiresAt: 0, pending: undefined },
      requests: 0,
      errors: 0,
      connections: 0,
      upgraded: new Set(),
      starting: undefined,
      notify: { at: 0, ok: false, error: '', delivered: [], failed: [], token: '', content: '', ms: 0 },
      lastError: '',
    }
  }
  return globalThis[RUNTIME]
}

/* ---------------------------------------------------------------- settings */

function normalizeBaseUrl(value) {
  if (typeof value !== 'string') return ''
  const text = value.trim()
  if (text === '') return ''
  try {
    const url = new URL(text)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    // token is appended by the connection service; a path would be reset anyway.
    return url.origin
  } catch {
    return ''
  }
}

function normalizeTargetId(value) {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function normalize(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const port = Number(source.port)
  const timeout = Number(source.notifyTimeoutMs)
  return {
    enabled: source.enabled !== false,
    port: Number.isInteger(port) && port >= 1 && port <= 65535 ? port : DEFAULT_PORT,
    bindHost: typeof source.bindHost === 'string' && source.bindHost.trim() !== '' ? source.bindHost.trim() : '0.0.0.0',
    requireToken: source.requireToken !== false,
    publicUrl: normalizeBaseUrl(source.publicUrl),
    notifyOnStartup: source.notifyOnStartup !== false,
    notifyGroup: source.notifyGroup === true,
    groupId: normalizeTargetId(source.groupId),
    notifyPrivate: source.notifyPrivate === true,
    userId: normalizeTargetId(source.userId),
    oneBotWsUrl: typeof source.oneBotWsUrl === 'string' && source.oneBotWsUrl.trim() !== '' ? source.oneBotWsUrl.trim() : DEFAULT_ONEBOT_WS,
    oneBotAccessToken: typeof source.oneBotAccessToken === 'string' ? source.oneBotAccessToken : '',
    notifyTitle: typeof source.notifyTitle === 'string' ? source.notifyTitle : 'DSH 已启动',
    includeTimestamp: source.includeTimestamp !== false,
    notifyTimeoutMs: Number.isInteger(timeout) && timeout >= 1000 && timeout <= 60000 ? timeout : NOTIFY_TIMEOUT_MS,
  }
}

function publicSettings(settings) {
  return {
    enabled: settings.enabled,
    port: settings.port,
    bindHost: settings.bindHost,
    requireToken: settings.requireToken,
    publicUrl: settings.publicUrl,
    notifyOnStartup: settings.notifyOnStartup,
    notifyGroup: settings.notifyGroup,
    groupId: settings.groupId,
    notifyPrivate: settings.notifyPrivate,
    userId: settings.userId,
    oneBotWsUrl: settings.oneBotWsUrl,
    // The access token never leaves the Host process; only its presence is exposed.
    oneBotTokenSet: settings.oneBotAccessToken !== '',
    notifyTitle: settings.notifyTitle,
    includeTimestamp: settings.includeTimestamp,
  }
}

/* -------------------------------------------------------------- persistence */

function storeCandidates() {
  const candidates = []
  if (typeof process.env.DSH_PROFILE_DIR === 'string' && process.env.DSH_PROFILE_DIR !== '') {
    candidates.push(path.join(process.env.DSH_PROFILE_DIR, STORE_FILE))
  }
  if (typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME !== '') {
    candidates.push(path.join(process.env.DSH_HOME, STORE_FILE))
  }
  candidates.push(path.join(os.homedir(), '.dsh', STORE_FILE))
  return candidates
}

function loadStore() {
  const rt = runtime()
  for (const candidate of storeCandidates()) {
    try {
      if (!fs.existsSync(candidate)) continue
      const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'))
      rt.storePath = candidate
      return normalize(parsed)
    } catch (error) {
      rt.lastError = `读取配置失败：${error?.message ?? error}`
      rt.storePath = candidate
      return undefined
    }
  }
  rt.storePath = storeCandidates()[0] ?? ''
  return undefined
}

function saveStore(settings) {
  const rt = runtime()
  const target = rt.storePath !== '' ? rt.storePath : storeCandidates()[0]
  if (target === undefined || target === '') return '找不到可写的配置位置'
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    const temporary = `${target}.tmp`
    fs.writeFileSync(temporary, `${JSON.stringify({ ...settings }, null, 2)}\n`, 'utf8')
    fs.renameSync(temporary, target)
    rt.storePath = target
    return ''
  } catch (error) {
    return `保存配置失败：${error?.message ?? error}`
  }
}

/* ------------------------------------------------------------- upstream facts */

function resolveUpstream() {
  const rt = runtime()
  if (rt.upstream !== undefined) return rt.upstream
  const ctx = rt.ctx
  if (ctx === undefined) return undefined
  try {
    const webServer = ctx.get('webServer')
    if (webServer === undefined || typeof webServer.getOrigin !== 'function') return undefined
    const origin = webServer.getOrigin()
    const url = new URL(origin)
    const protocol = url.protocol === 'https:' ? 'https:' : 'http:'
    rt.upstream = {
      origin,
      protocol,
      host: url.hostname.replace(/^\[/, '').replace(/\]$/, ''),
      port: Number(url.port || (protocol === 'https:' ? 443 : 80)),
      authority: url.host,
    }
    return rt.upstream
  } catch {
    return undefined
  }
}

function resolveToken() {
  const rt = runtime()
  if (rt.token !== '') return rt.token
  const upstream = resolveUpstream()
  const ctx = rt.ctx
  if (upstream === undefined || ctx === undefined) return ''
  const connection = ctx.get('connection')
  if (connection === undefined || typeof connection.authenticatedUrl !== 'function') return ''
  try {
    const authenticated = connection.authenticatedUrl(upstream.origin)
    const token = new URL(authenticated).searchParams.get('token') ?? ''
    if (token !== '') {
      rt.token = token
      rt.tokenUrl = authenticated
    }
  } catch (error) {
    rt.lastError = `读取访问令牌失败：${error?.message ?? error}`
  }
  return rt.token
}

/* ---------------------------------------------------------- session signature */

function safeEqual(left, right) {
  const a = Buffer.from(String(left))
  const b = Buffer.from(String(right))
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function sessionValue(expiresAt) {
  const mac = createHmac('sha256', runtime().secret).update(`v1.${expiresAt}`).digest('base64url')
  return `v1.${expiresAt}.${mac}`
}

function sessionValid(value) {
  if (typeof value !== 'string' || value === '') return false
  const parts = value.split('.')
  if (parts.length !== 3 || parts[0] !== 'v1') return false
  const expiresAt = Number(parts[1])
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false
  return safeEqual(parts[2], sessionValue(expiresAt).split('.')[2])
}

function readCookie(header, name) {
  if (typeof header !== 'string' || header === '') return ''
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim()
  }
  return ''
}

/**
 * Gate one HTTP request.
 *
 * @returns `'allow'` when the request may proceed; `'sent'` when this call already wrote
 *          a redirect or an error response.
 */
function gate(req, res) {
  const rt = runtime()
  if (rt.settings.requireToken !== true) return 'allow'
  let url
  try {
    url = new URL(req.url ?? '/', 'http://gateway.invalid')
  } catch {
    url = undefined
  }
  if (url !== undefined && PUBLIC_PATHS.has(url.pathname)) return 'allow'
  const token = resolveToken()
  if (token === '') {
    // Fail closed: the token is only unreadable for the first moments of a process (or a
    // broken Connection service). Never serve the UI unauthenticated on a LAN socket.
    const payload = 'dsh-lan-gateway: 访问令牌尚未就绪，请稍后重试\n'
    res.writeHead(503, {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'retry-after': '2',
      'content-length': Buffer.byteLength(payload),
    })
    res.end(payload)
    return 'sent'
  }
  if (sessionValid(readCookie(req.headers.cookie, COOKIE_NAME))) return 'allow'

  const provided = url?.searchParams.get('token') ?? null
  if (provided !== null && provided !== '' && safeEqual(provided, token)) {
    url.searchParams.delete('token')
    const location = `${url.pathname}${url.search}` || '/'
    const maxAge = Math.floor(SESSION_MAX_AGE_MS / 1000)
    res.writeHead(302, {
      location,
      'cache-control': 'no-store',
      'set-cookie': `${COOKIE_NAME}=${sessionValue(Date.now() + SESSION_MAX_AGE_MS)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax`,
    })
    res.end()
    return 'sent'
  }

  const payload = UNAUTHORIZED_PAGE
  res.writeHead(401, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
  return 'sent'
}

/* ------------------------------------------------------------ upstream cookie */

/**
 * Exchange the process launch token for the signed browser-session cookie.
 * The cookie is minted for the loopback authority, which is exactly the `Host` every
 * proxied request carries upstream, so one cookie serves every LAN client.
 */
function exchangeCookie() {
  const rt = runtime()
  if (rt.cookie.pending !== undefined) return rt.cookie.pending
  const upstream = resolveUpstream()
  const token = resolveToken()
  if (upstream === undefined) return Promise.reject(new Error('DSH 上游服务尚未就绪'))
  if (token === '') return Promise.reject(new Error('尚未读取到 DSH 访问令牌'))
  const client = upstream.protocol === 'https:' ? https : http

  rt.cookie.pending = new Promise((resolve, reject) => {
    const request = client.request(
      {
        host: upstream.host,
        port: upstream.port,
        method: 'GET',
        path: `/?token=${encodeURIComponent(token)}`,
        headers: {
          host: upstream.authority,
          accept: 'text/html,application/xhtml+xml',
          'user-agent': 'dsh-lan-gateway',
        },
        // The loopback listener may use a self-signed certificate when TLS is configured.
        rejectUnauthorized: false,
        timeout: 10000,
      },
      (response) => {
        response.resume()
        const header = response.headers['set-cookie']
        const raw = Array.isArray(header) ? header[0] : header
        if (typeof raw !== 'string' || raw === '') {
          reject(new Error(`上游未返回会话 Cookie（HTTP ${response.statusCode ?? 0}）`))
          return
        }
        const pair = raw.split(';')[0].trim()
        const equals = pair.indexOf('=')
        if (equals <= 0) {
          reject(new Error('上游会话 Cookie 格式无法识别'))
          return
        }
        let expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000
        const maxAge = /max-age=(\d+)/i.exec(raw)
        const expires = /expires=([^;]+)/i.exec(raw)
        if (maxAge !== null) expiresAt = Date.now() + Number(maxAge[1]) * 1000
        else if (expires !== null) {
          const parsed = Date.parse(expires[1])
          if (Number.isFinite(parsed)) expiresAt = parsed
        }
        rt.cookie.value = pair
        rt.cookie.expiresAt = expiresAt
        resolve(pair)
      },
    )
    request.once('timeout', () => request.destroy(new Error('获取上游会话超时')))
    request.once('error', reject)
    request.end()
  }).finally(() => {
    rt.cookie.pending = undefined
  })
  return rt.cookie.pending
}

async function upstreamCookie(force = false) {
  const rt = runtime()
  if (!force && rt.cookie.value !== '' && rt.cookie.expiresAt > Date.now() + 5000) return rt.cookie.value
  try {
    return await exchangeCookie()
  } catch (error) {
    if (rt.cookie.value !== '' && rt.cookie.expiresAt > Date.now()) return rt.cookie.value
    throw error
  }
}

/* ------------------------------------------------------------------- proxying */

/**
 * Rewrite a same-origin browser `Origin` to the loopback authority so the upstream
 * Host/Origin fence accepts it. A cross-origin `Origin` is forwarded unchanged (and the
 * upstream answers 403), which keeps the fence's CSRF protection intact.
 */
function upstreamOrigin(req, upstream) {
  const raw = req.headers.origin
  if (typeof raw !== 'string' || raw === '') return undefined
  let origin
  try {
    origin = new URL(raw)
  } catch {
    return raw
  }
  if (origin.protocol !== 'http:' && origin.protocol !== 'https:') return raw
  const allowed = new Set()
  if (typeof req.headers.host === 'string' && req.headers.host !== '') allowed.add(req.headers.host.toLowerCase())
  if (runtime().settings.publicUrl !== '') {
    try {
      allowed.add(new URL(runtime().settings.publicUrl).host.toLowerCase())
    } catch {}
  }
  if (allowed.has(origin.host.toLowerCase())) return `${upstream.protocol}//${upstream.authority}`
  return raw
}

function upstreamHeaders(req, upstream, cookie) {
  const headers = {}
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    const lower = key.toLowerCase()
    if (HOP_REQUEST_HEADERS.has(lower)) continue
    if (lower === 'host' || lower === 'origin' || lower === 'cookie' || lower === 'referer') continue
    headers[lower] = value
  }
  headers.host = upstream.authority
  headers.cookie = cookie
  const origin = upstreamOrigin(req, upstream)
  if (origin !== undefined) headers.origin = origin
  headers['x-forwarded-proto'] = 'http'
  if (typeof req.headers.host === 'string') headers['x-forwarded-host'] = req.headers.host
  return headers
}

function rewriteLocation(value, upstream) {
  if (typeof value !== 'string' || value === '') return value
  try {
    const target = new URL(value, `${upstream.origin}/`)
    if (target.origin === new URL(upstream.origin).origin) return `${target.pathname}${target.search}${target.hash}`
  } catch {}
  return value
}

function isGatewaySave(req) {
  if (req.method !== 'POST') return false
  try {
    return new URL(req.url ?? '/', 'http://gateway.invalid').pathname.replace(/\/+$/, '') === `${API_PREFIX}/save`
  } catch {
    return false
  }
}

function writeProxyResponse(req, res, upstreamResponse, upstream) {
  const headers = {}
  for (const [key, value] of Object.entries(upstreamResponse.headers)) {
    if (value === undefined) continue
    const lower = key.toLowerCase()
    if (HOP_RESPONSE_HEADERS.has(lower) || lower === 'set-cookie') continue
    headers[lower] = value
  }
  if (typeof headers.location === 'string') headers.location = rewriteLocation(headers.location, upstream)
  // Turning the token requirement on from a LAN page must not disconnect that same page:
  // the save response itself mints its gate cookie.
  const rt = runtime()
  if (
    isGatewaySave(req) &&
    (upstreamResponse.statusCode ?? 0) === 200 &&
    rt.settings.requireToken === true &&
    rt.token !== '' &&
    !sessionValid(readCookie(req.headers.cookie, COOKIE_NAME))
  ) {
    headers['set-cookie'] = `${COOKIE_NAME}=${sessionValue(Date.now() + SESSION_MAX_AGE_MS)}; Path=/; Max-Age=${Math.floor(SESSION_MAX_AGE_MS / 1000)}; HttpOnly; SameSite=Lax`
  }
  try {
    res.writeHead(upstreamResponse.statusCode ?? 502, headers)
  } catch {
    res.destroy()
    return
  }
  upstreamResponse.pipe(res)
  upstreamResponse.once('error', () => res.destroy())
}

function sendText(res, status, message) {
  const payload = `dsh-lan-gateway: ${message}\n`
  try {
    res.writeHead(status, {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(payload),
    })
    res.end(payload)
  } catch {}
}

async function proxyHttp(req, res, retried) {
  const rt = runtime()
  if (rt.settings.enabled !== true) {
    sendText(res, 503, '网关已停止')
    return
  }
  const outcome = gate(req, res)
  if (outcome !== 'allow') return

  const upstream = resolveUpstream()
  if (upstream === undefined) {
    sendText(res, 503, 'DSH 上游服务尚未就绪')
    return
  }

  let cookie
  try {
    cookie = await upstreamCookie(retried)
  } catch (error) {
    rt.errors += 1
    rt.lastError = `登录上游失败：${error?.message ?? error}`
    sendText(res, 502, `无法登录 DSH 上游：${error?.message ?? error}`)
    return
  }

  const client = upstream.protocol === 'https:' ? https : http
  const proxyRequest = client.request(
    {
      host: upstream.host,
      port: upstream.port,
      method: req.method,
      path: req.url,
      headers: upstreamHeaders(req, upstream, cookie),
      rejectUnauthorized: false,
    },
    (upstreamResponse) => {
      const status = upstreamResponse.statusCode ?? 502
      const retryable = req.method === 'GET' || req.method === 'HEAD'
      if ((status === 401 || status === 403) && retryable && retried !== true) {
        upstreamResponse.resume()
        rt.cookie.value = ''
        rt.cookie.expiresAt = 0
        proxyHttp(req, res, true).catch((error) => {
          rt.errors += 1
          rt.lastError = `重试失败：${error?.message ?? error}`
          sendText(res, 502, `上游拒绝访问：${error?.message ?? error}`)
        })
        return
      }
      writeProxyResponse(req, res, upstreamResponse, upstream)
    },
  )

  proxyRequest.once('error', (error) => {
    rt.errors += 1
    rt.lastError = `转发失败：${error?.message ?? error}`
    if (!res.headersSent) sendText(res, 502, `转发失败：${error?.message ?? error}`)
    else res.destroy()
  })
  res.once('close', () => {
    if (!res.writableEnded) proxyRequest.destroy()
  })

  if (req.method === 'GET' || req.method === 'HEAD') proxyRequest.end()
  else req.pipe(proxyRequest)
}

function rejectUpgrade(socket, status) {
  try {
    socket.write(`HTTP/1.1 ${status} ${status === 401 ? 'Unauthorized' : 'Service Unavailable'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
  } catch {}
  socket.destroy()
}

function handleUpgrade(req, socket, head) {
  const rt = runtime()
  socket.on('error', () => {})
  rt.upgraded.add(socket)
  socket.once('close', () => rt.upgraded.delete(socket))
  if (rt.settings.enabled !== true) {
    rejectUpgrade(socket, 503)
    return
  }
  if (rt.settings.requireToken === true) {
    const token = resolveToken()
    if (token === '') {
      rejectUpgrade(socket, 503)
      return
    }
    if (!sessionValid(readCookie(req.headers.cookie, COOKIE_NAME))) {
      rejectUpgrade(socket, 401)
      return
    }
  }
  const upstream = resolveUpstream()
  if (upstream === undefined) {
    rejectUpgrade(socket, 503)
    return
  }

  let cookie
  try {
    cookie = upstreamCookie(false)
  } catch {
    rejectUpgrade(socket, 502)
    return
  }
  cookie.then((value) => {
    const target = net.connect({ host: upstream.host, port: upstream.port })
    let settled = false
    target.once('connect', () => {
      settled = true
      const lines = [`${req.method ?? 'GET'} ${req.url ?? '/'} HTTP/1.1`]
      const raw = req.rawHeaders ?? []
      for (let index = 0; index < raw.length; index += 2) {
        const headerName = raw[index]
        const headerValue = raw[index + 1]
        const lower = String(headerName).toLowerCase()
        if (UPGRADE_DROP_HEADERS.has(lower)) continue
        if (lower === 'host' || lower === 'origin' || lower === 'cookie') continue
        lines.push(`${headerName}: ${headerValue}`)
      }
      lines.push(`Host: ${upstream.authority}`)
      const origin = upstreamOrigin(req, upstream)
      if (origin !== undefined) lines.push(`Origin: ${origin}`)
      lines.push(`Cookie: ${value}`)
      target.write(`${lines.join('\r\n')}\r\n\r\n`)
      if (head !== undefined && head.length > 0) target.write(head)
      target.pipe(socket)
      socket.pipe(target)
    })
    socket.once('close', () => target.destroy())
    target.once('error', () => socket.destroy())
    target.once('close', () => {
      if (!settled) socket.destroy()
    })
  }).catch((error) => {
    rt.errors += 1
    rt.lastError = `升级连接失败：${error?.message ?? error}`
    rejectUpgrade(socket, 502)
  })
}

/* -------------------------------------------------------------------- server */

async function startProxy() {
  const rt = runtime()
  if (rt.server !== undefined || rt.settings.enabled !== true) return
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const server = http.createServer((req, res) => {
      rt.requests += 1
      proxyHttp(req, res, false).catch((error) => {
        rt.errors += 1
        rt.lastError = `请求处理失败：${error?.message ?? error}`
        if (!res.headersSent) sendText(res, 500, `请求处理失败：${error?.message ?? error}`)
        else res.destroy()
      })
    })
    server.on('upgrade', (req, socket, head) => {
      try {
        handleUpgrade(req, socket, head)
      } catch (error) {
        rt.errors += 1
        rt.lastError = `升级连接失败：${error?.message ?? error}`
        socket.destroy()
      }
    })
    server.on('connection', (socket) => {
      rt.connections += 1
      socket.once('close', () => {
        rt.connections = Math.max(0, rt.connections - 1)
      })
    })
    server.requestTimeout = 0
    server.headersTimeout = 60000
    rt.server = server

    const error = await new Promise((resolve) => {
      const fail = (cause) => {
        server.removeListener('listening', ok)
        resolve(cause)
      }
      const ok = () => {
        server.removeListener('error', fail)
        resolve(undefined)
      }
      server.once('error', fail)
      server.once('listening', ok)
      try {
        server.listen({ host: rt.settings.bindHost, port: rt.settings.port })
      } catch (cause) {
        server.removeListener('listening', ok)
        server.removeListener('error', fail)
        resolve(cause)
      }
    })

    if (error === undefined) {
      server.on('error', (cause) => {
        rt.errors += 1
        rt.lastError = `网关错误：${cause?.message ?? cause}`
      })
      rt.listening = true
      rt.actualPort = Number(server.address()?.port ?? rt.settings.port)
      rt.startedAt = Date.now()
      rt.lastError = ''
      return
    }

    rt.errors += 1
    rt.lastError = `监听 ${rt.settings.bindHost}:${rt.settings.port} 失败：${error?.message ?? error}`
    rt.listening = false
    rt.server = undefined
    try {
      server.close()
    } catch {}
    if (error?.code !== 'EADDRINUSE') return
    // A hot reload can overlap the previous listener's close; retry briefly.
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
}

function stopProxy() {
  const rt = runtime()
  const server = rt.server
  rt.server = undefined
  rt.listening = false
  rt.actualPort = 0
  rt.connections = 0
  for (const socket of rt.upgraded) {
    try {
      socket.destroy()
    } catch {}
  }
  rt.upgraded.clear()
  if (server === undefined) return Promise.resolve()
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      resolve()
    }
    try {
      server.close(finish)
    } catch {
      finish()
    }
    try {
      server.closeAllConnections?.()
    } catch {}
    setTimeout(finish, 800)
  })
}

async function restartProxy() {
  await stopProxy()
  await startProxy()
}

/* --------------------------------------------------------------- onebot push */

/** Local `YYYY-MM-DD HH:mm:ss` stamp used by the startup notice. */
function formatTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** Configured delivery targets: groups and private chats are independent. */
function notifyTargets(settings) {
  const targets = []
  if (settings.notifyGroup === true && settings.groupId !== '') targets.push({ kind: 'group', id: settings.groupId })
  if (settings.notifyPrivate === true && settings.userId !== '') targets.push({ kind: 'user', id: settings.userId })
  return targets
}

/** Build a OneBot v11 forward-WebSocket URL; the token goes into `access_token`. */
function oneBotUrl(wsUrl, accessToken) {
  const text = String(wsUrl ?? '').trim()
  if (text === '') return undefined
  let url
  try {
    url = new URL(text)
  } catch {
    return undefined
  }
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') return undefined
  const token = String(accessToken ?? '').trim()
  if (token !== '') url.searchParams.set('access_token', token)
  return url.href
}

/** OneBot text segment keeps URLs containing `[`, `]`, `&` out of CQ parsing. */
function textSegment(content) {
  return [{ type: 'text', data: { text: String(content ?? '') } }]
}

function assertOneBotOk(action, response) {
  const code = typeof response?.retcode === 'number' ? response.retcode : undefined
  const failed = response?.status === 'failed' || (code !== undefined && code !== 0)
  if (!failed) return
  const detail = [response?.message, response?.wording]
    .filter((part) => typeof part === 'string' && part !== '')
    .join(' / ')
  throw new Error(`OneBot ${action} 失败：status=${String(response?.status)} retcode=${String(code)}${detail === '' ? '' : ` ${detail}`}`)
}

/**
 * One short OneBot v11 session (connect, run actions, close). `echo` correlates a
 * request with its response; event pushes without `echo` are ignored.
 */
async function oneBotSession(options, use) {
  const { wsUrl, accessToken = '', timeoutMs = NOTIFY_TIMEOUT_MS } = options
  const target = oneBotUrl(wsUrl, accessToken)
  if (target === undefined) throw new Error(`OneBot WS 地址不合法：${JSON.stringify(wsUrl)}（需要 ws:// 或 wss://）`)
  if (typeof WebSocket !== 'function') throw new Error('当前运行时没有 WebSocket，无法推送 OneBot 消息')

  const socket = new WebSocket(target)
  const pending = new Map()
  let rejectOpen
  const opened = new Promise((resolve, reject) => {
    rejectOpen = reject
    const timer = setTimeout(() => reject(new Error(`OneBot 连接超时 ${timeoutMs}ms`)), timeoutMs)
    socket.addEventListener('open', () => {
      clearTimeout(timer)
      resolve()
    })
  })
  opened.catch(() => {})

  const abortPending = (error) => {
    rejectOpen(error)
    for (const [, waiter] of pending) waiter.reject(error)
    pending.clear()
  }

  socket.addEventListener('message', (event) => {
    let payload
    try {
      payload = JSON.parse(String(event.data))
    } catch {
      return
    }
    if (payload.echo === undefined) return
    const waiter = pending.get(payload.echo)
    if (waiter === undefined) return
    pending.delete(payload.echo)
    waiter.resolve(payload)
  })
  socket.addEventListener('error', () => abortPending(new Error('OneBot WebSocket 连接错误')))
  socket.addEventListener('close', (event) => abortPending(new Error(`OneBot WebSocket 已关闭（code=${String(event?.code ?? '?')}）`)))

  try {
    await opened
    const call = (action, params = {}) =>
      new Promise((resolve, reject) => {
        const echo = `dsh-lan-gateway:${randomUUID()}`
        const timer = setTimeout(() => {
          if (pending.delete(echo)) reject(new Error(`OneBot ${action} 超时 ${timeoutMs}ms`))
        }, timeoutMs)
        pending.set(echo, {
          resolve: (payload) => {
            clearTimeout(timer)
            resolve(payload)
          },
          reject: (error) => {
            clearTimeout(timer)
            reject(error)
          },
        })
        socket.send(JSON.stringify({ action, params, echo }))
      })
    return await use(call)
  } finally {
    try {
      socket.close()
    } catch {}
  }
}

/**
 * Deliver one text message to every target over a single connection. Per-target
 * failures are reported independently; a connection failure marks the remaining
 * targets failed.
 */
async function deliverOneBot(options) {
  const { wsUrl, accessToken, targets, content, timeoutMs } = options
  const delivered = []
  const failed = []
  if (targets.length === 0) return { delivered, failed }
  const settled = new Set()
  try {
    await oneBotSession({ wsUrl, accessToken, timeoutMs }, async (call) => {
      for (const target of targets) {
        const id = Number(target.id)
        if (!Number.isSafeInteger(id) || id <= 0) {
          failed.push({ target: target.kind, error: `目标不合法：${JSON.stringify(target.id)}（需要正整数）` })
          settled.add(target.kind)
          continue
        }
        const action = target.kind === 'group' ? 'send_group_msg' : 'send_private_msg'
        const key = target.kind === 'group' ? 'group_id' : 'user_id'
        try {
          const response = await call(action, { [key]: id, message: textSegment(content) })
          assertOneBotOk(action, response)
          delivered.push(target.kind)
        } catch (error) {
          failed.push({ target: target.kind, error: error?.message ?? String(error) })
        }
        settled.add(target.kind)
      }
    })
  } catch (error) {
    for (const target of targets) {
      if (!settled.has(target.kind)) failed.push({ target: target.kind, error: error?.message ?? String(error) })
    }
  }
  return { delivered, failed }
}

/**
 * The notice body is the launch token only; the external domain lives in settings
 * and is never expanded into a full URL here.
 */
function formatNotifyMessage(token, settings, date = new Date()) {
  const lines = []
  const title = typeof settings.notifyTitle === 'string' ? settings.notifyTitle.trim() : ''
  if (title !== '') lines.push(title)
  lines.push(token)
  if (settings.includeTimestamp !== false) lines.push(`时间：${formatTimestamp(date)}`)
  return lines.join('\n')
}

/** Send this process' launch token through OneBot; never throws for delivery errors. */
async function sendNotification(ctx, options = {}) {
  const rt = runtime()
  const settings = rt.settings
  const started = Date.now()
  if (settings.enabled !== true) return { ok: false, error: '网关未启用，跳过推送', ms: 0 }
  // Security policy: a notice is only allowed once an external domain is configured.
  if (settings.publicUrl === '') return { ok: false, error: '请先在设置里配置外部域名，再发送 QQ 通知', ms: 0 }
  const targets = notifyTargets(settings)
  if (targets.length === 0) return { ok: false, error: '未选择群聊或私聊目标', ms: 0 }
  if (settings.oneBotWsUrl === '') return { ok: false, error: '未配置 OneBot WS 地址', ms: 0 }
  const token = resolveToken()
  if (token === '') return { ok: false, error: '尚未读取到 DSH 访问令牌', ms: 0 }
  const title = options.test === true ? `${settings.notifyTitle}（测试）` : settings.notifyTitle
  const content = formatNotifyMessage(token, { ...settings, notifyTitle: title })
  let result
  try {
    result = await deliverOneBot({
      wsUrl: settings.oneBotWsUrl,
      accessToken: settings.oneBotAccessToken,
      targets,
      content,
      timeoutMs: settings.notifyTimeoutMs,
    })
  } catch (error) {
    result = { delivered: [], failed: targets.map((target) => ({ target: target.kind, error: error?.message ?? String(error) })) }
  }
  const ok = result.delivered.length > 0 && result.failed.length === 0
  rt.notify = {
    at: Date.now(),
    ok,
    error: result.failed.map((entry) => `${entry.target}: ${entry.error}`).join('; '),
    delivered: result.delivered,
    failed: result.failed.map((entry) => entry.target),
    token,
    content,
    ms: Date.now() - started,
  }
  return { ok, error: rt.notify.error, token, content, delivered: result.delivered, failed: result.failed, ms: Date.now() - started }
}

/** One startup announcement per process, after the loader tree settles. */
async function announceStartup(ctx) {
  const rt = runtime()
  if (rt.settings.notifyOnStartup !== true) return
  // The domain is the explicit opt-in for sending; without it stay silent.
  if (rt.settings.publicUrl === '') return
  // Nothing configured: stay quiet instead of warning on every boot.
  if (notifyTargets(rt.settings).length === 0) return
  const root = ctx.root ?? ctx
  if (ANNOUNCED_ROOTS.has(root)) return
  ANNOUNCED_ROOTS.add(root)
  try {
    await rt.starting
  } catch {}
  try {
    const result = await sendNotification(ctx, { startup: true })
    if (result.ok) ctx.logger?.info?.(`dsh-lan-gateway: 启动推送已发送（${result.delivered.join(', ')}）`)
    else ctx.logger?.warn?.(`dsh-lan-gateway: 启动推送未发出：${result.error}`)
  } catch (error) {
    rt.notify = { ...rt.notify, at: Date.now(), ok: false, error: error?.message ?? String(error) }
    ctx.logger?.warn?.(`dsh-lan-gateway: 启动推送失败：${error?.message ?? error}`)
  }
}

/* ------------------------------------------------------------------- status */

function lanAddresses() {
  const found = []
  for (const [interfaceName, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      const family = entry.family
      if (family !== 'IPv4' && family !== 4) continue
      if (entry.internal === true) continue
      found.push({ interfaceName, address: entry.address })
    }
  }
  return found
}

function probeHost(settings) {
  if (settings.bindHost === '0.0.0.0' || settings.bindHost === '::') return '127.0.0.1'
  return settings.bindHost
}

function accessLinks(settings, port, token) {
  const withToken = settings.requireToken === true && token !== ''
  const suffix = withToken ? `?token=${encodeURIComponent(token)}` : ''
  const links = []
  const localHost = probeHost(settings)
  links.push({ id: 'local', label: '本机', url: `http://${localHost}:${port}/${suffix}` })
  for (const nic of lanAddresses()) {
    links.push({
      id: `lan:${nic.interfaceName}:${nic.address}`,
      label: `${nic.interfaceName} · ${nic.address}`,
      url: `http://${nic.address}:${port}/${suffix}`,
    })
  }
  if (settings.publicUrl !== '') {
    const base = settings.publicUrl.replace(/\/+$/, '')
    links.push({ id: 'public', label: '外部域名', url: `${base}/${suffix}` })
  }
  return links
}

function snapshot() {
  const rt = runtime()
  const settings = rt.settings
  const upstream = resolveUpstream()
  const token = resolveToken()
  const port = rt.listening ? rt.actualPort : settings.port
  const links = accessLinks(settings, port, token)
  const publicLink = links.find((entry) => entry.id === 'public')
  const lanLink = links.find((entry) => entry.id.startsWith('lan:'))
  const primaryLink = (publicLink ?? lanLink ?? links[0])?.url ?? ''
  let warning = ''
  if (settings.requireToken === true && token === '') {
    warning = '尚未读取到 DSH 访问令牌：令牌就绪前网关会拒绝访问，请确认 Harness 正常运行后刷新。'
  } else if (settings.enabled === true && rt.listening !== true && rt.lastError !== '') {
    warning = rt.lastError
  }
  return {
    ok: true,
    settings: publicSettings(settings),
    upstream: {
      origin: upstream?.origin ?? '',
      port: upstream?.port ?? 0,
      protocol: upstream?.protocol ?? '',
    },
    token,
    tokenUrl: rt.tokenUrl,
    links,
    primaryLink,
    // The QQ notice carries the token only; expose the exact preview value.
    notifyPreview: settings.publicUrl === '' ? '' : token,
    notify: {
      onStartup: settings.notifyOnStartup,
      domainReady: settings.publicUrl !== '',
      wsUrl: settings.oneBotWsUrl,
      tokenSet: settings.oneBotAccessToken !== '',
      group: settings.notifyGroup && settings.groupId !== '',
      groupId: settings.groupId,
      private: settings.notifyPrivate && settings.userId !== '',
      userId: settings.userId,
      lastAt: rt.notify.at,
      lastOk: rt.notify.ok,
      lastError: rt.notify.error,
      lastDelivered: rt.notify.delivered,
      lastFailed: rt.notify.failed,
      lastToken: rt.notify.token,
      lastContent: rt.notify.content,
      lastMs: rt.notify.ms,
    },
    status: {
      enabled: settings.enabled,
      listening: rt.listening,
      port,
      requestedPort: settings.port,
      bindHost: settings.bindHost,
      requests: rt.requests,
      activeConnections: rt.connections,
      errors: rt.errors,
      lastError: rt.lastError,
      tokenReady: token !== '',
      cookieReady: rt.cookie.value !== '' && rt.cookie.expiresAt > Date.now(),
      startedAt: rt.startedAt,
      uptimeMs: rt.startedAt === 0 ? 0 : Math.max(0, Date.now() - rt.startedAt),
    },
    storePath: rt.storePath,
    warning,
  }
}

/* ------------------------------------------------------------------- self-test */

function probeGateway(host, port) {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const cookie = `${COOKIE_NAME}=${sessionValue(Date.now() + 60_000)}`
    const request = http.request(
      {
        host,
        port,
        method: 'GET',
        path: '/',
        headers: { host: `127.0.0.1:${port}`, cookie, accept: 'text/html' },
        timeout: 15000,
      },
      (response) => {
        const chunks = []
        let size = 0
        response.on('data', (chunk) => {
          if (size < 4096) {
            chunks.push(chunk)
            size += chunk.length
          }
        })
        response.once('end', () => {
          const body = Buffer.concat(chunks).toString('utf8')
          resolve({
            status: response.statusCode ?? 0,
            contentType: String(response.headers['content-type'] ?? ''),
            looksLikeIndex: /<!doctype html|<html/i.test(body),
            ms: Date.now() - started,
          })
        })
      },
    )
    request.once('timeout', () => request.destroy(new Error('探测网关超时')))
    request.once('error', reject)
    request.end()
  })
}

async function runSelfTest() {
  const rt = runtime()
  if (rt.listening !== true) return { ok: false, error: '网关未在监听' }
  const upstream = resolveUpstream()
  if (upstream === undefined) return { ok: false, error: 'DSH 上游服务尚未就绪' }
  if (resolveToken() === '') return { ok: false, error: '尚未读取到 DSH 访问令牌' }
  try {
    rt.cookie.value = ''
    rt.cookie.expiresAt = 0
    await upstreamCookie(true)
  } catch (error) {
    return { ok: false, error: `登录上游失败：${error?.message ?? error}`, upstream: upstream.origin }
  }
  try {
    const probe = await probeGateway(probeHost(rt.settings), rt.actualPort)
    const ok = probe.status === 200 && probe.looksLikeIndex
    return {
      ok,
      status: probe.status,
      ms: probe.ms,
      upstream: upstream.origin,
      contentType: probe.contentType,
      detail: ok ? '' : probe.looksLikeIndex ? `HTTP ${probe.status}` : '响应不是 Harness 页面',
    }
  } catch (error) {
    return { ok: false, error: `访问网关失败：${error?.message ?? error}`, upstream: upstream.origin }
  }
}

/* -------------------------------------------------------------- JSON bridge */

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

async function readBody(req) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > 1_000_000) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new Error('请求体不是合法 JSON')
  }
}

function createHandler() {
  return async function handleLanGateway(req, res) {
    const ctx = runtime().ctx
    try {
      if (ctx === undefined) {
        sendJson(res, 503, { ok: false, error: '插件尚未就绪' })
        return
      }
      const connection = ctx.get('connection')
      const rejection = connection?.requestRejection?.({ headers: req.headers })
      if (rejection !== undefined) {
        res.writeHead(rejection)
        res.end()
        return
      }
      const url = new URL(req.url ?? '/', 'http://localhost')
      const action = url.pathname.replace(/\/+$/, '').slice(API_PREFIX.length) || '/state'
      if (req.method === 'GET' && action === '/state') {
        sendJson(res, 200, snapshot())
        return
      }
      if (req.method === 'POST' && action === '/save') {
        const body = await readBody(req)
        const rt = runtime()
        const previous = rt.settings
        const incoming = body?.settings !== null && typeof body?.settings === 'object' ? body.settings : {}
        const merged = { ...previous, ...incoming }
        // A blank/omitted access token means "keep the stored one"; the page never
        // receives the secret, so it cannot echo it back.
        if (typeof incoming.oneBotAccessToken !== 'string' || incoming.oneBotAccessToken.trim() === '') {
          merged.oneBotAccessToken = previous.oneBotAccessToken
        }
        const next = normalize(merged)
        rt.settings = next
        const storeWarning = saveStore(next)
        if (previous.enabled !== next.enabled || previous.port !== next.port || previous.bindHost !== next.bindHost) {
          await restartProxy()
        }
        const state = snapshot()
        if (storeWarning !== '') state.warning = storeWarning
        sendJson(res, 200, state)
        return
      }
      if (req.method === 'POST' && action === '/test') {
        await readBody(req)
        sendJson(res, 200, { ok: true, result: await runSelfTest() })
        return
      }
      if (req.method === 'POST' && action === '/test-notify') {
        await readBody(req)
        sendJson(res, 200, { ok: true, result: await sendNotification(ctx, { test: true }) })
        return
      }
      sendJson(res, 404, { ok: false, error: `未知接口：${action}` })
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error?.message ?? String(error) })
    }
  }
}

/* --------------------------------------------------------------------- plugin */

export function apply(ctx, config) {
  const rt = runtime()
  rt.ctx = ctx
  rt.defaults = normalize(config)
  const stored = loadStore()
  rt.settings = stored ?? rt.defaults
  rt.token = ''
  rt.tokenUrl = ''
  rt.upstream = undefined
  rt.cookie.value = ''
  rt.cookie.expiresAt = 0
  rt.cookie.pending = undefined
  rt.secret = randomBytes(32)
  rt.notify = { at: 0, ok: false, error: '', delivered: [], failed: [], token: '', content: '', ms: 0 }

  rt.starting = startProxy().catch((error) => {
    rt.errors += 1
    rt.lastError = `启动网关失败：${error?.message ?? error}`
  })

  // Warm the upstream session in the background; a failure only shows in status.
  const warm = setTimeout(() => {
    if (resolveToken() !== '') upstreamCookie(false).catch(() => {})
  }, 1500)
  if (typeof warm.unref === 'function') warm.unref()

  ctx.effect(() => () => {
    clearTimeout(warm)
    return stopProxy()
  })

  ctx.inject(['webServer'], (child) => {
    try {
      child.effect(() =>
        child.webServer.register({
          kind: 'prefix',
          path: API_PREFIX,
          handler: createHandler(),
        }),
      )
    } catch (error) {
      // A hot reload can race the previous route's disposal; the surviving route reads the
      // shared runtime, so it still serves the newest settings.
      child.logger?.warn?.(`dsh-lan-gateway: ${error?.message ?? error}`)
    }
  })

  // Announce this process' access link once the whole plugin tree has settled, matching
  // the moment the Web app itself reports its URL.
  ctx.inject(['connection'], (child) => {
    const settled = child.get('loader')?.await?.()
    const run = () => {
      if (child.get('webServer') !== undefined && child.get('connection') !== undefined) void announceStartup(child)
    }
    if (settled !== undefined && typeof settled.then === 'function') settled.then(run).catch(() => {})
    else run()
  })
}

// Named exports kept for the dependency-free test harness; they do not take part in
// the loader contract (`apply`/`Config` remain the only meaningful plugin surface).
export { deliverOneBot, formatNotifyMessage, oneBotUrl, textSegment }
