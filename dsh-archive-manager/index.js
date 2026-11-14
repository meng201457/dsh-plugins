/**
 * dsh-archive-manager - Host half.
 *
 * Answers the archived-session manager with the Host-owned truth (the workspace
 * registry's archive set, workspace membership, stored titles, on-disk sizes)
 * and performs the one operation the shipped Harness does not offer: permanently
 * deleting archived sessions, one at a time or as a multi-selected batch.
 *
 * Routes are registered on the authenticated /api bridge through
 * connection.fetch, not as a webServer prefix route. The web server resolves the
 * longest prefix first, so a plugin prefix under /api would shadow the bridge and
 * drop the browser-auth fence; connection.fetch keeps the authentication and the
 * owner-only check that a destructive endpoint needs.
 *
 * Delete order is deliberate: quiesce (archive with stopActivity), prune the
 * archive and pin sets, detach the session from every workspace, and only then
 * remove the log directory. A failure after the registry step cannot hide a
 * session that is still present, and a failure in the registry step cannot
 * strand a log the UI no longer knows about.
 */
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export const name = 'dsh-archive-manager'
export const inject = []

const ROUTE = '/api/dsh-archive-manager'
const RUNTIME = Symbol.for('dsh-archive-manager/runtime')
const MAX_BATCH = 200

const ROUTES = [
  { path: ROUTE + '/health', methods: ['GET'], action: 'health' },
  { path: ROUTE + '/state', methods: ['GET'], action: 'state' },
  { path: ROUTE + '/delete', methods: ['POST'], action: 'delete' },
  { path: ROUTE + '/unarchive', methods: ['POST'], action: 'unarchive' },
]

/* ----------------------------------------------------------------- runtime */

function runtime() {
  if (globalThis[RUNTIME] === undefined) {
    globalThis[RUNTIME] = { ctx: undefined, config: {}, startedAt: Date.now(), lastDeleteAt: 0 }
  }
  return globalThis[RUNTIME]
}

/* ----------------------------------------------------------------- helpers */

function fail(status, code, message) {
  return Response.json({ ok: false, error: { code: code, message: message }, message: message }, { status: status })
}

function requireService(ctx, key) {
  const service = ctx?.get?.(key)
  if (service === undefined || service === null) throw new Error('Host service "' + key + '" is not available yet')
  return service
}

function homeDir() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv
  // The desktop host does not always inherit DSH_HOME; the default home is the
  // same one dsh-home-paths resolves, so fall back to it instead of failing.
  return path.join(os.homedir(), '.dsh')
}

function safeHome() {
  try {
    return homeDir()
  } catch {
    return undefined
  }
}

/** Single-segment escape used by the JSONL persistence layer for session ids. */
function encodeSegment(raw) {
  if (raw.length === 0) return raw
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (let index = 0; index < raw.length; index += 1) {
    const code = raw.charCodeAt(index)
    const ch = String.fromCharCode(code)
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) out += ch
    else out += '~' + code.toString(16).toUpperCase().padStart(4, '0')
  }
  return out
}

async function measureDir(dir) {
  let bytes = 0
  let mtime = 0
  const stack = [dir]
  while (stack.length > 0) {
    const current = stack.pop()
    let entries
    try {
      entries = await fsp.readdir(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const target = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(target)
        continue
      }
      try {
        const info = await fsp.lstat(target)
        if (!info.isFile()) continue
        bytes += info.size
        mtime = Math.max(mtime, info.mtimeMs)
      } catch {
        /* a file that vanished mid-walk contributes nothing */
      }
    }
  }
  return { bytes: bytes, mtime: mtime }
}

/** Last-resort lookup of a session directory when the persistence report has no path. */
async function scanSessionDirs(sessionId) {
  const root = path.join(homeDir(), 'sessions')
  const segment = encodeSegment(sessionId)
  const found = []
  let projects = []
  try {
    projects = await fsp.readdir(root, { withFileTypes: true })
  } catch {
    return found
  }
  for (const project of projects) {
    if (!project.isDirectory()) continue
    const candidate = path.join(root, project.name, segment)
    try {
      if ((await fsp.lstat(candidate)).isDirectory()) found.push(candidate)
    } catch {
      /* absent */
    }
  }
  return found
}

function projectionCachePath(sessionId) {
  return path.join(homeDir(), 'storages', 'session_projcache', 'sessions', encodeSegment(sessionId) + '.json')
}

async function cachedTitle(sessionId) {
  try {
    const raw = await fsp.readFile(projectionCachePath(sessionId), 'utf8')
    const parsed = JSON.parse(raw)
    const title = parsed?.record?.rows?.title?.val
    return typeof title === 'string' && title.trim() !== '' ? title : undefined
  } catch {
    return undefined
  }
}

