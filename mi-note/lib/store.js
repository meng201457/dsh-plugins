/**
 * The local mirror: the note-id map, the three-way baseline, and every
 * workspace file operation.
 *
 * Two rules drive the shape of this module.
 *
 * 1. The workspace is the only place this plugin writes. Every path that comes
 *    from the cloud or from the model is a workspace-relative POSIX path, and
 *    `resolveInside` is the single gate that turns one into a real path: an
 *    absolute path, a `..` segment, or a symlink pointing outside is refused
 *    rather than clamped.
 *
 * 2. The map is bookkeeping, never content. It records the cloud id, the last
 *    synchronized path, the cloud `tag`, the local hash, and the baseline hash;
 *    the baseline bodies live beside it so a later three-way comparison can see
 *    what the cloud said at the last successful sync. Both live in files whose
 *    names begin with a dot and are excluded from the mirror's own scan.
 */
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

export const MAP_FILE = '.mi-note-map.json'
export const BASELINE_DIR = '.mi-note-baseline'
export const MAP_VERSION = 2
/**
 * Version of the hash scheme recorded per note.
 *
 * 3 normalizes the document end. Records written before it carry no value, and
 * `loadMapWithHashes` re-baselines them from the baseline body instead of
 * treating their file as edited.
 */
export const HASH_VERSION = 3

/** Names this plugin owns; the mirror scan and the publish scope skip them. */
export function isInternalName(name) {
  return name === MAP_FILE || name === BASELINE_DIR || name.startsWith('.mi-note')
}

/* ------------------------------------------------------------------ hashing */

/**
 * Content hash used for every change decision.
 *
 * Line-ending style and trailing blank lines are not content: a note body that
 * ends with one newline and the same body ending with two are the same note,
 * and the platform itself normalizes the tail. Hashing raw bytes made such a
 * difference read as an edit forever, so the comparison normalizes both ends of
 * that axis while still catching any change inside the text.
 */
export function hashText(text) {
  const normalized = normalizeText(text).replace(/[ \t\n]+$/, '')
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex')
}

export function normalizeText(text) {
  return String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

/* -------------------------------------------------------------------- paths */

/**
 * Turn a workspace-relative POSIX path into a real path inside `root`.
 * @param {string} root - absolute workspace directory.
 * @param {string} relative - relative POSIX path from the cloud or the model.
 * @returns {string} absolute path guaranteed to be inside `root`.
 */
export function resolveInside(root, relative) {
  if (typeof relative !== 'string' || relative.trim() === '') {
    throw new Error('路径不能为空')
  }
  const raw = relative.trim().replace(/\\/g, '/')
  if (/^[A-Za-z]:/.test(raw) || raw.startsWith('/')) {
    throw new Error('只接受工作区内的相对路径：' + relative)
  }
  const segments = raw.split('/')
  for (const segment of segments) {
    if (segment === '..') throw new Error('相对路径不能越出工作区：' + relative)
  }
  const absolute = path.resolve(root, raw)
  const rel = path.relative(root, absolute)
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('相对路径不能越出工作区：' + relative)
  }
  return absolute
}

