/**
 * Push-direction decisions: binding a local file to a cloud note, and saying
 * what a push would change.
 *
 * This module is deliberately free of HTTP and filesystem access. Everything
 * here is a pure function of the note map, the cloud listing and the hashes the
 * caller already computed, which makes the decision matrix testable without a
 * Xiaomi account — and the decision matrix is the part that can destroy a note.
 *
 * Two rules shape every branch:
 *
 *  - The local file is the user's work. Nothing here decides to overwrite it;
 *    only the cloud direction is ever written.
 *  - An unclear identity is reported, never resolved by guessing. A file that
 *    might be a rename of an existing note becomes a candidate list, because
 *    guessing wrong would either duplicate a note or overwrite the wrong one.
 */
import path from 'node:path'
import { hashText, sanitizeSegment } from './store.js'
import { analyse } from './note-format.js'

/* --------------------------------------------------------------- cloud data */

/**
 * Index the cloud folders by id, by their full path, and by the path the local
 * mirror would have given them.
 *
 * The third index matters: a cloud folder may be named `a:b`, which the mirror
 * had to store as `a_b`. Without it, pushing that folder back would create a
 * second cloud folder called `a_b` next to the original.
 * @param {Array<object>} folders - folder entries from the list API.
 * @returns {{ byId: Map<string, string>, byPath: Map<string, string>, byLocal: Map<string, string> }}
 */
export function cloudFolders(folders) {
  const entries = new Map()
  for (const folder of folders) {
    if (folder?.id === undefined) continue
    entries.set(String(folder.id), folder)
  }
  const byId = new Map()
  const byPath = new Map()
  const byLocal = new Map()
  for (const id of entries.keys()) {
    const segments = []
    let current = id
    let guard = 0
    while (current !== '0' && current !== '' && guard < 32) {
      const folder = entries.get(current)
      if (folder === undefined) break
      const subject = String(folder.subject ?? '').trim()
      if (subject !== '') segments.unshift(subject)
      current = folder.parentId === undefined || folder.parentId === null ? '0' : String(folder.parentId)
      guard += 1
    }
    const full = segments.join('/')
    byId.set(id, full)
    if (full === '') continue
    byPath.set(full.toLowerCase(), id)
    const local = segments.map(segment => sanitizeSegment(segment)).join('/').toLowerCase()
    if (!byLocal.has(local)) byLocal.set(local, id)
  }
  return { byId, byPath, byLocal, entries }
}

/** Cloud folder id for one workspace-relative directory, or undefined. */
export function folderIdFor(cloud, relativePath) {
  const directory = path.posix.dirname(relativePath.split(path.sep).join('/'))
  if (directory === '.' || directory === '') return '0'
  return cloud.byPath.get(directory.toLowerCase())
}

/* ----------------------------------------------------------------- metadata */

/**
 * Build the `extraInfo` JSON string, preserving every field the cloud already
 * carries and overriding only the title.
 */
export function buildExtraInfo(title, existingRaw) {
  let existing = {}
  if (typeof existingRaw === 'string' && existingRaw.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(existingRaw)
      if (parsed !== null && typeof parsed === 'object') existing = parsed
    } catch {
      existing = {}
    }
  } else if (existingRaw !== null && typeof existingRaw === 'object') {
    existing = existingRaw
  }
  const info = {
    note_content_type: existing.note_content_type ?? 'common',
    title: existing.title,
    web_images: existing.web_images,
    mind_content: existing.mind_content,
    mind_content_plain_text: existing.mind_content_plain_text,
  }
  if (title !== undefined) info.title = title
  const kept = Object.entries(info).filter(([, value]) => value !== undefined && value !== '')
  if (kept.length === 0) return undefined
  return JSON.stringify(Object.fromEntries(kept))
}

