/**
 * dsh-api-proxy — route this Harness' model API traffic through an HTTP/HTTPS
 * (CONNECT) proxy, selected per configured API endpoint.
 *
 * How it works: the shipped LLM adapters reach the network with the global
 * `fetch` (the OpenAI SDK resolves `globalThis.fetch` when it builds a client,
 * and pi-ai builds one client per request). Patching that single function lets
 * us tunnel only the endpoints the user selected and leave everything else
 * direct. The plugin is dependency-free on purpose: a locally installed bundle
 * is linked into the profile, so only Node built-ins resolve from its path.
 */
import http from 'node:http'
import https from 'node:https'
import tls from 'node:tls'
import zlib from 'node:zlib'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'

export const name = 'dsh-api-proxy'
export const inject = []

const API_PREFIX = '/api/dsh-api-proxy'
const STORE_FILE = 'dsh-api-proxy.json'
const RUNTIME = Symbol.for('dsh-api-proxy/runtime')
const URL_KEYS = /^(base_?url|base_?uri|api_?base|api_?url|endpoint|base)$/i
const HOP_HEADERS = ['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer']

/* ----------------------------------------------------------------- runtime */

function runtime() {
  if (globalThis[RUNTIME] === undefined) {
    globalThis[RUNTIME] = {
      settings: normalize({}),
      defaults: normalize({}),
      storePath: '',
      ctx: undefined,
      installed: false,
      originalFetch: undefined,
      agent: undefined,
      agentKey: '',
      inFlight: 0,
      proxied: 0,
      lastError: '',
    }
  }
  return globalThis[RUNTIME]
}

/* ---------------------------------------------------------------- settings */

function asStringArray(value) {
  if (!Array.isArray(value)) return []
  return value.filter((item) => typeof item === 'string' && item.trim() !== '').map((item) => item.trim())
}

function normalize(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const port = Number(source.port)
  return {
    enabled: source.enabled === true,
    host: typeof source.host === 'string' ? source.host.trim() : '',
    port: Number.isFinite(port) && port > 0 && port < 65536 ? Math.trunc(port) : 0,
    username: typeof source.username === 'string' ? source.username : '',
    password: typeof source.password === 'string' ? source.password : '',
    targets: asStringArray(source.targets),
    extraHosts: asStringArray(source.extraHosts),
    skipPrivateNetworks: source.skipPrivateNetworks !== false,
  }
}