/** Workspace-relative POSIX form of one path, for the map file. */
export function toRelative(root, absolute) {
  return path.relative(root, absolute).split(path.sep).join('/')
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/**
 * Clean one path segment so Windows accepts it and the result stays readable.
 * Only the file-name segment is rewritten; directories from the cloud keep their
 * name until they collide with the rules too.
 */
export function sanitizeSegment(segment, { keepExtension = false } = {}) {
  let name = String(segment).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim()
  name = name.replace(/[. ]+$/, '')
  if (name === '') name = '未命名'
  const extension = keepExtension ? path.extname(name) : ''
  const stem = extension === '' ? name : name.slice(0, -extension.length)
  const safeStem = WINDOWS_RESERVED.test(stem) ? '_' + stem : stem
  const limit = 96
  const clipped = safeStem.length > limit ? safeStem.slice(0, limit) : safeStem
  return clipped + extension
}

/** Make `candidate` unique among `taken` by appending a counter. */
export function uniquePath(candidate, taken) {
  if (!taken.has(candidate.toLowerCase())) return candidate
  const extension = path.posix.extname(candidate)
  const stem = candidate.slice(0, candidate.length - extension.length)
  for (let index = 2; index < 1000; index += 1) {
    const next = stem + ' (' + index + ')' + extension
    if (!taken.has(next.toLowerCase())) return next
  }
  throw new Error('无法为同名文件找到空闲名称：' + candidate)
}

/* -------------------------------------------------------------------- files */

/** Write text atomically: a sibling temp file, flushed, then renamed over. */
export async function atomicWrite(file, text) {
  const directory = path.dirname(file)
  await fsp.mkdir(directory, { recursive: true })
  const temporary = path.join(directory, '.' + path.basename(file) + '.tmp-' + crypto.randomBytes(6).toString('hex'))
  const handle = await fsp.open(temporary, 'w')
  try {
    await handle.writeFile(text, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await fsp.rename(temporary, file)
  } catch (error) {
    await fsp.rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

export async function readTextIfExists(file) {
  try {
    return await fsp.readFile(file, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined
    throw error
  }
}

export async function pathExists(target) {
  try {
    await fsp.stat(target)
    return true
  } catch {
    return false
  }
}

/**
 * Every Markdown file under the workspace, as relative POSIX paths.
 * Internal bookkeeping names are skipped so the mirror never treats its own
 * files as notes.
 */
export async function listMarkdown(root) {
  const found = []
  const walk = async (directory, prefix) => {
    let entries
    try {
      entries = await fsp.readdir(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (isInternalName(entry.name)) continue
      const absolute = path.join(directory, entry.name)
      const relative = prefix === '' ? entry.name : prefix + '/' + entry.name
      if (entry.isDirectory()) {
        await walk(absolute, relative)
        continue
      }
      if (!entry.isFile()) continue
      if (!/\.md$/i.test(entry.name)) continue
      found.push(relative)
    }
  }
  await walk(root, '')
  found.sort()
  return found
}

/* ---------------------------------------------------------------------- map */

export function emptyMap() {
  return { version: MAP_VERSION, notes: {} }
}

/** Read the map, tolerating both the current shape and the older flat one. */
export async function readMap(root) {
  const file = path.join(root, MAP_FILE)
  const text = await readTextIfExists(file)
  if (text === undefined) return { map: emptyMap(), legacy: false }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('笔记映射文件无法解析（' + MAP_FILE + '），请修复或移走后重试')
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error('笔记映射文件结构不正确（' + MAP_FILE + '）')
  }
  const records = parsed.notes
  if (records === null || typeof records !== 'object') return { map: emptyMap(), legacy: false }
  const notes = {}
  let legacy = parsed.version !== MAP_VERSION
  for (const [id, record] of Object.entries(records)) {
    if (record === null || typeof record !== 'object') continue
    const relative = typeof record.path === 'string' ? record.path.replace(/\\/g, '/') : ''
    if (relative === '') continue
    notes[id] = {
      path: relative,
      title: typeof record.title === 'string' ? record.title : '',
      folderId: record.folderId === undefined || record.folderId === null ? '0' : String(record.folderId),
      folderPath: typeof record.folderPath === 'string' ? record.folderPath : '',
      tag: typeof record.tag === 'string' ? record.tag : record.tag === undefined ? '' : String(record.tag),
      hash: typeof record.hash === 'string' ? record.hash : '',
      baselineHash: typeof record.baselineHash === 'string' ? record.baselineHash : '',
      hashVersion: Number.isFinite(record.hashVersion) ? record.hashVersion : 0,
      cloudModifyDate: Number.isFinite(record.cloudModifyDate) ? record.cloudModifyDate : 0,
      syncedAt: Number.isFinite(record.syncedAt) ? record.syncedAt : 0,
      missing: record.missing === true,
    }
    if (notes[id].baselineHash === '' || notes[id].hashVersion !== HASH_VERSION) legacy = true
  }
  return { map: { version: MAP_VERSION, notes }, legacy }
}

export async function writeMap(root, map) {
  const body = JSON.stringify({ version: MAP_VERSION, notes: map.notes }, null, 2) + '\n'
  await atomicWrite(path.join(root, MAP_FILE), body)
}

/* ----------------------------------------------------------------- baseline */

function baselinePath(root, noteId) {
  return path.join(root, BASELINE_DIR, sanitizeSegment(String(noteId)) + '.md')
}

export async function readBaseline(root, noteId) {
  return readTextIfExists(baselinePath(root, noteId))
}

export async function writeBaseline(root, noteId, text) {
  await atomicWrite(baselinePath(root, noteId), normalizeText(text))
}

export async function removeBaseline(root, noteId) {
  await fsp.rm(baselinePath(root, noteId), { force: true })
}

/* ---------------------------------------------------------------- workspace */

/**
 * Decide the mirror directory, creating it on first use.
 *
 * An empty `workspaceDir` falls back to `<base>/<mirrorDir>`, which keeps the
 * folder inside the default DSH workspace instead of scattering notes.
 */
export async function ensureWorkspace({ configuredDir, baseDir, mirrorDir }) {
  const configured = typeof configuredDir === 'string' ? configuredDir.trim() : ''
  let target
  if (configured !== '') {
    if (!path.isAbsolute(configured)) throw new Error('笔记工作区必须是绝对路径：' + configured)
    target = path.resolve(configured)
  } else {
    if (typeof baseDir !== 'string' || baseDir === '') {
      throw new Error('还没有配置笔记工作区，也没有可用的默认工作区')
    }
    const segment = sanitizeSegment(mirrorDir === '' ? 'mi-notes' : String(mirrorDir))
    target = path.resolve(baseDir, segment)
  }
  await fsp.mkdir(target, { recursive: true })
  return target
}