function titleFromSnapshot(entry) {
  if (entry === undefined || entry === null) return undefined
  if (entry.status === 'rejected') return undefined
  const value = entry.status === 'fulfilled' ? entry.value : entry
  if (value === undefined || value === null) return undefined
  // The Host reports a folded title record ({title, messageSeqs, source, ...});
  // older shapes hand back the plain string, so accept both.
  let raw = value.title
  if (raw !== null && typeof raw === 'object' && typeof raw.title === 'string') raw = raw.title
  if (typeof raw !== 'string' || raw.trim() === '') return undefined
  const id = entry.sessionId ?? value.sessionId ?? value.session?.id
  return { id: id === undefined ? undefined : String(id), title: raw }
}

async function collectTitles(ctx, ids) {
  const titles = new Map()
  if (ids.length === 0) return titles
  const query = ctx.get('sessionQuery')
  if (query !== undefined && typeof query.readTitleSnapshots === 'function' && ids.length <= 80) {
    try {
      const settled = await query.readTitleSnapshots(ids)
      if (Array.isArray(settled)) {
        for (let index = 0; index < settled.length; index += 1) {
          const parsed = titleFromSnapshot(settled[index])
          if (parsed === undefined) continue
          const id = parsed.id ?? ids[index]
          if (id !== undefined) titles.set(String(id), parsed.title)
        }
      }
      if (titles.size === ids.length) return titles
    } catch {
      /* fall through to the projection cache */
    }
  }
  for (const id of ids) {
    if (titles.has(id)) continue
    const title = await cachedTitle(id)
    if (title !== undefined) titles.set(id, title)
  }
  return titles
}

/** Header, physical location and size of one stored session, from persistence when possible. */
async function inspectSession(ctx, sessionId) {
  const persistence = ctx.get('sessionPersistence')
  if (persistence !== undefined && typeof persistence.stat === 'function') {
    try {
      const snapshot = await persistence.stat(sessionId)
      if (snapshot !== undefined && snapshot !== null) {
        return {
          header: snapshot.header,
          location: typeof snapshot.location?.path === 'string' ? snapshot.location.path : undefined,
          sizeBytes: typeof snapshot.sizeBytes === 'number' ? snapshot.sizeBytes : undefined,
          dirs: undefined,
        }
      }
    } catch {
      /* fall back to the filesystem scan below */
    }
  }
  return { header: undefined, location: undefined, sizeBytes: undefined, dirs: await scanSessionDirs(sessionId) }
}

async function describeSession(ctx, sessionId, header, title) {
  const inspected = await inspectSession(ctx, sessionId)
  const effectiveHeader = header ?? inspected.header
  let bytes = 0
  let mtime = 0
  let directories = 0
  const roots = []
  if (inspected.location !== undefined) roots.push(path.dirname(inspected.location))
  else if (Array.isArray(inspected.dirs)) roots.push(...inspected.dirs)
  for (const dir of roots) {
    const measured = await measureDir(dir)
    bytes += measured.bytes
    mtime = Math.max(mtime, measured.mtime)
    directories += 1
  }
  let cacheBytes = 0
  try {
    const info = await fsp.lstat(projectionCachePath(sessionId))
    cacheBytes = info.size
    mtime = Math.max(mtime, info.mtimeMs)
  } catch {
    /* no projection cache */
  }
  const createdAt = typeof effectiveHeader?.createdAt === 'number' ? effectiveHeader.createdAt : undefined
  const liveStore = ctx.get('sessions')
  const live = liveStore !== undefined && typeof liveStore.get === 'function' && liveStore.get(sessionId) !== undefined
  return {
    id: sessionId,
    live: live,
    title: title === undefined ? undefined : title,
    cwd: typeof effectiveHeader?.cwd === 'string' ? effectiveHeader.cwd : undefined,
    createdAt: createdAt,
    updatedAt: mtime > 0 ? mtime : createdAt,
    bytes: bytes + cacheBytes,
    logBytes: bytes,
    cacheBytes: cacheBytes,
    stored: roots.length > 0,
    directories: directories,
  }
}

/* -------------------------------------------------------------------- state */

