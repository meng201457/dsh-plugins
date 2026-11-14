/**
 * Xiaomi account + Xiaomi Cloud notes over plain Node HTTP.
 *
 * No browser, no CDP, no cookie import: the login is the account service's own
 * QR long-polling flow, and every token stays on the Host. The two halves are
 * kept apart on purpose:
 *
 *  - Account endpoints (account.xiaomi.com) take the device cookie set and
 *    answer with the `&&&START&&&`-guarded JSON the web client also gets.
 *  - Notes endpoints (i.mi.com) take only `serviceToken` + `userId`.
 *
 * A `serviceToken` lives for minutes, so an expired one is not an error the
 * user must act on: `refreshSession` restores it from the long-lived
 * `passToken`, and `callNotes` performs that restore once per rejected
 * request. Only a rejected `passToken` needs a new QR scan.
 */

export const HOST_DRIVE = 'https://i.mi.com'
export const HOST_ACCOUNT = 'https://account.xiaomi.com'

const LOGIN_BOOT_URL = HOST_DRIVE + '/api/user/login?followUp=https%3A%2F%2Fi.mi.com%2F&_locale=zh_CN'
const NOTES_LIST_PATH = '/note/full/page/'
const QR_POLL_HEADROOM_MS = 30_000
const MAX_REDIRECT_HOPS = 6

const NOTES_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/** Hosts this plugin is willing to send account credentials to. */
const ACCOUNT_SUFFIXES = ['.xiaomi.com', '.mi.com', '.xiaomi.com.cn', '.mi.com.cn']

/* ------------------------------------------------------------------ errors */

export class XiaomiError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'XiaomiError'
    this.code = code
    this.details = details
  }
}

/** Stable codes the settings page and the tool relay to the user. */
export const ERROR_CODES = {
  network: 'mi-note/network',
  timeout: 'mi-note/timeout',
  hostRejected: 'mi-note/host-rejected',
  protocol: 'mi-note/protocol',
  unauthorized: 'mi-note/unauthorized',
  needsScan: 'mi-note/needs-scan',
  accessDenied: 'mi-note/access-denied',
  qrExpired: 'mi-note/qr-expired',
  qrCancelled: 'mi-note/qr-cancelled',
  qrFailed: 'mi-note/qr-failed',
}

/* ----------------------------------------------------------------- helpers */

/** Remove the account service's JSON guard prefix. */
export function stripStart(text) {
  const trimmed = typeof text === 'string' ? text.replace(/^\uFEFF/, '').trim() : ''
  return trimmed.startsWith('&&&START&&&') ? trimmed.slice('&&&START&&&'.length) : trimmed
}

