/**
 * mi-note — Host half.
 *
 * Owns everything that touches the network or the disk:
 *
 *  - the account session: a QR challenge the browser only draws, the ticket
 *    exchange, and the credential record that survives a restart;
 *  - renewal: a `serviceToken` lives for minutes, so a rejected request is
 *    restored from the stored long-lived `passToken` instead of asking the user
 *    to scan again;
 *  - the local mirror: the note-id map, the baseline bodies, and the single
 *    place a workspace file is written.
 *
 * The browser never sees a token, a ticket URL or a raw account response. It
 * receives a QR matrix, a status word, and a masked account id.
 *
 * Routes are registered on the authenticated /api bridge through
 * `connection.fetch`, not as a web server prefix: the bridge is what carries the
 * browser authentication and the owner-only check that an endpoint able to
 * write files in the user's notes folder needs.
 */
import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { createQr } from './lib/qr.js'
import * as xiaomi from './lib/xiaomi.js'
import * as store from './lib/store.js'
import * as push from './lib/sync-push.js'
import { xmlToMarkdown, markdownToXml } from './lib/note-format.js'

export const name = 'mi-note'
export const inject = ['credentials', 'tools']

/** Credential record key: `<owner>/<id>`, owned by this plugin. */
const CREDENTIAL_KEY = 'mi-note/account'
const ROUTE = '/api/mi-note'
const CHALLENGE_TTL_MS = 300_000
const PULL_MAX_BYTES = 400_000

const ROUTES = [
  { path: ROUTE + '/state', methods: ['GET'], action: 'state' },
  { path: ROUTE + '/qr', methods: ['POST'], action: 'qr-start' },
  { path: ROUTE + '/qr/cancel', methods: ['POST'], action: 'qr-cancel' },
  { path: ROUTE + '/disconnect', methods: ['POST'], action: 'disconnect' },
  { path: ROUTE + '/verify', methods: ['POST'], action: 'verify' },
  { path: ROUTE + '/workspace', methods: ['POST'], action: 'workspace' },
  { path: ROUTE + '/sync', methods: ['POST'], action: 'sync' },
]

/**
 * Configuration this plugin reads, with the defaults applied here rather than
 * through a schema.
 *
 * No `Config` export: a plugin installed into a profile cannot import
 * `@deepseek-ai/schemastery` (the profile installs with `autoInstallPeers:
 * false`, so the Host's own packages are not on its resolution path), and an
 * import that throws would stop the whole plugin from activating. The row's
 * config object arrives as-is, so unknown legacy keys are simply ignored and
 * every field is defaulted below.
 */
const DEFAULT_CONFIG = {
  workspaceDir: '',
  mirrorDir: 'mi-notes',
  defaultLimit: 50,
  maxPages: 10,
  timeoutMs: 30_000,
}

function normaliseConfig(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const asText = (value, fallback) => (typeof value === 'string' ? value : fallback)
  const positive = (value, fallback) => {
    const number = Number(value)
    return Number.isFinite(number) && number > 0 ? number : fallback
  }
  return {
    workspaceDir: asText(source.workspaceDir, DEFAULT_CONFIG.workspaceDir).trim(),
    mirrorDir: asText(source.mirrorDir, DEFAULT_CONFIG.mirrorDir),
    defaultLimit: positive(source.defaultLimit, DEFAULT_CONFIG.defaultLimit),
    maxPages: positive(source.maxPages, DEFAULT_CONFIG.maxPages),
    timeoutMs: positive(source.timeoutMs, DEFAULT_CONFIG.timeoutMs),
  }
}

/* ------------------------------------------------------------------ runtime */

function runtime() {
  const key = Symbol.for('mi-note/runtime')
  if (globalThis[key] === undefined) {
    globalThis[key] = {
      ctx: undefined,
      config: {},
      challenge: null,
      locks: new Map(),
      lastPull: null,
      // The in-flight ticket exchange. It must exist from the start: the renewal
      // trigger used to test `=== null` against an undefined field, so the first
      // 401 after a restart started no exchange at all and simply retried the
      // expired token.
      renewing: null,
    }
  }
  return globalThis[key]
}

/** Serialize writes per workspace directory: one pull at a time per folder. */
function withWorkspaceLock(key, operation) {
  const rt = runtime()
  const previous = rt.locks.get(key) ?? Promise.resolve()
  const next = previous.then(operation, operation)
  rt.locks.set(key, next.then(() => undefined, () => undefined))
  return next
}

function requireContext() {
  const ctx = runtime().ctx
  if (ctx === undefined) throw new Error('小米笔记插件还没有就绪')
  return ctx
}

/* --------------------------------------------------------------- responses */

function json(body, status = 200) {
  return Response.json(body, { status })
}

function fail(status, code, message) {
  return json({ ok: false, error: { code, message }, message }, status)
}

function describeError(error) {
  const code = typeof error?.code === 'string' ? error.code : 'mi-note/failed'
  const message = error?.message ?? String(error)
  return { code, message }
}

function maskUserId(userId) {
  const value = String(userId ?? '')
  if (value.length <= 4) return value === '' ? '' : '****'
  if (value.length <= 7) return value.slice(0, 2) + '*'.repeat(value.length - 3) + value.slice(-1)
  return value.slice(0, 3) + '*'.repeat(Math.max(2, value.length - 6)) + value.slice(-3)
}

/* -------------------------------------------------------------- credentials */

function credentialsService() {
  const ctx = requireContext()
  const service = ctx.get('credentials')
  if (service === undefined || service === null) {
    throw new Error('这个部署没有提供 DSH 凭据库，无法保存登录态')
  }
  return service
}

/**
 * Read the stored account record.
 * @returns {Promise<undefined | { serviceToken: string, userId: string, passToken: string, deviceId: string, version: number, savedAt: number, renewable: boolean }>}
 */
async function readSession() {
  const record = await credentialsService().readRecord(CREDENTIAL_KEY)
  const payload = record?.payload
  if (payload === null || typeof payload !== 'object') return undefined
  if (typeof payload.serviceToken !== 'string' || payload.serviceToken === '') return undefined
  if (typeof payload.userId !== 'string' || payload.userId === '') return undefined
  return {
    serviceToken: payload.serviceToken,
    userId: payload.userId,
    passToken: typeof payload.passToken === 'string' ? payload.passToken : '',
    deviceId: typeof payload.deviceId === 'string' ? payload.deviceId : '',
    // Carried through so a renewal rewrites the record whole: reading only the
    // fields a renewal needs used to make the next save erase this one.
    fingerprint: typeof payload.fingerprint === 'string' ? payload.fingerprint : '',
    version: Number.isFinite(payload.version) ? payload.version : 0,
    savedAt: Number.isFinite(payload.savedAt) ? payload.savedAt : 0,
    renewable: typeof payload.passToken === 'string' && payload.passToken !== '',
  }
}

/**
 * Commit a session.
 *
 * `modifyRecord` is the exclusive write path, so the version check inside it is
 * what stops a cancelled scan, a stale renewal or a previous account from
 * overwriting the current credentials: the caller states which version it
 * started from and the commit is refused when that is no longer current.
 * @param {object} next - the credentials to store.
 * @param {number|undefined} expectedVersion - version observed before the work started.
 */
async function saveSession(next, expectedVersion) {
  const service = credentialsService()
  let saved
  await service.modifyRecord(CREDENTIAL_KEY, async current => {
    const existing = current?.payload
    const currentVersion = Number.isFinite(existing?.version) ? existing.version : 0
    if (expectedVersion !== undefined && expectedVersion !== currentVersion) {
      throw new Error('登录态在本次操作期间已经改变，本次结果作废')
    }
    saved = {
      serviceToken: next.serviceToken,
      userId: next.userId,
      passToken: next.passToken ?? '',
      deviceId: next.deviceId ?? '',
      fingerprint: next.fingerprint ?? '',
      savedAt: Date.now(),
      version: currentVersion + 1,
    }
    return { kind: 'grant', payload: saved }
  })
  return saved
}