async function collectState(ctx) {
  const registry = requireService(ctx, 'workspaceRegistry')
  const archivedIds = registry.archivedSessionIds.map(String)
  const workspaces = registry.list().map((workspace) => ({
    id: String(workspace.id),
    title: workspace.title,
    path: workspace.path,
    sessionIds: workspace.sessionIds.map(String),
  }))
  const ownerBySession = new Map()
  for (const workspace of workspaces) {
    for (const sessionId of workspace.sessionIds) {
      if (!ownerBySession.has(sessionId)) ownerBySession.set(sessionId, workspace.id)
    }
  }

  const query = ctx.get('sessionQuery')
  const headers = new Map()
  if (query !== undefined && typeof query.listSessions === 'function') {
    try {
      const records = await query.listSessions()
      if (Array.isArray(records)) {
        for (const record of records) {
          if (record?.header?.id !== undefined) headers.set(String(record.header.id), record.header)
        }
      }
    } catch {
      /* the registry still answers without headers */
    }
  }

  const titles = await collectTitles(ctx, archivedIds)
  const described = new Map()
  for (const sessionId of archivedIds) {
    described.set(sessionId, await describeSession(ctx, sessionId, headers.get(sessionId), titles.get(sessionId)))
  }

  const buckets = []
  for (const workspace of workspaces) {
    const sessions = workspace.sessionIds
      .filter((sessionId) => described.has(sessionId))
      .map((sessionId) => described.get(sessionId))
    if (sessions.length === 0) continue
    let manifest = false
    try {
      manifest = (await fsp.stat(workspace.path)).isDirectory()
    } catch {
      manifest = false
    }
    buckets.push({ workspaceId: workspace.id, title: workspace.title, path: workspace.path, manifest: manifest, sessions: sessions })
  }

  const orphans = archivedIds
    .filter((sessionId) => !ownerBySession.has(sessionId))
    .map((sessionId) => described.get(sessionId))

  const sessions = Array.from(described.values())
  let bytes = 0
  for (const entry of sessions) bytes += entry.bytes ?? 0
  return {
    version: 2,
    generatedAt: Date.now(),
    home: safeHome(),
    workspaces: buckets,
    orphans: orphans,
    totals: { workspaces: buckets.length, sessions: sessions.length, bytes: bytes },
  }
}

/* ------------------------------------------------------------------- delete */

function readIds(body) {
  const raw = body?.ids ?? body?.sessionIds
  if (!Array.isArray(raw)) throw new Error('ids must be an array of session ids')
  const ids = []
  for (const item of raw) {
    if (typeof item !== 'string' || item.trim() === '') throw new Error('session ids must be non-empty strings')
    const id = item.trim()
    if (!ids.includes(id)) ids.push(id)
  }
  if (ids.length === 0) throw new Error('no session id was provided')
  if (ids.length > MAX_BATCH) throw new Error('at most ' + MAX_BATCH + ' sessions can be handled in one batch')
  return ids
}

function rootsOf(inspected) {
  if (inspected.location !== undefined) return [path.dirname(inspected.location)]
  if (Array.isArray(inspected.dirs)) return inspected.dirs
  return []
}

async function removeSessionDir(inspected, sessionId) {
  const removed = []
  const warnings = []
  for (const dir of rootsOf(inspected)) {
    try {
      await fsp.rm(dir, { recursive: true, force: true })
      removed.push(dir)
    } catch (error) {
      warnings.push({ path: dir, message: error?.message ?? String(error) })
    }
  }
  try {
    await fsp.rm(projectionCachePath(sessionId), { force: true })
  } catch {
    /* a missing or locked cache file never blocks the delete */
  }
  return { removed: removed, warnings: warnings }
}

/**
 * Tell every connected client that a session is gone. The Host only emits this on
 * its own "session/disposed", which never fires for a stored session we delete
 * from disk: without it a window that already listed the row keeps it (and shows
 * it under Ungrouped once the workspace membership is dropped). The event is the
 * same one the product relays for a disposed session, so clients prune the row
 * instead of refetching.
 */
function announceRemoval(ctx, sessionId) {
  try {
    ctx.emit('api-session/removed', sessionId)
  } catch (error) {
    ctx.logger?.warn?.('dsh-archive-manager: could not announce removal: ' + (error?.message ?? String(error)))
  }
}

async function detachEverywhere(registry, sessionId) {
  for (const workspace of registry.list()) {
    if (workspace.sessionIds.map(String).includes(sessionId)) await workspace.detachSession(sessionId)
  }
}