export function isXiaomiHost(rawUrl) {
  let parsed
  try {
    parsed = new URL(rawUrl)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  const host = parsed.hostname.toLowerCase()
  return ACCOUNT_SUFFIXES.some(suffix => host.endsWith(suffix)) || host === 'mi.com' || host === 'xiaomi.com'
}

function assertXiaomiHost(rawUrl, purpose) {
  if (!isXiaomiHost(rawUrl)) {
    throw new XiaomiError(ERROR_CODES.hostRejected, 'Refused a non-Xiaomi HTTPS address while ' + purpose)
  }
  return rawUrl
}

function withJsonFlag(rawUrl) {
  const separator = rawUrl.includes('?') ? '&' : '?'
  return rawUrl + separator + '_json=true'
}

function accountCookie(deviceId) {
  return 'deviceId=' + deviceId + '; pass_ua=web; uLocale=zh_CN'
}

function accountHeaders(deviceId) {
  return {
    cookie: accountCookie(deviceId),
    'user-agent': NOTES_USER_AGENT,
    origin: HOST_ACCOUNT,
    referer: HOST_ACCOUNT + '/',
    'x-requested-with': 'XMLHttpRequest',
  }
}

/** Notes endpoints authenticate with the short-lived service cookie alone. */
function notesCookie(creds) {
  return 'serviceToken=' + creds.serviceToken + '; userId=' + creds.userId
}

function notesHeaders(creds) {
  return {
    cookie: notesCookie(creds),
    'user-agent': NOTES_USER_AGENT,
    origin: HOST_DRIVE,
    referer: HOST_DRIVE + '/note/h5',
    accept: 'application/json, text/plain, */*',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
  }
}

/** Combine the caller's cancellation with one request deadline. */
function signalsOf(timeoutMs, outer) {
  return {
    signal: timeoutMs > 0 ? AbortSignal.any([outer, AbortSignal.timeout(timeoutMs)].filter(Boolean)) : outer,
    owned: timeoutMs > 0,
  }
}

function describeFetchError(error) {
  if (error?.name === 'TimeoutError') return new XiaomiError(ERROR_CODES.timeout, '小米服务没有在预期时间内响应')
  if (error?.name === 'AbortError') return new XiaomiError(ERROR_CODES.network, '请求已取消')
  return new XiaomiError(ERROR_CODES.network, '无法连接小米服务：' + (error?.message ?? String(error)))
}

/* -------------------------------------------------------------------- http */

/**
 * One HTTP exchange that keeps the raw response so callers can read
 * `Set-Cookie` per hop.
 * @param {string} url - request address.
 * @param {{ method?: string, headers?: Record<string, string>, body?: string, redirect?: 'follow'|'manual', timeoutMs?: number, signal?: AbortSignal }} options
 */
async function request(url, options = {}) {
  const method = options.method ?? 'GET'
  const deadlines = signalsOf(options.timeoutMs ?? 0, options.signal)
  let response
  try {
    response = await fetch(url, {
      method,
      headers: options.headers,
      body: options.body,
      redirect: options.redirect ?? 'follow',
      signal: deadlines.signal,
    })
  } catch (error) {
    throw describeFetchError(error)
  }
  let text = ''
  try {
    text = await response.text()
  } catch (error) {
    if (response.status === 401) text = ''
    else throw describeFetchError(error)
  }
  return { status: response.status, headers: response.headers, text }
}

function setCookiesOf(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie()
  const raw = headers.get('set-cookie')
  return raw === null ? [] : [raw]
}

/** Value of one cookie among a response's Set-Cookie headers. */
function cookieValue(headers, name) {
  for (const line of setCookiesOf(headers)) {
    const match = /(?:^|,\s*)([^=;,\s]+)=([^;,\s]*)/.exec(line.startsWith(name + '=') ? ', ' + line : line)
    if (match !== null && match[1] === name && match[2] !== '') return match[2]
  }
  for (const line of setCookiesOf(headers)) {
    const parts = line.split(';')[0].split('=')
    if (parts.length === 2 && parts[0].trim() === name && parts[1].trim() !== '') return parts[1].trim()
  }
  return ''
}

function parseGuardedJson(text, purpose) {
  const body = stripStart(text)
  if (body === '') throw new XiaomiError(ERROR_CODES.protocol, '小米' + purpose + '返回了空响应')
  try {
    return JSON.parse(body)
  } catch {
    throw new XiaomiError(ERROR_CODES.protocol, '小米' + purpose + '返回了无法解析的响应（可能被风控或网络设备改写）')
  }
}

/* --------------------------------------------------------- account bootstrap */

/**
 * Fetch the account login URL, then the guided-login parameters it redirects to.
 * @returns {Promise<{ loginUrl: string, boot: { sid: string, qs: string, callback: string, sign: string, serviceParam: string } }>}
 */
export async function bootstrapLogin({ timeoutMs = 30_000, signal } = {}) {
  const boot = await request(LOGIN_BOOT_URL, { timeoutMs, signal })
  if (boot.status !== 200) {
    throw new XiaomiError(ERROR_CODES.protocol, '账号登录入口返回 HTTP ' + boot.status)
  }
  const booted = parseGuardedJson(boot.text, '账号登录入口')
  const loginUrl = typeof booted?.data?.loginUrl === 'string' ? booted.data.loginUrl : ''
  if (loginUrl === '') throw new XiaomiError(ERROR_CODES.protocol, '账号登录入口没有返回 loginUrl')
  assertXiaomiHost(loginUrl, '读取账号登录参数')

  const guided = await request(withJsonFlag(loginUrl), { timeoutMs, signal })
  if (guided.status !== 200) {
    throw new XiaomiError(ERROR_CODES.protocol, '账号登录参数返回 HTTP ' + guided.status)
  }
  const params = parseGuardedJson(guided.text, '账号登录参数')
  const sid = typeof params?.sid === 'string' ? params.sid : ''
  const callback = typeof params?.callback === 'string' ? params.callback : ''
  if (sid === '' || callback === '') {
    throw new XiaomiError(ERROR_CODES.protocol, '账号登录参数缺少 sid 或 callback')
  }
  return {
    loginUrl,
    boot: {
      sid,
      qs: typeof params.qs === 'string' ? params.qs : '',
      callback,
      sign: typeof params._sign === 'string' ? params._sign : '',
      serviceParam: typeof params.serviceParam === 'string' ? params.serviceParam : '',
    },
  }
}

/** Account-service device identifier, shaped like the web client's. */
export function newDeviceId() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return 'wb_' + hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20, 32)
}