async function clearSession() {
  const service = credentialsService()
  await service.deleteRecord(CREDENTIAL_KEY)
}

/**
 * Run a notes operation, restoring an expired token once if the service
 * rejects it.
 *
 * The exchange is single-flight within this plugin instance: concurrent
 * rejections share one ticket, and every waiter then retries with the token
 * that was actually saved, so two renewals cannot leave callers holding
 * different sessions.
 */
async function withSession(operation) {
  const session = await readSession()
  if (session === undefined) {
    throw new xiaomi.XiaomiError(xiaomi.ERROR_CODES.needsScan, '还没有连接小米账号，请先在「小米笔记」页面扫码连接')
  }
  const rt = runtime()
  try {
    return await operation(session)
  } catch (error) {
    if (!(error instanceof xiaomi.XiaomiError) || error.code !== xiaomi.ERROR_CODES.unauthorized) throw error
  }
  if (!rt.renewing) {
    const shared = (async () => {
      const latest = await readSession()
      if (latest === undefined) {
        throw new xiaomi.XiaomiError(xiaomi.ERROR_CODES.needsScan, '登录态在续期期间被断开，需要重新扫码连接')
      }
      const renewed = await xiaomi.refreshSession(latest, { timeoutMs: clampTimeout(rt.config.timeoutMs) })
      await saveSession(renewed, latest.version)
    })()
    rt.renewing = shared
    shared.then(
      () => { if (rt.renewing === shared) rt.renewing = null },
      () => { if (rt.renewing === shared) rt.renewing = null },
    )
  }
  await rt.renewing
  const restored = await readSession()
  if (restored === undefined) {
    throw new xiaomi.XiaomiError(xiaomi.ERROR_CODES.needsScan, '登录态已断开，需要重新扫码连接')
  }
  return await operation(restored)
}

/* ---------------------------------------------------------------- workspace */

/**
 * Where the mirror goes when nothing is configured yet.
 *
 * The plugin deliberately does not guess a default: the first version used the
 * Host's `workingDirectory.defaultDirectory`, which is the *profile* directory,
 * so a pull quietly deposited real notes inside `~/.dsh/profiles/<name>/`. The
 * workspace must be chosen explicitly, and this suggestion is what the settings
 * page offers as a starting point.
 */
function suggestedWorkspace() {
  const home = typeof os.homedir === 'function' ? os.homedir() : ''
  if (home === '') return '小米笔记'
  return path.join(home, 'Documents', '小米笔记')
}

async function currentWorkspace() {
  const config = runtime().config
  const configured = typeof config.workspaceDir === 'string' ? config.workspaceDir.trim() : ''
  if (configured === '') {
    throw new xiaomi.XiaomiError(
      'mi-note/workspace-unset',
      '还没有设置笔记工作区，请先在「小米笔记」页面选择文件夹（建议 ' + suggestedWorkspace() + '）',
    )
  }
  if (!path.isAbsolute(configured)) {
    throw new xiaomi.XiaomiError('mi-note/workspace-unset', '笔记工作区必须是绝对路径：' + configured)
  }
  const dir = await store.ensureWorkspace({
    configuredDir: configured,
    baseDir: path.dirname(configured),
    mirrorDir: config.mirrorDir,
  })
  return { dir, configured: true, base: '', suggested: suggestedWorkspace() }
}

/* ----------------------------------------------------------- hash migration */

/**
 * Read the note map and bring its hashes onto the current scheme.
 *
 * A record written by an older scheme cannot by itself say whether the file
 * changed, but its baseline body can: that body is exactly what both sides
 * agreed on at the last clean sync. Re-deriving both hashes from it makes the
 * upgrade invisible — no spurious "local changed", and no cloud write needed to
 * clear it. Records with no baseline keep their old state, which already reads
 * as `baseline-missing`.
 * @param {string} workspaceDir - mirror directory.
 * @param {{ persist?: boolean }} [options] - write the migrated map back.
 */
async function loadMapWithHashes(workspaceDir, options = {}) {
  const { map, legacy } = await store.readMap(workspaceDir)
  let migrated = 0
  for (const [id, record] of Object.entries(map.notes)) {
    if (record.hashVersion === store.HASH_VERSION) continue
    const baseline = await store.readBaseline(workspaceDir, id)
    if (baseline === undefined) continue
    const hash = store.hashText(baseline)
    record.hash = hash
    record.baselineHash = hash
    record.hashVersion = store.HASH_VERSION
    migrated += 1
  }
  if (migrated > 0 && options.persist === true) await store.writeMap(workspaceDir, map)
  return { map, legacy, migrated }
}

/* --------------------------------------------------------------- qr challenge */

function challengeView(challenge) {
  if (challenge === null) return null
  return {
    id: challenge.id,
    status: challenge.status,
    expiresAt: challenge.expiresAt,
    message: challenge.message ?? '',
    qr:
      challenge.status === 'waiting' && challenge.matrix !== null
        ? { size: challenge.matrix.size, version: challenge.matrix.version, rows: challenge.matrix.rows }
        : null,
  }
}

/**
 * Start a QR challenge, or return the one already running.
 *
 * Only one challenge exists per plugin instance: a second click joins the
 * running scan instead of invalidating the code the user is already looking at.
 */
async function startChallenge() {
  const rt = runtime()
  const existing = rt.challenge
  if (existing !== null && (existing.status === 'waiting' || existing.status === 'verifying')) {
    return challengeView(existing)
  }
  const timeoutMs = clampTimeout(rt.config.timeoutMs)
  const started = await xiaomi.startQrLogin({ timeoutMs })
  const qr = createQr(started.payload)
  const challenge = {
    id: crypto.randomUUID(),
    status: 'waiting',
    message: '',
    expiresAt: Date.now() + Math.min(started.expiresInMs, CHALLENGE_TTL_MS),
    matrix: {
      size: qr.size,
      version: qr.version,
      rows: qr.modules.map(row => row.join('')),
    },
    pollUrl: started.pollUrl,
    deviceId: started.deviceId,
    fingerprint: started.fingerprint,
    controller: new AbortController(),
    cancelled: false,
  }
  rt.challenge = challenge
  void runChallenge(challenge)
  return challengeView(challenge)
}

async function runChallenge(challenge) {
  const rt = runtime()
  try {
    const result = await xiaomi.pollQrLogin({
      pollUrl: challenge.pollUrl,
      deviceId: challenge.deviceId,
      expiresInMs: challenge.expiresAt - Date.now(),
      signal: challenge.controller.signal,
    })
    if (challenge.cancelled) return
    if (result.state === 'expired') {
      challenge.status = 'expired'
      challenge.message = '二维码已过期，请重新生成'
      return
    }
    if (result.state === 'failed') {
      challenge.status = 'failed'
      challenge.message = result.message
      return
    }
    challenge.status = 'verifying'
    challenge.matrix = null
    const { ticket } = result
    const cookie = ticket.passToken !== '' && ticket.userId !== ''
      ? 'passToken=' + ticket.passToken + '; userId=' + ticket.userId
      : ''
    const issued = await xiaomi.exchangeServiceToken({
      location: ticket.location,
      cookie,
      timeoutMs: clampTimeout(rt.config.timeoutMs),
      signal: challenge.controller.signal,
    })
    if (issued.serviceToken === '') {
      challenge.status = 'failed'
      challenge.message = '账号服务没有下发 serviceToken，请重试'
      return
    }
    const creds = {
      serviceToken: issued.serviceToken,
      userId: issued.userId !== '' ? issued.userId : ticket.userId,
      passToken: ticket.passToken,
      deviceId: challenge.deviceId,
      fingerprint: challenge.fingerprint,
    }
    if (creds.userId === '') {
      challenge.status = 'failed'
      challenge.message = '账号服务没有返回账号标识，请重试'
      return
    }
    if (!(await xiaomi.verifyNotesAccess(creds, { timeoutMs: clampTimeout(rt.config.timeoutMs) }))) {
      challenge.status = 'failed'
      challenge.message = '换票成功但无法读取云笔记，请确认该账号可以访问小米云笔记'
      return
    }
    if (challenge.cancelled) return
    // A missing passToken does not invalidate the session; it only means the
    // short-lived token cannot be renewed and a later expiry needs a new scan.
    const before = await readSession()
    await saveSession(creds, before === undefined ? 0 : before.version)
    challenge.status = 'connected'
    challenge.message = creds.passToken === '' ? '已连接，但账号服务没有返回长期凭据，过期后需要重新扫码' : ''
  } catch (error) {
    if (challenge.cancelled) return
    challenge.status = 'failed'
    challenge.message = describeError(error).message
  } finally {
    if (rt.challenge === challenge && challenge.status !== 'waiting') {
      challenge.matrix = null
    }
  }
}