async function deleteSessions(ctx, ids) {
  const registry = requireService(ctx, 'workspaceRegistry')
  const live = ctx.get('sessions')
  const deleted = []
  const failed = []
  const warnings = []

  for (const sessionId of ids) {
    if (live !== undefined && typeof live.get === 'function' && live.get(sessionId) !== undefined) {
      failed.push({ id: sessionId, code: 'archive/session-live', message: '该会话仍附着在运行中的 Harness 上，请先离开它再删除' })
      continue
    }
    const inspected = await inspectSession(ctx, sessionId)
    if (rootsOf(inspected).length === 0) {
      // Nothing on disk: prune any stale registry entry and report idempotent success.
      try {
        await registry.unarchiveSession(sessionId)
        await detachEverywhere(registry, sessionId)
      } catch (error) {
        warnings.push({ id: sessionId, step: 'registry', message: error?.message ?? String(error) })
      }
      deleted.push({ id: sessionId, missing: true, removedDirectories: 0 })
      announceRemoval(ctx, sessionId)
      continue
    }

    try {
      // Prune the archive and pin sets first, then workspace accounting. Archiving again
      // would be a no-op for an already archived id (the registry returns early without
      // stopping anything), so the quiesce guarantee comes from the live check above and
      // from the archived-session gate that already blocks wakes for archived ids.
      await registry.unarchiveSession(sessionId)
      await detachEverywhere(registry, sessionId)
      try {
        if (registry.pinnedSessionIds.map(String).includes(sessionId)) await registry.unpinSession(sessionId)
      } catch (error) {
        warnings.push({ id: sessionId, step: 'unpin', message: error?.message ?? String(error) })
      }
    } catch (error) {
      failed.push({ id: sessionId, code: error?.code ?? 'archive/registry', message: error?.message ?? String(error) })
      continue
    }

    const outcome = await removeSessionDir(inspected, sessionId)
    for (const warning of outcome.warnings) warnings.push({ id: sessionId, step: 'remove-dir', path: warning.path, message: warning.message })
    deleted.push({ id: sessionId, missing: false, removedDirectories: outcome.removed.length })
    announceRemoval(ctx, sessionId)
  }

  runtime().lastDeleteAt = Date.now()
  return { deleted: deleted, failed: failed, warnings: warnings }
}

async function unarchiveSessions(ctx, ids) {
  const registry = requireService(ctx, 'workspaceRegistry')
  const archived = new Set(registry.archivedSessionIds.map(String))
  const restored = []
  const failed = []
  for (const sessionId of ids) {
    if (!archived.has(sessionId)) {
      failed.push({ id: sessionId, code: 'archive/not-archived', message: '该会话不在归档集合中' })
      continue
    }
    try {
      await registry.unarchiveSession(sessionId)
      restored.push(sessionId)
      archived.delete(sessionId)
    } catch (error) {
      failed.push({ id: sessionId, code: 'archive/registry', message: error?.message ?? String(error) })
    }
  }
  return { restored: restored, failed: failed }
}

/* ------------------------------------------------------------------ handler */

function createHandler(action) {
  return async function handleArchiveManager(request) {
    const ctx = runtime().ctx
    if (ctx === undefined) return fail(503, 'archive/not-ready', 'plugin is not ready yet')
    try {
      if (action === 'health') {
        const registry = ctx.get('workspaceRegistry')
        return Response.json({
          home: safeHome(),
          live: ctx.get('sessions') === undefined ? null : ctx.get('sessions').list().map((session) => String(session.id)),
          ok: true,
          version: 2,
          startedAt: runtime().startedAt,
          lastDeleteAt: runtime().lastDeleteAt,
          services: {
            workspaceRegistry: registry !== undefined && registry !== null,
            sessionPersistence: ctx.get('sessionPersistence') !== undefined,
            sessionQuery: ctx.get('sessionQuery') !== undefined,
            sessions: ctx.get('sessions') !== undefined,
          },
          archived: registry === undefined || registry === null ? 0 : registry.archivedSessionIds.length,
        })
      }
      if (action === 'state') {
        return Response.json(Object.assign({ ok: true }, await collectState(ctx)))
      }
      if (action === 'unarchive' || action === 'delete') {
        let body
        try {
          body = await request.json()
        } catch {
          return fail(400, 'archive/bad-request', 'body is not JSON')
        }
        let ids
        try {
          ids = readIds(body)
        } catch (error) {
          return fail(400, 'archive/bad-request', error?.message ?? String(error))
        }
        const result = action === 'delete' ? await deleteSessions(ctx, ids) : await unarchiveSessions(ctx, ids)
        if (action === 'delete') {
          ctx.logger?.info?.('dsh-archive-manager: deleted ' + result.deleted.length + '/' + ids.length + ' archived session(s)')
        }
        const state = await collectState(ctx).catch(() => undefined)
        return Response.json(Object.assign({ ok: true }, result, { state: state }))
      }
      return fail(404, 'archive/not-found', 'unknown endpoint: ' + action)
    } catch (error) {
      return fail(500, error?.code ?? 'archive/failed', error?.message ?? String(error))
    }
  }
}

export function apply(ctx, config) {
  const rt = runtime()
  rt.config = config ?? {}
  ctx.effect(() => () => {
    if (rt.ctx === ctx) rt.ctx = undefined
  })
  ctx.inject(['connection'], (child) => {
    rt.ctx = child
    for (const route of ROUTES) {
      child.effect(
        () =>
          child.connection.fetch.register({
            path: route.path,
            methods: route.methods,
            requestBody: 'buffered',
            fetch: createHandler(route.action),
          }),
        'dsh-archive-manager: ' + route.path,
      )
    }
  })
}