export function newFingerprint() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Ask the account service for a QR challenge.
 * @returns {Promise<{ payload: string, pollUrl: string, expiresInMs: number, deviceId: string, fingerprint: string }>}
 */
export async function startQrLogin({ timeoutMs = 30_000, signal } = {}) {
  const { boot } = await bootstrapLogin({ timeoutMs, signal })
  const deviceId = newDeviceId()
  const fingerprint = newFingerprint()
  const query = new URLSearchParams({
    _locale: 'zh_CN',
    _group: 'DEFAULT',
    sid: boot.sid,
    qs: boot.qs,
    callback: boot.callback,
    _sign: boot.sign,
    serviceParam: boot.serviceParam,
    showActiveX: 'false',
    theme: '',
    needTheme: 'false',
    bizDeviceType: '',
    _hasLogo: 'false',
    _qrsize: '240',
    _dc: String(Date.now()),
    deviceFingerprint: fingerprint,
  })
  const target = assertXiaomiHost(HOST_ACCOUNT + '/longPolling/loginUrl?' + query.toString(), '创建扫码登录')
  const response = await request(target, { headers: accountHeaders(deviceId), timeoutMs, signal })
  if (response.status !== 200) {
    throw new XiaomiError(ERROR_CODES.protocol, '创建扫码登录返回 HTTP ' + response.status)
  }
  const body = parseGuardedJson(response.text, '扫码登录')
  const payload = typeof body?.loginUrl === 'string' ? body.loginUrl : ''
  const pollUrl = typeof body?.lp === 'string' ? body.lp : ''
  if (body?.code !== 0 || payload === '' || pollUrl === '') {
    throw new XiaomiError(
      ERROR_CODES.qrFailed,
      '账号服务拒绝了扫码请求' + (typeof body?.desc === 'string' && body.desc !== '' ? '：' + body.desc : ''),
      { code: body?.code },
    )
  }
  assertXiaomiHost(payload, '渲染二维码')
  assertXiaomiHost(pollUrl, '等待扫码结果')
  const serverTimeout = Number.isFinite(body?.timeout) && body.timeout > 0 ? Number(body.timeout) : 300
  return {
    payload,
    pollUrl,
    expiresInMs: serverTimeout * 1000,
    deviceId,
    fingerprint,
  }
}

/**
 * Wait on the account service's long poll for one QR challenge.
 * @returns {Promise<{ state: 'confirmed', ticket: { location: string, passToken: string, userId: string } } | { state: 'expired' } | { state: 'failed', code?: number, message: string }>}
 */