function cancelChallenge(message = '已取消扫码') {
  const rt = runtime()
  const challenge = rt.challenge
  if (challenge === null) return
  if (challenge.status === 'waiting' || challenge.status === 'verifying') {
    challenge.cancelled = true
    challenge.status = 'cancelled'
    challenge.message = message
    challenge.matrix = null
    try {
      challenge.controller.abort()
    } catch {
      /* the abort listener is best effort */
    }
  }
}

function clampTimeout(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return 30_000
  return Math.min(Math.max(number, 5_000), 120_000)
}

/* -------------------------------------------------------------------- state */

async function buildState() {
  const rt = runtime()
  let session
  try {
    session = await readSession()
  } catch (error) {
    session = undefined
  }
  let workspace
  let workspaceError = ''
  try {
    workspace = await currentWorkspace()
  } catch (error) {
    workspace = { dir: '', configured: false, base: '', suggested: suggestedWorkspace() }
    workspaceError = describeError(error).message
  }
  let counts = { files: 0, mapped: 0 }
  if (workspace.dir !== '') {
    try {
      const files = await store.listMarkdown(workspace.dir)
      const { map } = await store.readMap(workspace.dir)
      counts = { files: files.length, mapped: Object.keys(map.notes).length }
    } catch {
      /* the page still renders without counts */
    }
  }
  return {
    ok: true,
    plugin: { name: 'mi-note', version: pluginVersion() },
    account: session === undefined
      ? { connected: false }
      : {
        connected: true,
        userId: maskUserId(session.userId),
        savedAt: session.savedAt,
        renewable: session.renewable,
      },
    challenge: challengeView(rt.challenge),
    workspace: {
      dir: workspace.dir,
      configured: workspace.configured,
      base: workspace.base ?? '',
      suggested: workspace.suggested ?? suggestedWorkspace(),
      error: workspaceError,
      counts,
    },
    lastPull: rt.lastPull,
  }
}

function pluginVersion() {
  return '0.1.0'
}

/* --------------------------------------------------------------------- sync */

function folderPathOf(folders, folderId) {
  const byId = folders instanceof Map ? folders : new Map()
  const segments = []
  let current = String(folderId ?? '0')
  let guard = 0
  while (current !== '0' && current !== '' && guard < 32) {
    const folder = byId.get(current)
    if (folder === undefined) break
    segments.unshift(String(folder.subject ?? '').trim())
    current = folder.parentId === undefined || folder.parentId === null ? '0' : String(folder.parentId)
    guard += 1
  }
  return segments.filter(segment => segment !== '')
}

function cloudTitle(entry) {
  const direct = typeof entry?.subject === 'string' ? entry.subject.trim() : ''
  if (direct !== '') return direct
  const extra = entry?.extraInfo
  if (typeof extra === 'string' && extra.startsWith('{')) {
    try {
      const parsed = JSON.parse(extra)
      if (typeof parsed?.title === 'string' && parsed.title.trim() !== '') return parsed.title.trim()
    } catch {
      /* an unparsable extraInfo is not fatal */
    }
  } else if (extra !== null && typeof extra === 'object' && typeof extra.title === 'string') {
    return extra.title.trim()
  }
  return '未命名笔记'
}

/**
 * Work out each mapped note's standing without touching any file.
 *
 * The comparison is deliberately conservative: a missing baseline, an
 * unreadable map or an incomplete cloud list all become an explicit state
 * instead of a guess, because the alternative is overwriting an edit.
 */
async function collectStatus() {
  const rt = runtime()
  const workspace = await currentWorkspace()
  const { map, legacy } = await loadMapWithHashes(workspace.dir)
  const localFiles = await store.listMarkdown(workspace.dir)
  const localSet = new Set(localFiles)

  let cloud
  let cloudError = ''
  try {
    cloud = await withSession(async creds => await xiaomi.listAllNotes(creds, {
      limit: Number(rt.config.defaultLimit) || 50,
      maxPages: Number(rt.config.maxPages) || 10,
      timeoutMs: clampTimeout(rt.config.timeoutMs),
    }))
  } catch (error) {
    cloud = undefined
    cloudError = describeError(error).message
  }

  const byId = new Map()
  const folders = new Map()
  if (cloud !== undefined) {
    for (const folder of cloud.folders) {
      if (folder?.id !== undefined) folders.set(String(folder.id), folder)
    }
    for (const entry of cloud.entries) {
      if (entry?.id !== undefined) byId.set(String(entry.id), entry)
    }
  }

  const notes = []
  const mappedPaths = new Set()
  for (const [id, record] of Object.entries(map.notes)) {
    mappedPaths.add(record.path.toLowerCase())
    const absolute = store.resolveInside(workspace.dir, record.path)
    const text = await store.readTextIfExists(absolute)
    const exists = text !== undefined
    const hash = exists ? store.hashText(text) : ''
    const localChanged = exists && record.hash !== '' && hash !== record.hash
    const baseline = await store.readBaseline(workspace.dir, id)
    const cloudEntry = byId.get(id)
    const cloudMissing = cloud !== undefined && !cloudEntry && cloud.complete
    const cloudChanged = cloudEntry !== undefined && record.tag !== '' && String(cloudEntry.tag ?? '') !== record.tag
    let state
    if (!exists) state = 'missing'
    else if (record.baselineHash === '' || baseline === undefined) state = 'baseline-missing'
    else if (cloudError !== '') state = 'cloud-unknown'
    else if (cloudMissing) state = 'cloud-gone'
    else if (localChanged && cloudChanged) state = 'conflict'
    else if (localChanged) state = 'local-changed'
    else if (cloudChanged) state = 'cloud-changed'
    else state = 'unchanged'
    notes.push({
      id,
      path: record.path,
      title: record.title || cloudTitle(cloudEntry ?? {}),
      state,
      exists,
      legacy: record.baselineHash === '',
    })
  }

  const unmapped = localFiles.filter(relative => !mappedPaths.has(relative.toLowerCase()))
  const cloudOnly = cloud === undefined
    ? []
    : cloud.entries
      .filter(entry => entry?.id !== undefined && map.notes[String(entry.id)] === undefined)
      .map(entry => ({ id: String(entry.id), title: cloudTitle(entry) }))

  const counts = {}
  for (const note of notes) counts[note.state] = (counts[note.state] ?? 0) + 1

  return {
    workspace: workspace.dir,
    localFiles: localFiles.length,
    mapped: notes.length,
    counts,
    legacy,
    cloud: cloud === undefined
      ? { available: false, error: cloudError }
      : { available: true, notes: cloud.entries.length, folders: cloud.folders.length, complete: cloud.complete, reason: cloud.reason ?? '' },
    notes,
    unmapped: unmapped.slice(0, 50),
    unmappedTotal: unmapped.length,
    cloudOnly: cloudOnly.slice(0, 50),
    cloudOnlyTotal: cloudOnly.length,
  }
}

/** Choose a free workspace path for a cloud note. */
function planPath(workspaceDir, folders, entry, taken) {
  const folderSegments = folderPathOf(folders, entry.folderId).map(segment => store.sanitizeSegment(segment))
  const fileName = store.sanitizeSegment(cloudTitle(entry), { keepExtension: true }) + '.md'
  const candidate = [...folderSegments, fileName].join('/')
  return store.uniquePath(candidate, taken)
}

/**
 * Pull cloud notes into the mirror.
 * @param {{ noteId?: string, path?: string, full?: boolean, force?: 'cloud'|'local' }} request
 */