function publicSettings(settings) {
  return {
    enabled: settings.enabled,
    host: settings.host,
    port: settings.port,
    username: settings.username,
    passwordSet: settings.password !== '',
    targets: settings.targets,
    extraHosts: settings.extraHosts,
    skipPrivateNetworks: settings.skipPrivateNetworks,
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

/* ------------------------------------------------------------ URL matching */

function parseUrl(value) {
  try {
    return new URL(String(value))
  } catch {
    return undefined
  }
}

function bareHost(hostname) {
  return hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
}

function isLoopback(host) {
  if (host === 'localhost' || host === '::1' || host === '0.0.0.0') return true
  return /^127\./.test(host)
}

function isPrivateHost(host) {
  if (host === '::1') return true
  if (/^f[cd][0-9a-f]{2}:/.test(host)) return true
  if (/^fe[89ab][0-9a-f]:/.test(host)) return true
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (v4 === null) return /\.(local|lan|internal|intranet|home\.arpa)$/.test(host)
  const [a, b] = [Number(v4[1]), Number(v4[2])]
  if (a === 10 || a === 127 || a === 0) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

/** Accepts `host`, `host:port`, `*.domain`, or a pasted URL. */
function normalizeTargetEntry(entry) {
  const text = String(entry ?? '').trim().toLowerCase()
  if (text === '') return ''
  const asUrl = parseUrl(text)
  if (asUrl !== undefined && asUrl.host !== '') return asUrl.host
  return text.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
}

function matchesTarget(entry, host, hostPort) {
  const pattern = normalizeTargetEntry(entry)
  if (pattern === '') return false
  if (pattern.startsWith('*.')) return host.endsWith(pattern.slice(1))
  if (pattern.includes(':')) return pattern === hostPort
  return pattern === host
}

function proxyEndpointKey(settings) {
  return `${settings.host}:${settings.port}:${settings.username}:${settings.password}`
}

function shouldProxy(urlText) {
  const settings = runtime().settings
  if (!settings.enabled || settings.host === '' || settings.port === 0) return false
  const url = parseUrl(urlText)
  if (url === undefined) return false
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  const host = bareHost(url.hostname)
  if (host === '') return false
  if (isLoopback(host)) return false
  if (host === bareHost(settings.host) && Number(url.port || (url.protocol === 'https:' ? 443 : 80)) === settings.port) return false
  if (settings.skipPrivateNetworks && isPrivateHost(host)) return false
  const port = url.port !== '' ? url.port : url.protocol === 'https:' ? '443' : '80'
  const hostPort = `${host}:${port}`
  const entries = [...settings.targets, ...settings.extraHosts]
  return entries.some((entry) => matchesTarget(entry, host, hostPort))
}

/* --------------------------------------------------------------- transport */

function proxyAuthorization(settings) {
  if (settings.username === '') return undefined
  const raw = `${settings.username}:${settings.password}`
  return `Basic ${Buffer.from(raw, 'utf8').toString('base64')}`
}

function openTunnel(options, settings, authorization, callback) {
  const host = options.host
  const port = Number(options.port ?? 443)
  const headers = { host: `${host}:${port}` }
  if (authorization !== undefined) headers['proxy-authorization'] = authorization
  const connect = http.request({
    host: settings.host,
    port: settings.port,
    method: 'CONNECT',
    path: `${host}:${port}`,
    headers,
    timeout: 20000,
  })
  connect.once('connect', (response, socket, head) => {
    if (response.statusCode !== 200) {
      socket.destroy()
      callback(new Error(`代理 CONNECT 失败：HTTP ${response.statusCode}`))
      return
    }
    if (head !== undefined && head.length > 0) socket.unshift(head)
    const secure = tls.connect({
      socket,
      servername: options.servername ?? host,
      ALPNProtocols: ['http/1.1'],
    })
    secure.once('secureConnect', () => {
      secure.removeListener('error', fail)
      callback(null, secure)
    })
    const fail = (error) => callback(error)
    secure.once('error', fail)
  })
  connect.once('timeout', () => connect.destroy(new Error('连接代理超时')))
  connect.once('error', (error) => callback(error))
  connect.end()
}

/**
 * `https.Agent` ignores a `createConnection` constructor option (it sets its own
 * on the prototype), so the tunnel has to be a subclass to be honoured.
 */
class TunnelAgent extends https.Agent {
  constructor(settings, authorization) {
    super({ keepAlive: true, maxSockets: 32 })
    this.target = settings
    this.authorization = authorization
  }

  createConnection(options, callback) {
    return openTunnel(options, this.target, this.authorization, callback)
  }
}

function httpsAgentFor(settings) {
  const rt = runtime()
  const key = proxyEndpointKey(settings)
  if (rt.agent !== undefined && rt.agentKey === key) return rt.agent
  try {
    rt.agent?.destroy()
  } catch {}
  rt.agent = new TunnelAgent(settings, proxyAuthorization(settings))
  rt.agentKey = key
  return rt.agent
}

function headersToObject(source) {
  const out = {}
  if (source === undefined || source === null) return out
  if (typeof source.forEach === 'function' && typeof source.get === 'function') {
    source.forEach((value, key) => {
      out[String(key).toLowerCase()] = String(value)
    })
    return out
  }
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || value === null) continue
    out[String(key).toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value)
  }
  return out
}

async function bodyBufferOf(body) {
  if (body === undefined || body === null) return undefined
  if (typeof body === 'string') return Buffer.from(body, 'utf8')
  if (Buffer.isBuffer(body)) return body
  if (body instanceof Uint8Array) return Buffer.from(body)
  if (typeof body.arrayBuffer === 'function') return Buffer.from(await body.arrayBuffer())
  if (typeof body[Symbol.asyncIterator] === 'function') {
    const chunks = []
    for await (const chunk of body) chunks.push(Buffer.from(chunk))
    return Buffer.concat(chunks)
  }
  return Buffer.from(String(body), 'utf8')
}

function responseHeadersOf(raw) {
  const headers = new Headers()
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item)
    } else {
      headers.set(key, String(value))
    }
  }
  return headers
}