export async function pollQrLogin({ pollUrl, deviceId, expiresInMs, signal }) {
  const timeoutMs = Math.max(expiresInMs, 60_000) + QR_POLL_HEADROOM_MS
  let response
  try {
    response = await request(assertXiaomiHost(pollUrl, '等待扫码结果'), {
      headers: accountHeaders(deviceId),
      timeoutMs,
      signal,
    })
  } catch (error) {
    if (error instanceof XiaomiError && error.code === ERROR_CODES.timeout) return { state: 'expired' }
    throw error
  }
  if (response.status >= 400) {
    return { state: 'failed', message: '扫码结果轮询返回 HTTP ' + response.status }
  }
  let body
  try {
    body = parseGuardedJson(response.text, '扫码结果')
  } catch (error) {
    return { state: 'failed', message: error?.message ?? String(error) }
  }
  const code = typeof body?.code === 'number' ? body.code : -1
  const desc = typeof body?.desc === 'string' ? body.desc : ''
  const location = typeof body?.location === 'string' ? body.location : ''
  const passToken = typeof body?.passToken === 'string' ? body.passToken : ''
  const rawUser = body?.userId
  const userId = rawUser === undefined || rawUser === null ? '' : String(rawUser)

  // 70016 is the account service's "this QR code is no longer valid" answer.
  if (code === 70016) return { state: 'expired' }
  if (code !== 0 || body?.securityStatus !== 0 || location === '') {
    return {
      state: 'failed',
      code,
      message: desc !== '' ? desc : code === 0 ? '账号服务要求额外验证，请在手机上完成确认后重试' : '扫码确认失败（code ' + code + '）',
    }
  }
  assertXiaomiHost(location, '换取登录票据')
  return { state: 'confirmed', ticket: { location, passToken, userId } }
}

/**
 * Walk the ticket redirect chain and collect the issued service cookies.
 * @returns {Promise<{ serviceToken: string, userId: string }>}
 */
export async function exchangeServiceToken({ location, cookie, timeoutMs = 30_000, signal }) {
  let next = assertXiaomiHost(location, '换取登录票据')
  let serviceToken = ''
  let userId = ''
  for (let hop = 0; hop < MAX_REDIRECT_HOPS && next !== ''; hop += 1) {
    const response = await request(next, {
      headers: {
        'user-agent': NOTES_USER_AGENT,
        referer: HOST_ACCOUNT + '/',
        ...(cookie === '' ? {} : { cookie }),
      },
      redirect: 'manual',
      timeoutMs,
      signal,
    })
    const token = cookieValue(response.headers, 'serviceToken')
    const issuedUser = cookieValue(response.headers, 'userId')
    if (token !== '') serviceToken = token
    if (issuedUser !== '') userId = issuedUser
    const followed = response.headers.get('location')
    if (response.status < 300 || response.status >= 400 || followed === null || followed === '') break
    const resolved = new URL(followed, next).toString()
    next = assertXiaomiHost(resolved, '跟随登录票据跳转')
  }
  return { serviceToken, userId }
}

/* ------------------------------------------------------------- notes access */

async function notesRequest(creds, path, { timeoutMs = 30_000, signal } = {}) {
  const response = await request(HOST_DRIVE + path, {
    headers: notesHeaders(creds),
    timeoutMs,
    signal,
  })
  const unauthorized = response.status === 401
  let body = null
  if (response.text !== '') {
    try {
      body = JSON.parse(stripStart(response.text))
    } catch {
      body = null
    }
  }
  if (unauthorized || body?.R === 401) return { unauthorized: true, status: response.status, body }
  if (response.status !== 200) {
    throw new XiaomiError(ERROR_CODES.protocol, '小米笔记接口返回 HTTP ' + response.status + '（' + path + '）')
  }
  if (body === null) {
    throw new XiaomiError(ERROR_CODES.protocol, '小米笔记接口返回了非 JSON 响应（' + path + '）')
  }
  return { unauthorized: false, status: response.status, body }
}