async function runPull(request = {}) {
  const rt = runtime()
  const workspace = await currentWorkspace()
  return await withWorkspaceLock(workspace.dir, async () => {
    const { map } = await loadMapWithHashes(workspace.dir, { persist: true })
    const localFiles = await store.listMarkdown(workspace.dir)
    const taken = new Set(localFiles.map(relative => relative.toLowerCase()))
    const pulled = []
    const skipped = []
    const conflicts = []
    const failed = []

    const cloud = await withSession(async creds => await xiaomi.listAllNotes(creds, {
      limit: Number(rt.config.defaultLimit) || 50,
      maxPages: Number(rt.config.maxPages) || 10,
      timeoutMs: clampTimeout(rt.config.timeoutMs),
    }))
    if (!cloud.complete) {
      return {
        ok: false,
        reason: 'cloud-list-incomplete',
        message: '云端列表没有取全（' + (cloud.reason ?? '原因不明') + '），本次不写入任何文件',
        notes: [],
      }
    }

    const folders = new Map()
    for (const folder of cloud.folders) {
      if (folder?.id !== undefined) folders.set(String(folder.id), folder)
    }
    const byId = new Map()
    for (const entry of cloud.entries) {
      if (entry?.id !== undefined) byId.set(String(entry.id), entry)
    }

    const targets = []
    if (typeof request.noteId === 'string' && request.noteId !== '') {
      const entry = byId.get(request.noteId)
      if (entry === undefined) return { ok: false, reason: 'note-not-found', message: '云端没有这篇笔记：' + request.noteId, notes: [] }
      targets.push(entry)
    } else if (typeof request.path === 'string' && request.path !== '') {
      const normalised = request.path.replace(/\\/g, '/').toLowerCase()
      const pair = Object.entries(map.notes).find(([, record]) => record.path.toLowerCase() === normalised)
      if (pair === undefined) return { ok: false, reason: 'path-not-mapped', message: '这个文件还没有关联云笔记：' + request.path, notes: [] }
      const entry = byId.get(pair[0])
      if (entry === undefined) return { ok: false, reason: 'note-not-found', message: '这篇笔记在云端已经不存在：' + pair[0], notes: [] }
      targets.push(entry)
    } else {
      // Everything the cloud has: mapped notes are refreshed when they changed,
      // unmapped ones are adopted so a first pull establishes the whole mirror.
      targets.push(...cloud.entries)
    }

    for (const entry of targets) {
      const id = String(entry.id)
      const record = map.notes[id]
      const force = request.force === 'cloud' ? 'cloud' : request.force === 'local' ? 'local' : ''
      try {
        const previousText = record === undefined ? undefined : await store.readTextIfExists(store.resolveInside(workspace.dir, record.path))
        const previousHash = previousText === undefined ? '' : store.hashText(previousText)
        const localChanged = record !== undefined && record.hash !== '' && previousHash !== record.hash

        if (record !== undefined) {
          const baseline = await store.readBaseline(workspace.dir, id)
          const baselineMissing = record.baselineHash === '' || baseline === undefined
          const cloudUnchanged = String(entry.tag ?? '') === record.tag
          const wantsFull = request.full === true
          if (!wantsFull && !force && cloudUnchanged && !baselineMissing && !localChanged) {
            skipped.push({ id, path: record.path, reason: 'unchanged' })
            continue
          }
          if (localChanged && !wantsFull) {
            if (force === 'local') {
              // Keep the local edit and re-baseline against the cloud version so
              // the next status stops calling it a conflict.
              const detail = await withSession(async creds => await xiaomi.getNote(creds, id, { timeoutMs: clampTimeout(rt.config.timeoutMs) }))
              const markdown = xmlToMarkdown(detail.content)
              const cloudBody = markdown === '' ? '' : markdown + '\n'
              await store.writeBaseline(workspace.dir, id, cloudBody)
              map.notes[id] = {
                ...record,
                tag: String(entry.tag ?? record.tag),
                baselineHash: store.hashText(cloudBody),
                hashVersion: store.HASH_VERSION,
                cloudModifyDate: Number(entry.modifyDate ?? record.cloudModifyDate),
                syncedAt: Date.now(),
              }
              skipped.push({ id, path: record.path, reason: 'kept-local' })
              continue
            }
            if (force !== 'cloud') {
              const detail = await withSession(async creds => await xiaomi.getNote(creds, id, { timeoutMs: clampTimeout(rt.config.timeoutMs) }))
              const markdown = xmlToMarkdown(detail.content)
              const cloudCopy = await cloudCopyPath(workspace.dir, id, markdown)
              conflicts.push({
                id,
                path: record.path,
                title: record.title,
                cloudCopy,
                reason: baselineMissing ? 'baseline-missing' : 'both-changed',
              })
              continue
            }
          }
        }

        const detail = await withSession(async creds => await xiaomi.getNote(creds, id, { timeoutMs: clampTimeout(rt.config.timeoutMs) }))
        const markdown = xmlToMarkdown(detail.content)
        if (markdown.length > PULL_MAX_BYTES) {
          failed.push({ id, title: cloudTitle(entry), reason: 'too-large', message: '正文超过 ' + PULL_MAX_BYTES + ' 字符，已跳过' })
          continue
        }

        let relative = record?.path
        if (relative === undefined) {
          relative = planPath(workspace.dir, folders, entry, taken)
          taken.add(relative.toLowerCase())
        }
        const absolute = store.resolveInside(workspace.dir, relative)
        const body = markdown === '' ? '' : markdown + '\n'
        await store.atomicWrite(absolute, body)
        // The baseline stores exactly the bytes on disk, so a rename or move
        // whose content did not change hashes identically and can be recognised
        // as the same note.
        await store.writeBaseline(workspace.dir, id, body)

        const folderSegments = folderPathOf(folders, entry.folderId)
        map.notes[id] = {
          path: relative,
          title: cloudTitle(entry),
          folderId: entry.folderId === undefined ? '0' : String(entry.folderId),
          folderPath: folderSegments.join('/'),
          tag: String(entry.tag ?? ''),
          hash: store.hashText(body),
          baselineHash: store.hashText(body),
          hashVersion: store.HASH_VERSION,
          cloudModifyDate: Number(entry.modifyDate ?? 0),
          syncedAt: Date.now(),
          missing: false,
        }
        pulled.push({ id, path: relative, title: map.notes[id].title })
      } catch (error) {
        failed.push({ id, title: cloudTitle(entry), reason: 'failed', message: describeError(error).message })
      }
    }

    await store.writeMap(workspace.dir, map)
    const summary = {
      ok: true,
      workspace: workspace.dir,
      pulled: pulled.length,
      skipped: skipped.length,
      conflicts: conflicts.length,
      failed: failed.length,
      notes: pulled,
      conflictNotes: conflicts,
      failures: failed,
      skippedNotes: skipped.slice(0, 50),
    }
    rt.lastPull = { at: Date.now(), pulled: pulled.length, conflicts: conflicts.length, failed: failed.length }
    return summary
  })
}

/** Keep the cloud side of a conflict beside the baseline for comparison. */
async function cloudCopyPath(workspaceDir, noteId, markdown) {
  const relative = store.BASELINE_DIR + '/' + store.sanitizeSegment(noteId) + '.cloud.md'
  const absolute = store.resolveInside(workspaceDir, relative)
  await store.atomicWrite(absolute, markdown === '' ? '' : markdown + '\n')
  return relative
}

/* --------------------------------------------------------------------- push */

/** Read the cloud list once and index it; refuse to write against a partial list. */
async function loadCloudIndex() {
  const rt = runtime()
  const cloud = await withSession(async creds => await xiaomi.listAllNotes(creds, {
    limit: Number(rt.config.defaultLimit) || 50,
    maxPages: Number(rt.config.maxPages) || 10,
    timeoutMs: clampTimeout(rt.config.timeoutMs),
  }))
  if (!cloud.complete) {
    throw new Error('云端列表没有取全（' + (cloud.reason ?? '原因不明') + '），本次不做任何写入')
  }
  const entries = new Map()
  for (const entry of cloud.entries) {
    if (entry?.id !== undefined) entries.set(String(entry.id), entry)
  }
  return { entries, folders: push.cloudFolders(cloud.folders) }
}