function decodable(encoding) {
  const value = String(encoding ?? '').toLowerCase().trim()
  if (value === 'gzip' || value === 'x-gzip') return zlib.createGunzip()
  if (value === 'deflate') return zlib.createInflate()
  if (value === 'br') return zlib.createBrotliDecompress()
  return undefined
}

function toResponse(res, method) {
  const status = res.statusCode ?? 502
  const headers = responseHeadersOf(res.headers)
  const noBody = method === 'HEAD' || status === 204 || status === 205 || status === 304
  if (noBody) {
    res.resume()
    return new Response(null, { status, statusText: res.statusMessage, headers })
  }
  const encoder = headers.get('content-encoding')
  const decoder = decodable(encoder)
  if (decoder !== undefined) {
    headers.delete('content-encoding')
    headers.delete('content-length')
    res.pipe(decoder)
    return new Response(Readable.toWeb(decoder), { status, statusText: res.statusMessage, headers })
  }
  return new Response(Readable.toWeb(res), { status, statusText: res.statusMessage, headers })
}

function sendOnce(url, method, headers, body, signal, settings) {
  return new Promise((resolve, reject) => {
    const authorization = proxyAuthorization(settings)
    const requestHeaders = { ...headers, 'accept-encoding': 'identity' }
    for (const hop of HOP_HEADERS) delete requestHeaders[hop]
    if (body !== undefined) requestHeaders['content-length'] = String(body.length)
    let request
    try {
      if (url.protocol === 'https:') {
        requestHeaders.host = url.host
        request = https.request({
          host: url.hostname,
          port: Number(url.port || 443),
          path: `${url.pathname}${url.search}`,
          method,
          headers: requestHeaders,
          agent: httpsAgentFor(settings),
          signal,
        })
      } else {
        // Plain HTTP through a forward proxy: absolute-form request line.
        requestHeaders.host = url.host
        if (authorization !== undefined) requestHeaders['proxy-authorization'] = authorization
        request = http.request({
          host: settings.host,
          port: settings.port,
          path: url.href,
          method,
          headers: requestHeaders,
          signal,
        })
      }
    } catch (error) {
      reject(error)
      return
    }
    request.once('response', resolve)
    request.once('error', reject)
    request.end(body)
  })
}

async function proxiedFetch(input, init) {
  const rt = runtime()
  const settings = rt.settings
  let url = new URL(String(requestUrlOf(input)))
  const merged = requestInitFor(input, init)
  let method = String(merged.method ?? 'GET').toUpperCase()
  let headers = headersToObject(merged.headers)
  let body = method === 'GET' || method === 'HEAD' ? undefined : await bodyBufferOf(merged.body)
  if (body !== undefined && headers['content-type'] === undefined) {
    // Leave the content type to the caller; only set a generic one when absent.
    headers['content-type'] = 'application/octet-stream'
  }
  const redirect = merged.redirect ?? 'follow'
  let hops = 0
  for (;;) {
    rt.inFlight += 1
    let response
    try {
      response = await sendOnce(url, method, headers, body, merged.signal ?? undefined, settings)
    } finally {
      rt.inFlight -= 1
    }
    const location = response.headers.location
    const isRedirect = [301, 302, 303, 307, 308].includes(response.statusCode) && location !== undefined
    if (!isRedirect || redirect === 'manual' || redirect === 'error' || hops >= 5) {
      rt.proxied += 1
      return toResponse(response, method)
    }
    response.resume()
    url = new URL(location, url)
    hops += 1
    if (response.statusCode === 303 || ((response.statusCode === 301 || response.statusCode === 302) && method === 'POST')) {
      method = 'GET'
      body = undefined
      delete headers['content-type']
      delete headers['content-length']
    }
  }
}