/**
 * Confirm that a credential set really can read this account's notes.
 * @returns {Promise<boolean>}
 */
export async function verifyNotesAccess(creds, { timeoutMs = 20_000, signal } = {}) {
  try {
    const result = await notesRequest(creds, NOTES_LIST_PATH + '?ts=' + Date.now() + '&limit=1', { timeoutMs, signal })
    if (result.unauthorized) return false
    return result.body?.result === 'ok'
  } catch {
    return false
  }
}

/**
 * Restore an expired `serviceToken` from the long-lived `passToken`.
 *
 * Three failure classes are kept apart here, because they ask different things
 * of the user:
 *
 *  - the account service answers and rejects the long-lived credential
 *    (`needs-scan`) — only this one justifies scanning again;
 *  - the exchange cannot be completed right now (`protocol`): a 5xx, a body that
 *    is not the guarded JSON, or a ticket without a token. The stored
 *    credentials stay put and a later attempt may well succeed;
 *  - the ticket is issued but the new token cannot read this account's notes
 *    (`access-denied`), which again stores nothing.
 *
 * The last read-only check is the same one the QR flow performs before it saves
 * a session. Without it, a token the notes service rejects would be committed as
 * a good login and the retry would fail with the same 401.
 * @returns {Promise<object>} the credentials to store.
 */
export async function refreshSession(creds, { timeoutMs = 30_000, signal } = {}) {
  if (typeof creds?.passToken !== 'string' || creds.passToken === '' || typeof creds?.userId !== 'string' || creds.userId === '') {
    throw new XiaomiError(ERROR_CODES.needsScan, '长期凭据缺失，需要重新扫码连接')
  }
  const { loginUrl } = await bootstrapLogin({ timeoutMs, signal })
  let cookie = 'passToken=' + creds.passToken + '; userId=' + creds.userId
  if (typeof creds.deviceId === 'string' && creds.deviceId !== '') {
    cookie += '; deviceId=' + creds.deviceId + '; pass_ua=web'
  }
  const response = await request(withJsonFlag(loginUrl), {
    headers: { 'user-agent': NOTES_USER_AGENT, cookie },
    timeoutMs,
    signal,
  })
  if (response.status >= 500) {
    throw new XiaomiError(
      ERROR_CODES.protocol,
      '账号续期服务暂时不可用（HTTP ' + response.status + '），已保留当前登录态，稍后重试',
    )
  }
  let body
  try {
    body = parseGuardedJson(response.text, '账号续期')
  } catch {
    throw new XiaomiError(
      ERROR_CODES.protocol,
      '账号续期的响应无法解析（HTTP ' + response.status + '），已保留当前登录态，稍后重试',
    )
  }
  const location = typeof body?.location === 'string' ? body.location : ''
  const code = typeof body?.code === 'number' ? body.code : undefined
  if (body?.code !== 0 || body?.securityStatus !== 0 || location === '') {
    const desc = typeof body?.desc === 'string' ? body.desc : ''
    throw new XiaomiError(
      ERROR_CODES.needsScan,
      '长期凭据被账号服务拒绝' + (desc === '' ? '' : '：' + desc) + '，需要重新扫码连接',
      { code },
    )
  }
  assertXiaomiHost(location, '续期换票')
  const issued = await exchangeServiceToken({ location, cookie, timeoutMs, signal })
  if (issued.serviceToken === '') {
    // A valid ticket location means the long-lived credential was accepted, so a
    // missing token is a service hiccup rather than a reason to scan again.
    throw new XiaomiError(ERROR_CODES.protocol, '换票没有拿到 serviceToken，已保留当前登录态，稍后重试')
  }
  const renewed = {
    ...creds,
    serviceToken: issued.serviceToken,
    userId: issued.userId !== '' ? issued.userId : creds.userId,
  }
  try {
    await listNotesPage(renewed, { limit: 1, timeoutMs, signal })
  } catch (error) {
    if (error instanceof XiaomiError && error.code === ERROR_CODES.unauthorized) {
      throw new XiaomiError(ERROR_CODES.accessDenied, '换票成功，但新令牌读不了云笔记，已保留原登录态', { code })
    }
    throw error
  }
  return renewed
}