/**
 * Local files, their hashes and bodies, plus the plan for the requested paths.
 *
 * Selection is always explicit: a push that silently swept the whole folder
 * would be a push the user never asked for.
 */
async function collectPlan(request) {
  const workspace = await currentWorkspace()
  const { map } = await loadMapWithHashes(workspace.dir)
  const localFiles = await store.listMarkdown(workspace.dir)
  const hashes = new Map()
  const contents = new Map()
  for (const relative of localFiles) {
    const text = await store.readTextIfExists(store.resolveInside(workspace.dir, relative))
    hashes.set(relative.toLowerCase(), text === undefined ? '' : store.hashText(text))
    contents.set(relative.toLowerCase(), text ?? '')
  }

  const requested = Array.isArray(request.paths) ? request.paths : []
  const selection = []
  const rejected = []
  for (const raw of requested) {
    const text = String(raw ?? '').trim().replace(/\\/g, '/')
    if (text === '') continue
    const match = localFiles.find(relative => relative.toLowerCase() === text.toLowerCase())
    if (match === undefined) rejected.push(text)
    else if (!selection.includes(match)) selection.push(match)
  }
  // A preflight without a selection is a dry run over the whole folder; a push
  // without one stays empty on purpose, so nothing is written unasked.
  if (selection.length === 0 && request.defaultAll === true) selection.push(...localFiles)

  const { bindings, missing } = push.resolveBindings({ selection, files: hashes, map })
  const cloud = selection.length === 0 ? { entries: new Map(), folders: push.cloudFolders([]) } : await loadCloudIndex()
  const items = push.planItems({
    bindings,
    map,
    cloud,
    markdownOf: relative => contents.get(relative.toLowerCase()),
  })
  return { workspace, map, localFiles, hashes, contents, selection, rejected, bindings, items, missing, cloud }
}

/**
 * Cloud folder id for one mirror directory, creating missing levels.
 *
 * A folder the mirror renamed on the way down (illegal characters replaced) is
 * matched back to its real cloud folder first, so pushing never leaves a
 * duplicate folder beside the original.
 */
async function ensureFolder(context, folderPath) {
  if (typeof folderPath !== 'string' || folderPath === '') return '0'
  const timeoutMs = clampTimeout(runtime().config.timeoutMs)
  const segments = folderPath.split('/').filter(segment => segment !== '')
  let parentId = '0'
  let current = ''
  for (const segment of segments) {
    current = current === '' ? segment : current + '/' + segment
    const key = current.toLowerCase()
    const existing = context.cloud.folders.byPath.get(key) ?? context.cloud.folders.byLocal.get(key)
    if (existing !== undefined) {
      parentId = existing
      continue
    }
    const created = await withSession(creds => xiaomi.createFolder(creds, { subject: segment, parentId }, { timeoutMs }))
    const id = String(created.id)
    context.cloud.folders.byId.set(id, current)
    context.cloud.folders.byPath.set(key, id)
    context.cloud.folders.byLocal.set(key, id)
    parentId = id
  }
  return parentId
}

/**
 * Record a committed write as the new sync baseline.
 *
 * `body` must be the exact text the workspace file holds. Earlier this appended
 * a newline to text that was already a file body, so the stored hash was one
 * byte longer than the file: every later comparison called the file edited, the
 * baseline re-solidified the phantom newline on each push, and the "the file was
 * saved again during the push" warning fired every time.
 *
 * The hash stored is the hash of what was submitted, not of whatever is on disk
 * afterwards: if an editor saved the file during the push, that newer text stays
 * a pending local edit instead of being silently counted as synced.
 */
async function recordCommitted(context, item, committed) {
  const body = committed.body
  const hash = store.hashText(body)
  const after = await store.readTextIfExists(store.resolveInside(context.workspace.dir, item.path))
  const afterHash = after === undefined ? '' : store.hashText(after)
  context.map.notes[committed.noteId] = {
    path: item.path,
    title: item.title,
    folderId: committed.folderId,
    folderPath: item.folderPath ?? '',
    tag: committed.tag,
    hash,
    baselineHash: hash,
    hashVersion: store.HASH_VERSION,
    cloudModifyDate: committed.modifyDate ?? 0,
    syncedAt: Date.now(),
    missing: false,
  }
  await store.writeBaseline(context.workspace.dir, committed.noteId, body)
  await store.writeMap(context.workspace.dir, context.map)
  return { pendingLocalEdit: afterHash !== hash }
}

/** After an unclear create, look for exactly one note that appeared meanwhile. */
async function recoverCreated(context, item, folderId) {
  let fresh
  try {
    fresh = await loadCloudIndex()
  } catch {
    return undefined
  }
  const candidates = []
  for (const [id, entry] of fresh.entries) {
    if (context.cloud.entries.has(id)) continue
    if (String(entry.folderId ?? '0') !== String(folderId)) continue
    if (cloudTitle(entry) !== item.title) continue
    candidates.push(entry)
  }
  return candidates.length === 1 ? candidates[0] : undefined
}

async function pushOne(context, item, options) {
  const timeoutMs = clampTimeout(runtime().config.timeoutMs)
  const markdown = context.contents.get(item.path.toLowerCase()) ?? ''
  const record = item.noteId === null ? undefined : context.map.notes[item.noteId]
  const folderId = await ensureFolder(context, item.folderPath)

  if (item.action === 'create') {
    const entry = push.entryForCreate({
      title: item.title,
      folderId,
      contentXml: markdownToXml(markdown),
      snippet: push.snippetOf(markdown),
    })
    let created
    try {
      created = await withSession(creds => xiaomi.createNote(creds, entry, { timeoutMs }))
    } catch (error) {
      const code = describeError(error).code
      if (code !== xiaomi.ERROR_CODES.network && code !== xiaomi.ERROR_CODES.timeout) throw error
      // The request may have landed. Checking the cloud is the only way to know,
      // and re-sending blind is what creates duplicate notes.
      const recovered = await recoverCreated(context, item, folderId)
      if (recovered === undefined) {
        return {
          path: item.path,
          noteId: null,
          status: 'uncertain',
          message: '创建请求结果不明，云端暂时找不到对应笔记；不要立刻重复发布，稍后用状态核对',
        }
      }
      const outcome = await recordCommitted(context, item, {
        noteId: String(recovered.id),
        tag: String(recovered.tag ?? ''),
        body: markdown,
        folderId,
        modifyDate: Number(recovered.modifyDate ?? 0),
      })
      return {
        path: item.path,
        noteId: String(recovered.id),
        status: 'created-after-check',
        message: '创建请求结果不明，核对云端后确认已创建' + (outcome.pendingLocalEdit ? '；期间文件又被编辑，已保留为待同步' : ''),
      }
    }
    const outcome = await recordCommitted(context, item, {
      noteId: String(created.id),
      tag: String(created.tag ?? ''),
      body: markdown,
      folderId,
      modifyDate: Number(created.modifyDate ?? 0),
    })
    return {
      path: item.path,
      noteId: String(created.id),
      status: 'created',
      pendingLocalEdit: outcome.pendingLocalEdit,
    }
  }

  const latest = await withSession(creds => xiaomi.getNote(creds, item.noteId, { timeoutMs }))
  if (options.force !== true && String(latest.tag ?? '') !== String(record?.tag ?? '')) {
    return {
      path: item.path,
      noteId: item.noteId,
      status: 'conflict',
      message: '云端在预检之后又有改动，已跳过这篇',
    }
  }
  const entry = push.entryForUpdate({
    latest,
    title: item.title,
    folderId,
    contentXml: item.changes?.content === true ? markdownToXml(markdown) : undefined,
    snippet: push.snippetOf(markdown),
  })
  const { conflict } = await withSession(creds => xiaomi.updateNote(creds, item.noteId, entry, { timeoutMs }))
  if (conflict) {
    return { path: item.path, noteId: item.noteId, status: 'conflict', message: '云端 tag 已过期，本次写入被拒绝' }
  }
  let saved
  try {
    saved = await withSession(creds => xiaomi.getNote(creds, item.noteId, { timeoutMs }))
  } catch (error) {
    return {
      path: item.path,
      noteId: item.noteId,
      status: 'unverified',
      message: '写入已提交，但读回最新版本失败：' + describeError(error).message,
    }
  }
  const outcome = await recordCommitted(context, item, {
    noteId: item.noteId,
    tag: String(saved.tag ?? ''),
    body: markdown,
    folderId,
    modifyDate: Number(saved.modifyDate ?? 0),
  })
  return {
    path: item.path,
    noteId: item.noteId,
    status: 'pushed',
    changes: item.changes,
    pendingLocalEdit: outcome.pendingLocalEdit,
  }
}