/** Plain-text preview the phone shows in its note list. */
export function snippetOf(markdown, max = 120) {
  const plain = String(markdown ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_~`|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.slice(0, max)
}

/* --------------------------------------------------------------- bindings */

/**
 * Bind each selected local file to a cloud note.
 *
 * The interesting case is a file the user renamed or moved in Explorer. The
 * map still points at the old path, so the binding is re-established by
 * content: a record whose file has disappeared and whose recorded hash equals
 * this file's hash is the same note, and that keeps the cloud id (and therefore
 * the note itself) intact. When more than one record matches, nothing is
 * decided.
 * @param {{ selection: string[], files: Map<string, string>, map: { notes: Record<string, object> } }} input
 *   `files` maps a lower-cased workspace-relative path to that file's hash.
 */
export function resolveBindings({ selection, files, map }) {
  const byPath = new Map()
  for (const [id, record] of Object.entries(map.notes)) {
    if (record?.path) byPath.set(record.path.toLowerCase(), { id, record })
  }

  // Records whose file is gone are the only candidates for "this is a rename".
  const orphaned = []
  for (const [id, record] of Object.entries(map.notes)) {
    if (record?.path && !files.has(record.path.toLowerCase())) {
      orphaned.push({ id, record })
    }
  }

  const claimed = new Set()
  const bindings = []
  for (const relative of selection) {
    const key = relative.toLowerCase()
    const hash = files.get(key) ?? ''
    const direct = byPath.get(key)
    if (direct !== undefined) {
      claimed.add(direct.id)
      bindings.push({ path: relative, noteId: direct.id, kind: 'mapped', record: direct.record })
      continue
    }
    const candidates = orphaned.filter(entry =>
      !claimed.has(entry.id) && entry.record.hash !== '' && entry.record.hash === hash,
    )
    if (candidates.length === 1) {
      claimed.add(candidates[0].id)
      bindings.push({
        path: relative,
        noteId: candidates[0].id,
        kind: 'moved',
        record: candidates[0].record,
        movedFrom: candidates[0].record.path,
      })
      continue
    }
    if (candidates.length > 1) {
      bindings.push({
        path: relative,
        noteId: null,
        kind: 'ambiguous',
        record: null,
        candidates: candidates.map(entry => ({ id: entry.id, path: entry.record.path, title: entry.record.title })),
      })
      continue
    }
    bindings.push({ path: relative, noteId: null, kind: 'new', record: null })
  }

  const missing = Object.entries(map.notes)
    .filter(([, record]) => record?.path && !files.has(record.path.toLowerCase()))
    .map(([id, record]) => ({ id, path: record.path, title: record.title }))

  return { bindings, missing }
}

/* -------------------------------------------------------------------- plan */

function stemOf(relative) {
  const base = path.posix.basename(relative.split(path.sep).join('/'))
  return base.replace(/\.md$/i, '')
}

function directoryOf(relative) {
  const normalised = relative.split(path.sep).join('/')
  const directory = path.posix.dirname(normalised)
  return directory === '.' ? '' : directory
}

/**
 * Decide what a push or publish would do to each file.
 *
 * `action` is one of:
 *   `create`     — no note is bound yet; publishing is the only way forward
 *   `update`     — body or metadata changed locally, the cloud did not move
 *   `metadata`   — only the file name or its folder changed
 *   `unchanged`  — nothing to do
 *   `conflict`   — the cloud moved on too; nothing is written
 *   `cloud-gone` — the bound note no longer exists in the cloud
 *   `blocked`    — a format problem would lose content that must survive
 *   `candidate`  — the binding is unclear; the caller must pick
 * @param {{ bindings: Array<object>, map: object, cloud: object, markdownOf: (relative: string) => string | undefined }} input
 */
export function planItems({ bindings, map, cloud, markdownOf }) {
  const items = []
  for (const binding of bindings) {
    const directory = directoryOf(binding.path)
    const title = stemOf(binding.path)

    if (binding.kind === 'ambiguous') {
      items.push({
        path: binding.path,
        noteId: null,
        action: 'candidate',
        title,
        folderPath: directory,
        candidates: binding.candidates,
        reason: '看起来是已有关联笔记的移动，但有多个候选，需要明确绑定后才能推送',
      })
      continue
    }

    const markdown = markdownOf(binding.path)
    const issues = markdown === undefined ? [] : analyse(markdown).issues
    const blocking = issues.some(issue => issue.blocking === true)

    if (binding.kind === 'new') {
      items.push({
        path: binding.path,
        noteId: null,
        action: blocking ? 'blocked' : 'create',
        title,
        folderPath: directory,
        changes: { title: true, folder: true, content: true },
        issues,
        reason: blocking ? '格式问题会让内容在手机上丢失' : '还没有关联云笔记，只有显式发布才会创建',
      })
      continue
    }

    const record = binding.record
    const noteId = binding.noteId
    const entry = cloud.entries.get(noteId)
    const hash = hashText(markdown ?? '')
    const localChanged = record.hash !== '' && hash !== record.hash
    const titleChanged = title !== (record.title ?? '')
    const folderChanged = directory.toLowerCase() !== String(record.folderPath ?? '').toLowerCase()
    const warnings = []
    if (record.baselineHash === '') warnings.push('缺少上次同步的基线，只能按本地哈希与云端 tag 判断')

    if (entry === undefined) {
      items.push({
        path: binding.path,
        noteId,
        action: 'cloud-gone',
        title,
        folderPath: directory,
        changes: { title: titleChanged, folder: folderChanged, content: localChanged },
        issues,
        warnings,
        reason: '这篇笔记在云端已经不存在（列表已取全），不做任何写入',
      })
      continue
    }

    const cloudChanged = String(entry.tag ?? '') !== record.tag
    if (cloudChanged && localChanged) {
      items.push({
        path: binding.path,
        noteId,
        action: 'conflict',
        title,
        folderPath: directory,
        changes: { title: titleChanged, folder: folderChanged, content: true },
        issues,
        warnings,
        reason: '本地和云端都改过，需要先比较或合并',
      })
      continue
    }
    if (cloudChanged) {
      items.push({
        path: binding.path,
        noteId,
        action: 'cloud-gone',
        title,
        folderPath: directory,
        changes: { title: titleChanged, folder: folderChanged, content: false },
        issues,
        warnings,
        reason: '云端已经更新，先拉取再决定要不要推送',
        cloudMovedOn: true,
      })
      continue
    }
    if (!localChanged && !titleChanged && !folderChanged) {
      items.push({
        path: binding.path,
        noteId,
        action: 'unchanged',
        title,
        folderPath: directory,
        changes: { title: false, folder: false, content: false },
        issues,
        warnings,
      })
      continue
    }
    if (blocking) {
      items.push({
        path: binding.path,
        noteId,
        action: 'blocked',
        title,
        folderPath: directory,
        changes: { title: titleChanged, folder: folderChanged, content: localChanged },
        issues,
        warnings,
        reason: '格式问题会让内容在手机上丢失',
      })
      continue
    }
    const changes = { title: titleChanged, folder: folderChanged, content: localChanged }
    const action = localChanged ? 'update' : 'metadata'
    items.push({
      path: binding.path,
      noteId,
      action,
      title,
      folderPath: directory,
      changes,
      issues,
      warnings,
      movedFrom: binding.movedFrom,
    })
  }
  return items
}

/** Entries whose file is gone locally: they are only ever marked, never deleted. */
export function planMissing(missing) {
  return missing.map(record => ({
    noteId: record.id,
    path: record.path,
    title: record.title,
    action: 'local-missing',
    reason: '本地文件已不存在，只记录缺失状态，不会删除云端笔记',
  }))
}

/**
 * Assemble one write payload for an existing note.
 *
 * `latest` is the just-read cloud record: it is the only authoritative source
 * for `tag`, attachments (`setting`) and unrelated metadata, and the design
 * requires keeping all three when only the title or the folder changes. Pass
 * `contentXml` only when the body itself changed; leaving it out keeps the
 * cloud body and its snippet untouched.
 */
export function entryForUpdate({ latest, title, folderId, contentXml, snippet }) {
  const now = Date.now()
  const keepContent = contentXml === undefined
  return {
    id: String(latest.id),
    tag: latest.tag,
    status: latest.status,
    createDate: typeof latest.createDate === 'number' ? latest.createDate : now,
    modifyDate: now,
    colorId: typeof latest.colorId === 'number' ? latest.colorId : 0,
    content: keepContent ? (latest.content ?? '') : contentXml,
    setting: latest.setting ?? { themeId: 0, stickyTime: 0, version: 0 },
    folderId: folderId ?? String(latest.folderId ?? '0'),
    alertDate: typeof latest.alertDate === 'number' ? latest.alertDate : 0,
    extraInfo: buildExtraInfo(title, latest.extraInfo),
    subject: latest.subject,
    snippet: keepContent ? latest.snippet : snippet,
  }
}

/** Assemble the create payload for a note that does not exist yet. */
export function entryForCreate({ title, folderId, contentXml, snippet }) {
  const now = Date.now()
  return {
    colorId: 0,
    folderId: String(folderId ?? '0'),
    createDate: now,
    modifyDate: now,
    content: contentXml,
    alertDate: 0,
    setting: { themeId: 0, stickyTime: 0, version: 0 },
    extraInfo: buildExtraInfo(title),
    snippet: snippet ?? snippetOf(''),
  }
}