/* --------------------------------------------------------------- notes api */

function unwrapNotes(result, purpose) {
  if (result.unauthorized) throw new XiaomiError(ERROR_CODES.unauthorized, '登录态已失效（' + purpose + '）')
  if (result.body?.result !== 'ok') {
    const description = typeof result.body?.description === 'string' ? result.body.description : ''
    throw new XiaomiError(
      ERROR_CODES.protocol,
      '小米笔记' + purpose + '失败' + (description === '' ? '' : '：' + description),
      { result: result.body?.result },
    )
  }
  return result.body.data
}

/** One page of the note list. */
export async function listNotesPage(creds, { limit = 50, syncTag = '', timeoutMs = 30_000, signal } = {}) {
  const query = new URLSearchParams({ ts: String(Date.now()), limit: String(limit) })
  if (syncTag !== '') query.set('syncTag', syncTag)
  const result = await notesRequest(creds, NOTES_LIST_PATH + '?' + query.toString(), { timeoutMs, signal })
  const data = unwrapNotes(result, '列表读取')
  return {
    entries: Array.isArray(data?.entries) ? data.entries : [],
    folders: Array.isArray(data?.folders) ? data.folders : [],
    syncTag: typeof data?.syncTag === 'string' ? data.syncTag : '',
    lastPage: data?.lastPage === true,
  }
}

/**
 * Read every page of the note list.
 *
 * A list that stops early is reported, not silently treated as complete: a
 * truncated list would otherwise let the mirror drop live mappings.
 * @returns {Promise<{ entries: object[], folders: object[], complete: boolean, reason?: string }>}
 */
export async function listAllNotes(creds, { limit = 50, maxPages = 10, timeoutMs = 30_000, signal } = {}) {
  const entries = []
  const folders = new Map()
  let syncTag = ''
  for (let page = 0; page < maxPages; page += 1) {
    const result = await listNotesPage(creds, { limit, syncTag, timeoutMs, signal })
    entries.push(...result.entries)
    for (const folder of result.folders) {
      if (folder?.id !== undefined) folders.set(String(folder.id), folder)
    }
    if (result.lastPage) return { entries, folders: Array.from(folders.values()), complete: true }
    if (result.syncTag === '' || result.syncTag === syncTag) {
      return {
        entries,
        folders: Array.from(folders.values()),
        complete: false,
        reason: '列表游标停滞，只取到 ' + entries.length + ' 篇',
      }
    }
    syncTag = result.syncTag
  }
  return {
    entries,
    folders: Array.from(folders.values()),
    complete: false,
    reason: '列表超过配置的最大页数（' + maxPages + '），只取到 ' + entries.length + ' 篇',
  }
}

/** One note's full record, including its XML body. */
export async function getNote(creds, noteId, { timeoutMs = 30_000, signal } = {}) {
  const path = '/note/note/' + encodeURIComponent(String(noteId)) + '/?ts=' + Date.now()
  const result = await notesRequest(creds, path, { timeoutMs, signal })
  const data = unwrapNotes(result, '详情读取')
  if (data?.entry === undefined || data.entry === null) {
    throw new XiaomiError(ERROR_CODES.protocol, '小米笔记详情没有返回正文（' + noteId + '）')
  }
  return data.entry
}

/* -------------------------------------------------------------- notes write */