const ACTION_LABELS = {
  create: '新建',
  update: '更新正文',
  metadata: '改标题或分类',
  unchanged: '未变',
  conflict: '冲突',
  'cloud-gone': '云端已变或已不存在',
  blocked: '格式会丢内容',
  candidate: '绑定不唯一',
  'local-missing': '本地缺失',
}

/** Run the plan for one intent, one file at a time, never aborting the batch. */
async function runPush(request) {
  const context = await collectPlan(request)
  if (context.selection.length === 0) {
    return {
      ok: false,
      reason: 'no-selection',
      message: context.rejected.length > 0
        ? '这些路径不在工作区里：' + context.rejected.join('、')
        : '没有选中任何文件；推送与发布都必须明确指定文件',
      results: [],
    }
  }
  const intent = request.intent === 'publish' ? 'publish' : 'push'
  const wanted = intent === 'publish' ? 'create' : null
  const results = []
  for (const item of context.items) {
    if (wanted === 'create' && item.action !== 'create') {
      if (item.action !== 'unchanged') {
        results.push({
          path: item.path,
          noteId: item.noteId,
          status: 'skipped',
          action: item.action,
          message: '发布只处理还没有关联云笔记的文件（这篇是' + (ACTION_LABELS[item.action] ?? item.action) + '）',
        })
      }
      continue
    }
    if (wanted === null && (item.action === 'create' || item.action === 'unchanged')) {
      if (item.action === 'create') {
        results.push({
          path: item.path,
          noteId: null,
          status: 'skipped',
          action: 'create',
          message: '还没有关联云笔记；要创建请用「发布」',
        })
      }
      continue
    }
    if (item.action === 'blocked' || item.action === 'candidate' || item.action === 'cloud-gone') {
      results.push({
        path: item.path,
        noteId: item.noteId,
        status: 'skipped',
        action: item.action,
        message: item.reason ?? (ACTION_LABELS[item.action] ?? item.action),
        candidates: item.candidates,
      })
      continue
    }
    if (item.action === 'conflict' && request.resolve !== true) {
      results.push({
        path: item.path,
        noteId: item.noteId,
        status: 'conflict',
        action: item.action,
        message: item.reason ?? '两边都改过',
      })
      continue
    }
    try {
      results.push(await pushOne(context, item, { force: request.resolve === true }))
    } catch (error) {
      results.push({
        path: item.path,
        noteId: item.noteId,
        status: 'failed',
        action: item.action,
        message: describeError(error).message,
      })
    }
  }
  // Align the stored tag with the tag `status` and `preflight` compare against.
  // The write payload uses the *detail* tag, but cloud-changed detection reads
  // the *list* tag; storing the detail value made a just-pushed note look
  // cloud-changed on the very next status.
  const committed = results.filter(item =>
    item.noteId !== null && item.status !== 'failed' && item.status !== 'conflict' && item.status !== 'skipped',
  )
  if (committed.length > 0) {
    try {
      const fresh = await loadCloudIndex()
      let aligned = false
      for (const item of committed) {
        const entry = fresh.entries.get(item.noteId)
        const record = context.map.notes[item.noteId]
        if (entry === undefined || record === undefined) continue
        const tag = String(entry.tag ?? '')
        if (tag !== '' && tag !== record.tag) {
          record.tag = tag
          aligned = true
        }
      }
      if (aligned) await store.writeMap(context.workspace.dir, context.map)
    } catch {
      /* leaving the detail tag is harmless: the next status corrects it */
    }
  }

  return {
    ok: true,
    workspace: context.workspace.dir,
    intent,
    results,
    missing: push.planMissing(context.missing),
  }
}

/** Everything that would change, without writing anything. */
async function runPreflight(request) {
  const context = await collectPlan({ ...request, defaultAll: true })
  return {
    ok: true,
    workspace: context.workspace.dir,
    rejected: context.rejected,
    items: context.items.map(item => ({
      path: item.path,
      noteId: item.noteId,
      action: item.action,
      label: ACTION_LABELS[item.action] ?? item.action,
      title: item.title,
      folderPath: item.folderPath,
      changes: item.changes,
      reason: item.reason ?? '',
      warnings: item.warnings ?? [],
      movedFrom: item.movedFrom ?? '',
      candidates: item.candidates ?? null,
      issues: (item.issues ?? []).map(issue => ({ kind: issue.kind, label: issue.label, line: issue.line, blocking: issue.blocking })),
    })),
    missing: push.planMissing(context.missing),
  }
}

/**
 * Local, cloud and last-synced bodies side by side.
 *
 * This is the input for a merge: the agent edits the local file and then pushes
 * with `resolve`, which is the only path allowed to overwrite a note whose cloud
 * tag has moved on.
 */
async function compareNote(request) {
  const workspace = await currentWorkspace()
  const { map } = await loadMapWithHashes(workspace.dir)
  let noteId = typeof request.noteId === 'string' && request.noteId !== '' ? request.noteId : undefined
  let record = noteId === undefined ? undefined : map.notes[noteId]
  if (record === undefined) {
    const wanted = String(request.path ?? '').trim().replace(/\\/g, '/').toLowerCase()
    const pair = Object.entries(map.notes).find(([, entry]) => entry.path.toLowerCase() === wanted)
    if (pair === undefined) {
      throw new Error('这个文件还没有关联云笔记：' + (request.path ?? request.noteId ?? ''))
    }
    noteId = pair[0]
    record = pair[1]
  }
  const localText = await store.readTextIfExists(store.resolveInside(workspace.dir, record.path))
  const baseline = await store.readBaseline(workspace.dir, noteId)
  const detail = await withSession(creds => xiaomi.getNote(creds, noteId, { timeoutMs: clampTimeout(runtime().config.timeoutMs) }))
  const cloudText = xmlToMarkdown(detail.content)
  const limit = 6000
  const cut = text => (text ?? '').slice(0, limit)
  const localBody = localText ?? ''
  const baselineBody = baseline ?? ''
  // Say when the only difference is the document tail: a reader must not be
  // told "the body changed" when nothing inside it did.
  const trailingOnly = store.normalizeText(localBody) !== store.normalizeText(baselineBody)
    && store.hashText(localBody) === store.hashText(baselineBody)
  return {
    id: noteId,
    path: record.path,
    title: record.title,
    tag: String(detail.tag ?? ''),
    mapTag: record.tag,
    local: cut(localText),
    cloud: cut(cloudText),
    baseline: cut(baseline),
    truncated: localBody.length > limit || cloudText.length > limit,
    trailingOnly,
    changed: {
      local: localText !== undefined && store.hashText(localBody) !== record.hash,
      cloud: String(detail.tag ?? '') !== record.tag,
    },
  }
}