function requestUrlOf(input) {
  if (typeof input === 'string') return input
  if (typeof URL !== 'undefined' && input instanceof URL) return input.href
  if (input !== null && typeof input === 'object' && typeof input.url === 'string') return input.url
  return undefined
}

function requestInitFor(input, init) {
  if (typeof input === 'string' || (typeof URL !== 'undefined' && input instanceof URL)) return init ?? {}
  const request = input
  const merged = {
    method: init?.method ?? request.method,
    headers: init?.headers ?? request.headers,
    signal: init?.signal ?? request.signal,
    redirect: init?.redirect,
    body: init?.body,
  }
  if (merged.body === undefined && request.body !== null && request.body !== undefined) {
    merged.body = request.body
  }
  return merged
}

function installInterceptor() {
  const rt = runtime()
  if (rt.installed) return
  const original = globalThis.fetch
  if (typeof original !== 'function') {
    rt.lastError = '当前运行时没有全局 fetch，代理未安装'
    return
  }
  rt.originalFetch = original
  const patched = function dshApiProxyFetch(input, init) {
    let proxied = false
    try {
      const urlText = requestUrlOf(input)
      proxied = urlText !== undefined && shouldProxy(urlText)
    } catch {
      proxied = false
    }
    if (!proxied) return original.call(globalThis, input, init)
    return proxiedFetch(input, init).catch((error) => {
      runtime().lastError = `代理请求失败：${error?.message ?? error}`
      throw error
    })
  }
  patched.__dshApiProxy = true
  globalThis.fetch = patched
  rt.installed = true
}

function uninstallInterceptor() {
  const rt = runtime()
  if (!rt.installed) return
  if (typeof globalThis.fetch === 'function' && globalThis.fetch.__dshApiProxy === true && rt.originalFetch !== undefined) {
    globalThis.fetch = rt.originalFetch
  }
  try {
    rt.agent?.destroy()
  } catch {}
  rt.agent = undefined
  rt.agentKey = ''
  rt.originalFetch = undefined
  rt.installed = false
}

/* ------------------------------------------------------- API endpoint discovery */

function collectEndpoints(value, label, out, seen, depth) {
  if (value === null || typeof value !== 'object' || depth > 8) return
  if (seen.has(value)) return
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) collectEndpoints(item, label, out, seen, depth + 1)
    return
  }
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === 'string') {
      if (!URL_KEYS.test(key)) continue
      const url = parseUrl(child)
      if (url === undefined || (url.protocol !== 'http:' && url.protocol !== 'https:')) continue
      const host = bareHost(url.hostname)
      const port = url.port !== '' ? url.port : url.protocol === 'https:' ? '443' : '80'
      const id = `${host}:${port}`
      if (out.has(id)) continue
      out.set(id, {
        id,
        host,
        port,
        baseURL: child,
        label: label !== '' ? label : id,
        private: isPrivateHost(host),
      })
      continue
    }
    collectEndpoints(child, key, out, seen, depth + 1)
  }
}

function detectEndpoints(ctx) {
  const found = new Map()
  const seen = new Set()
  try {
    for (const descriptor of ctx.get('settings')?.describe?.() ?? []) {
      collectEndpoints(descriptor?.value, '', found, seen, 0)
    }
  } catch {}
  try {
    for (const entry of ctx.get('configEditor')?.entries?.() ?? []) {
      collectEndpoints(entry?.config, String(entry?.name ?? entry?.id ?? ''), found, seen, 0)
    }
  } catch {}
  return [...found.values()].sort((left, right) => left.label.localeCompare(right.label))
}