/**
 * One form POST against the notes service.
 *
 * The `serviceToken` rides in the body as well as the cookie, so renewal has to
 * replace both; that happens because the caller re-enters through
 * `withSession`, which hands this function the refreshed credentials.
 */
async function notesPost(creds, path, form, { timeoutMs = 30_000, signal } = {}) {
  const body = new URLSearchParams()
  for (const [key, value] of Object.entries(form)) body.set(key, String(value))
  body.set('serviceToken', creds.serviceToken)
  const response = await request(HOST_DRIVE + path, {
    method: 'POST',
    headers: {
      ...notesHeaders(creds),
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
    },
    body: body.toString(),
    timeoutMs,
    signal,
  })
  let parsed = null
  if (response.text !== '') {
    try {
      parsed = JSON.parse(stripStart(response.text))
    } catch {
      parsed = null
    }
  }
  if (response.status === 401 || parsed?.R === 401) {
    throw new XiaomiError(ERROR_CODES.unauthorized, '登录态已失效（' + path + '）')
  }
  if (response.status !== 200) {
    throw new XiaomiError(ERROR_CODES.protocol, '小米笔记接口返回 HTTP ' + response.status + '（' + path + '）')
  }
  if (parsed === null) {
    throw new XiaomiError(ERROR_CODES.protocol, '小米笔记接口返回了非 JSON 响应（' + path + '）')
  }
  if (parsed.result !== 'ok') {
    const description = typeof parsed.description === 'string' ? parsed.description : ''
    throw new XiaomiError(
      ERROR_CODES.protocol,
      description === '' ? '小米笔记拒绝了这次写入（' + path + '）' : description,
      { result: parsed.result },
    )
  }
  return parsed
}

/**
 * Create one note.
 * @returns {Promise<object>} the created entry, including its id.
 */
export async function createNote(creds, entry, options = {}) {
  const parsed = await notesPost(creds, '/note/note', { entry: JSON.stringify(entry) }, options)
  const created = parsed?.data?.entry
  if (created === undefined || created.id === undefined) {
    throw new XiaomiError(ERROR_CODES.protocol, '笔记创建成功但没有返回笔记 ID')
  }
  return created
}

/**
 * Update one note under the entry's own `tag` as an optimistic lock.
 * @returns {Promise<{ conflict: boolean }>} conflict when the cloud moved on.
 */
export async function updateNote(creds, noteId, entry, options = {}) {
  const parsed = await notesPost(
    creds,
    '/note/note/' + encodeURIComponent(String(noteId)),
    { entry: JSON.stringify(entry) },
    options,
  )
  return { conflict: parsed?.data?.conflict === true }
}

/**
 * Move one note to the recycle bin. Deleting is a two-step state machine, so a
 * permanent purge is deliberately not exposed here.
 */
export async function trashNote(creds, noteId, tag, options = {}) {
  const parsed = await notesPost(
    creds,
    '/note/full/' + encodeURIComponent(String(noteId)) + '/delete',
    { tag: String(tag), purge: 'false' },
    options,
  )
  return { conflict: parsed?.data?.conflict === true }
}

/**
 * Create one cloud folder.
 * @returns {Promise<object>} the created folder entry.
 */
export async function createFolder(creds, { subject, parentId = '0' }, options = {}) {
  const now = Date.now()
  const entry = {
    subject,
    folderId: String(parentId ?? '0'),
    createDate: now,
    modifyDate: now,
    colorId: 0,
    alertDate: 0,
    alertTag: 0,
    type: 'folder',
    setting: { themeId: 0, stickyTime: 0, version: 0 },
  }
  const parsed = await notesPost(creds, '/note/folder', { entry: JSON.stringify(entry) }, options)
  const created = parsed?.data?.entry
  if (created === undefined || created.id === undefined) {
    throw new XiaomiError(ERROR_CODES.protocol, '目录创建成功但没有返回目录 ID')
  }
  return created
}

export { NOTES_LIST_PATH, LOGIN_BOOT_URL }