function summariseResults(result) {
  if (result.ok !== true) return result.message ?? '没有执行任何写入'
  const lines = []
  const counts = {}
  for (const item of result.results) counts[item.status] = (counts[item.status] ?? 0) + 1
  const labels = {
    created: '新建成功',
    'created-after-check': '核对后确认新建',
    pushed: '已推送',
    unchanged: '未变',
    skipped: '跳过',
    conflict: '冲突',
    uncertain: '结果待核对',
    unverified: '已提交待核对',
    failed: '失败',
  }
  lines.push('笔记工作区：' + result.workspace)
  lines.push((result.intent === 'publish' ? '发布' : '推送') + '结果：'
    + Object.entries(counts).map(([status, count]) => (labels[status] ?? status) + ' ' + count).join('，'))
  for (const item of result.results) {
    const head = '  · ' + item.path + ' — ' + (labels[item.status] ?? item.status)
    lines.push(item.message === undefined ? head : head + '：' + item.message)
    if (item.pendingLocalEdit === true) lines.push('      期间文件又被保存，新编辑仍待同步')
  }
  if (result.missing !== undefined && result.missing.length > 0) {
    lines.push('本地缺失 ' + result.missing.length + ' 篇（只记录状态，不会删除云端）：')
    for (const record of result.missing.slice(0, 8)) lines.push('  · ' + record.path)
  }
  return lines.join('\n')
}

function summarisePreflight(report) {
  const lines = ['预检：' + report.workspace]
  if (report.rejected.length > 0) lines.push('这些路径不在工作区里：' + report.rejected.join('、'))
  if (report.items.length === 0) lines.push('没有需要处理的文件')
  for (const item of report.items) {
    const head = '  · ' + item.path + ' — ' + item.label
    const detail = []
    if (item.noteId !== null) detail.push('笔记 ' + item.noteId)
    if (item.changes?.title) detail.push('标题将改为「' + item.title + '」')
    if (item.changes?.folder) detail.push('分类将改为「' + (item.folderPath === '' ? '根目录' : item.folderPath) + '」')
    if (item.changes?.content) detail.push('正文有改动')
    if (item.movedFrom !== '') detail.push('原路径 ' + item.movedFrom)
    lines.push(head + (detail.length > 0 ? '（' + detail.join('；') + '）' : ''))
    if (item.reason !== '') lines.push('      ' + item.reason)
    for (const warning of item.warnings) lines.push('      注意：' + warning)
    for (const issue of item.issues) lines.push('      格式：' + issue.label + '（第 ' + issue.line + ' 行）')
    for (const candidate of item.candidates ?? []) lines.push('      候选：' + candidate.path + '（' + candidate.id + '）')
  }
  if (report.missing.length > 0) lines.push('本地缺失 ' + report.missing.length + ' 篇（不会删除云端）')
  return lines.join('\n')
}

/* --------------------------------------------------------------------- tool */

function summariseStatus(status) {
  const lines = []
  lines.push('笔记工作区：' + status.workspace)
  lines.push('本地 Markdown ' + status.localFiles + ' 篇，已关联 ' + status.mapped + ' 篇')
  if (status.cloud.available) {
    lines.push('云端 ' + status.cloud.notes + ' 篇、目录 ' + status.cloud.folders + ' 个' + (status.cloud.complete ? '' : '（列表未取全：' + status.cloud.reason + '）'))
  } else {
    lines.push('云端不可用：' + status.cloud.error)
  }
  const labels = {
    unchanged: '未变',
    'local-changed': '本地已改',
    'cloud-changed': '云端已改',
    conflict: '两边都改',
    missing: '本地缺失',
    'cloud-gone': '云端缺失',
    'cloud-unknown': '云端未核实',
    'baseline-missing': '缺少基线',
  }
  const parts = Object.entries(status.counts).map(([state, count]) => (labels[state] ?? state) + ' ' + count)
  if (parts.length > 0) lines.push('已关联笔记：' + parts.join('，'))
  if (status.unmappedTotal > 0) lines.push('未关联的本地文件 ' + status.unmappedTotal + ' 篇' + (status.unmapped.length < status.unmappedTotal ? '（列出前 ' + status.unmapped.length + ' 篇）' : ''))
  if (status.cloudOnlyTotal > 0) lines.push('云端尚未拉取 ' + status.cloudOnlyTotal + ' 篇')
  for (const note of status.notes.slice(0, 12)) {
    if (note.state === 'unchanged') continue
    lines.push('  · ' + note.path + ' — ' + (labels[note.state] ?? note.state))
  }
  if (status.notes.length > 12) lines.push('  … 其余 ' + (status.notes.length - 12) + ' 篇略')
  return lines.join('\n')
}

function summarisePull(result) {
  if (result.ok !== true) return '拉取未执行：' + result.message
  const lines = []
  lines.push('已拉取 ' + result.pulled + ' 篇，未变 ' + result.skipped + ' 篇，冲突 ' + result.conflicts + ' 篇，失败 ' + result.failed + ' 篇')
  for (const note of result.notes.slice(0, 20)) lines.push('  ✓ ' + note.path)
  for (const note of result.conflictNotes.slice(0, 10)) {
    lines.push('  ⚠ ' + note.path + ' 与云端同时改动，云端版本已存到 ' + note.cloudCopy + '（原因：' + note.reason + '）')
  }
  for (const failure of result.failures.slice(0, 10)) lines.push('  ✗ ' + (failure.title ?? failure.id) + '：' + failure.message)
  if (result.pulled > 20) lines.push('  … 其余 ' + (result.pulled - 20) + ' 篇略')
  return lines.join('\n')
}

function createSyncTool() {
  return {
    name: 'mi_note_sync',
    description:
      'Keep a local Markdown folder and Xiaomi Cloud notes in step. '
      + '`status` lists how each linked note stands; `pull` copies cloud notes down; '
      + '`preflight` shows what a push or publish would change without writing anything; '
      + '`push` writes the named files to their linked notes; `publish` creates cloud notes for named files that have none; '
      + '`compare` returns the local, cloud and last-synced bodies of one note so a conflict can be merged. '
      + 'A local file is only ever overwritten when it is untouched, a push only touches the files named in `paths`, '
      + 'and a note is never deleted in the cloud. Pushing is explicit on purpose: changes on a phone and changes here '
      + 'are both edits, so nothing is submitted without naming the file.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: ['status', 'preflight', 'pull', 'push', 'publish', 'compare'],
          description: 'What to do. `status` and `preflight` write nothing.',
        },
        paths: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Workspace-relative file paths, such as `默认/规范.md`. Required by `push` and `publish`; '
            + 'optional for `preflight`, which then reports every file.',
        },
        path: {
          type: 'string',
          description: 'One workspace-relative path. Used by `pull` to refresh a single note and by `compare`.',
        },
        noteId: {
          type: 'string',
          description: 'Cloud note id, when it is already known. Used by `pull` and `compare`.',
        },
        full: {
          type: 'boolean',
          description: 'Rewrite every selected file even when the cloud version did not change. Only for `pull`.',
        },
        force: {
          type: 'string',
          enum: ['cloud', 'local'],
          description:
            'How to resolve a conflict during `pull`: `cloud` replaces the local file with the cloud body, '
            + '`local` keeps the local file and re-baselines against the current cloud version.',
        },
        resolve: {
          type: 'boolean',
          description:
            'Only for `push`, and only after the user has confirmed a merge: submit the local body even though the '
            + 'cloud note changed since the last sync. This overwrites that cloud revision.',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['summary', 'action'],
        properties: {
          summary: { type: 'string' },
          action: { type: 'string' },
          pulled: { type: 'integer' },
          conflicts: { type: 'integer' },
          failed: { type: 'integer' },
          workspace: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.summary }],
    },
    async execute(args) {
      const request = args !== null && typeof args === 'object' ? args : {}
      if (request.action === 'status') {
        const status = await collectStatus()
        return {
          summary: summariseStatus(status),
          action: 'status',
          workspace: status.workspace,
          conflicts: status.counts.conflict ?? 0,
          failed: (status.counts['cloud-unknown'] ?? 0) + (status.counts['baseline-missing'] ?? 0),
        }
      }
      if (request.action === 'preflight') {
        const report = await runPreflight(request)
        return {
          summary: summarisePreflight(report),
          action: 'preflight',
          workspace: report.workspace,
          conflicts: report.items.filter(item => item.action === 'conflict').length,
          failed: report.items.filter(item => item.action === 'blocked' || item.action === 'candidate').length,
        }
      }
      if (request.action === 'compare') {
        const compared = await compareNote(request)
        const lines = [
          '笔记 ' + compared.id + '：' + compared.path,
          '本地改过：' + (compared.changed.local ? '是' : '否') + '，云端改过：' + (compared.changed.cloud ? '是' : '否'),
          '',
          '--- 本地 ---',
          compared.local,
          '',
          '--- 云端 ---',
          compared.cloud,
          '',
          '--- 上次同步 ---',
          compared.baseline,
        ]
        if (compared.truncated) lines.push('', '（正文过长，以上为截断内容）')
        if (compared.trailingOnly === true) lines.push('', '（本地与基线只差文档末尾的空行，不算改动）')
        return {
          summary: lines.join('\n'),
          action: 'compare',
          workspace: (await currentWorkspace()).dir,
          conflicts: compared.changed.local && compared.changed.cloud ? 1 : 0,
          failed: 0,
        }
      }
      if (request.action === 'pull') {
        const result = await runPull({
          noteId: typeof request.noteId === 'string' ? request.noteId : undefined,
          path: typeof request.path === 'string' ? request.path : undefined,
          full: request.full === true,
          force: request.force,
        })
        return {
          summary: summarisePull(result),
          action: 'pull',
          workspace: result.workspace ?? (await currentWorkspace()).dir,
          pulled: result.pulled ?? 0,
          conflicts: result.conflicts ?? 0,
          failed: result.failed ?? 0,
        }
      }
      if (request.action === 'push' || request.action === 'publish') {
        const result = await runPush({
          intent: request.action,
          paths: Array.isArray(request.paths) ? request.paths : [],
          resolve: request.resolve === true,
        })
        const failed = result.results.filter(item => item.status === 'failed' || item.status === 'uncertain' || item.status === 'unverified').length
        const conflicts = result.results.filter(item => item.status === 'conflict').length
        return {
          summary: summariseResults(result),
          action: request.action,
          workspace: result.workspace ?? (await currentWorkspace().catch(() => ({ dir: '' }))).dir,
          pulled: result.results.filter(item => item.status === 'created' || item.status === 'created-after-check' || item.status === 'pushed').length,
          conflicts,
          failed,
        }
      }
      throw new Error('mi_note_sync: 未知的 action：' + String(request.action))
    },
    presentCall: args => ({ card: 'generic', title: '小米笔记同步', kind: 'other', rawInput: args }),
  }
}