/* ------------------------------------------------------------- JSON bridge */

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

function snapshot(ctx) {
  const rt = runtime()
  return {
    settings: publicSettings(rt.settings),
    endpoints: detectEndpoints(ctx),
    storePath: rt.storePath,
    status: {
      installed: rt.installed,
      proxied: rt.proxied,
      inFlight: rt.inFlight,
      lastError: rt.lastError,
    },
  }
}

async function testProxy(body) {
  const candidate = normalize({
    enabled: true,
    host: body?.host,
    port: body?.port,
    username: body?.username,
    password: body?.password,
  })
  if (candidate.host === '' || candidate.port === 0) return { ok: false, error: '请先填写代理 IP 与端口' }
  const target = parseUrl(body?.url)
  if (target === undefined) return { ok: false, error: '缺少可测试的目标地址' }
  const started = Date.now()
  try {
    const previous = runtime().settings
    runtime().settings = { ...candidate, targets: ['*'], extraHosts: [], skipPrivateNetworks: false }
    try {
      const response = await proxiedFetch(target.href, {
        method: 'GET',
        headers: { accept: '*/*', 'user-agent': 'dsh-api-proxy/test' },
        signal: AbortSignal.timeout(12000),
        redirect: 'follow',
      })
      try {
        await response.body?.cancel()
      } catch {}
      return {
        ok: true,
        status: response.status,
        ms: Date.now() - started,
        url: target.href,
        proxy: `${candidate.host}:${candidate.port}`,
      }
    } finally {
      runtime().settings = previous
    }
  } catch (error) {
    return {
      ok: false,
      error: error?.message ?? String(error),
      code: error?.code ?? error?.cause?.code ?? '',
      url: target.href,
      proxy: `${candidate.host}:${candidate.port}`,
      ms: Date.now() - started,
    }
  }
}

function createHandler() {
  return async function handleApiProxy(req, res) {
    const ctx = runtime().ctx
    try {
      if (ctx === undefined) {
        sendJson(res, 503, { ok: false, error: '插件尚未就绪' })
        return
      }
      const url = new URL(req.url ?? '/', 'http://localhost')
      const action = url.pathname.replace(/\/+$/, '').slice(API_PREFIX.length) || '/state'
      if (req.method === 'GET' && action === '/state') {
        sendJson(res, 200, { ok: true, ...snapshot(ctx) })
        return
      }
      if (req.method === 'POST' && action === '/save') {
        const body = await readBody(req)
        const rt = runtime()
        const next = normalize({ ...body?.settings, password: body?.settings?.password ?? rt.settings.password })
        rt.settings = next
        rt.agent?.destroy()
        rt.agent = undefined
        rt.agentKey = ''
        const warning = saveStore(next)
        sendJson(res, 200, { ok: true, warning, ...snapshot(ctx) })
        return
      }
      if (req.method === 'POST' && action === '/test') {
        const body = await readBody(req)
        sendJson(res, 200, { ok: true, result: await testProxy(body) })
        return
      }
      sendJson(res, 404, { ok: false, error: `未知接口：${action}` })
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error?.message ?? String(error) })
    }
  }
}

/* ------------------------------------------------------------------- plugin */

export function apply(ctx, config) {
  const rt = runtime()
  rt.ctx = ctx
  rt.defaults = normalize(config)
  const stored = loadStore()
  rt.settings = stored ?? rt.defaults
  installInterceptor()
  ctx.effect(() => () => {
    uninstallInterceptor()
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
      // A reload can race the previous route's disposal; the surviving route reads
      // the shared runtime, so it still serves the newest settings.
      child.logger?.warn?.(`dsh-api-proxy: ${error?.message ?? error}`)
    }
  })
}