/* ------------------------------------------------------------------- routes */

async function handleState() {
  return json(await buildState())
}

async function handleQrStart() {
  const view = await startChallenge()
  return json({ ok: true, challenge: view, state: await buildState() })
}

async function handleQrCancel() {
  cancelChallenge()
  return json({ ok: true, challenge: challengeView(runtime().challenge), state: await buildState() })
}

async function handleDisconnect() {
  cancelChallenge('已断开连接')
  await clearSession()
  runtime().challenge = null
  runtime().lastPull = null
  return json({ ok: true, state: await buildState() })
}

async function handleVerify() {
  const session = await readSession()
  if (session === undefined) return fail(409, xiaomi.ERROR_CODES.needsScan, '还没有连接小米账号')
  // Go through the list reader, not `verifyNotesAccess`: the latter swallows a
  // 401, which would hide the very expiry this endpoint exists to check.
  const ok = await withSession(async creds => {
    await xiaomi.listNotesPage(creds, { limit: 1, timeoutMs: clampTimeout(runtime().config.timeoutMs) })
    return true
  })
  return json({ ok, state: await buildState() })
}

async function handleWorkspace(request) {
  let body
  try {
    body = await request.json()
  } catch {
    return fail(400, 'mi-note/bad-request', '请求体不是 JSON')
  }
  const next = typeof body?.workspaceDir === 'string' ? body.workspaceDir.trim() : ''
  if (next !== '' && !/^[A-Za-z]:[\\/]/.test(next) && !next.startsWith('\\\\')) {
    return fail(400, 'mi-note/bad-path', '笔记工作区必须是绝对路径')
  }
  const ctx = requireContext()
  const entry = ctx.fiber?.entry
  const editor = ctx.get('configEditor')
  if (entry === undefined || editor === undefined) {
    return fail(409, 'mi-note/no-editor', '这个部署不允许插件保存自己的配置，请改 cordis.patch.yml 里的 workspaceDir')
  }
  try {
    await editor.edit(entry, current => ({ ...current, workspaceDir: next }))
  } catch (error) {
    return fail(400, 'mi-note/config-rejected', describeError(error).message)
  }
  runtime().config = { ...runtime().config, workspaceDir: next }
  return json({ ok: true, state: await buildState() })
}

async function handleSync(request) {
  let body = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }
  if (body?.action === 'status') {
    const status = await collectStatus()
    return json({ ok: true, status, summary: summariseStatus(status) })
  }
  if (body?.action === 'preflight') {
    const report = await runPreflight(body)
    return json({ ok: true, preflight: report, summary: summarisePreflight(report) })
  }
  if (body?.action === 'compare') {
    const compared = await compareNote(body)
    return json({ ok: true, compared })
  }
  if (body?.action === 'pull') {
    const result = await runPull({
      noteId: typeof body.noteId === 'string' ? body.noteId : undefined,
      path: typeof body.path === 'string' ? body.path : undefined,
      full: body.full === true,
      force: body.force,
    })
    return json({ ...result, summary: summarisePull(result) })
  }
  // Writing to the cloud stays on the agent tool: the settings page is the place
  // where the account and the folder are chosen, not a second editor.
  return fail(
    400,
    'mi-note/bad-request',
    '这个接口只接受 status、preflight、compare 与 pull；推送和发布请让 Agent 通过 mi_note_sync 工具执行',
  )
}

function createHandler(action) {
  return async function handle(request) {
    try {
      if (action === 'state') return await handleState()
      if (action === 'qr-start') return await handleQrStart()
      if (action === 'qr-cancel') return await handleQrCancel()
      if (action === 'disconnect') return await handleDisconnect()
      if (action === 'verify') return await handleVerify()
      if (action === 'workspace') return await handleWorkspace(request)
      if (action === 'sync') return await handleSync(request)
      return fail(404, 'mi-note/not-found', '未知接口：' + action)
    } catch (error) {
      const described = describeError(error)
      // Credential problems are a state the page must explain, not a server
      // fault: the browser should not read them as "the plugin crashed".
      const credentialsGone = described.code === xiaomi.ERROR_CODES.needsScan
        || described.code === xiaomi.ERROR_CODES.accessDenied
        || described.code === xiaomi.ERROR_CODES.unauthorized
      const status = credentialsGone ? 409 : 500
      const ctx = runtime().ctx
      try {
        if (described.code !== xiaomi.ERROR_CODES.needsScan) ctx?.logger?.warn?.('mi-note: ' + described.code + ': ' + described.message)
      } catch {
        /* logging must never mask the original failure */
      }
      return fail(status, described.code, described.message)
    }
  }
}

/* -------------------------------------------------------------------- apply */

export function apply(ctx, config) {
  const rt = runtime()
  rt.ctx = ctx
  rt.config = normaliseConfig(config)
  rt.challenge = null
  rt.locks = new Map()
  rt.lastPull = null
  // The runtime object outlives a plugin reload (it hangs off globalThis), so a
  // promise left over from the previous generation must not be inherited.
  rt.renewing = null

  ctx.effect(() => () => {
    cancelChallenge('插件已卸载')
    if (rt.ctx === ctx) {
      rt.ctx = undefined
      rt.challenge = null
      rt.renewing = null
    }
  })

  ctx.tools.register(createSyncTool())

  ctx.inject(['connection'], child => {
    for (const route of ROUTES) {
      child.effect(
        () => child.connection.fetch.register({
          path: route.path,
          methods: route.methods,
          requestBody: 'buffered',
          fetch: createHandler(route.action),
        }),
        'mi-note: ' + route.path,
      )
    }
    child.effect(() => () => cancelChallenge('插件已卸载'), 'mi-note: cancel the running scan on unload')
  })
}
