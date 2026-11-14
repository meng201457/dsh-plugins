window.__ModuleLoader__.load({
  id: 'dsh-archive-manager',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const PANEL_ID = 'archive-manager'
    const API = '/api/dsh-archive-manager'

    /* ------------------------------------------------------------ i18n */

    const TEXT = {
      zh: {
        panel: '归档会话',
        title: '归档会话管理',
        subtitle: '按工作区分组列出已归档的会话。删除会移除会话日志与索引记录，无法撤销。',
        refresh: '刷新',
        refreshing: '刷新中…',
        back: '返回对话',
        selectAll: '全选',
        clearAll: '取消选择',
        selected: '已选 {n} 项',
        deleteSelected: '删除所选',
        restoreSelected: '取消归档所选',
        restore: '取消归档',
        restoreHint: '让它重新出现在侧边栏的会话列表里',
        delete: '删除',
        deleteHint: '永久删除该会话的日志、缓存与索引记录',
        empty: '还没有归档的会话。',
        emptyHint: '在侧边栏会话行的「…」菜单里选择「归档」即可把会话收进来。',
        emptySelection: '勾选左侧复选框即可多选删除。',
        loading: '正在读取归档会话…',
        retry: '重试',
        errorPrefix: '读取失败：',
        orphanGroup: '未归属工作区',
        folderMissing: '目录已不存在',
        total: '{n} 个工作区 · {m} 个会话 · {size}',
        sessionCount: '{n} 个',
        created: '创建于 {time}',
        updated: '更新于 {time}',
        confirmTitle: '永久删除归档会话',
        confirmBody: '即将删除 {n} 个已归档会话。会话日志、投影缓存和索引记录都会被移除，删除后无法恢复。',
        confirmMore: '以及另外 {n} 个会话',
        confirmCancel: '取消',
        confirmDelete: '永久删除',
        deleting: '删除中…',
        deleted: '已删除 {n} 个归档会话',
        deletedPartial: '已删除 {n} 个，{m} 个失败',
        restored: '已取消归档 {n} 个会话',
        restoredPartial: '已取消归档 {n} 个，{m} 个失败',
        failureItem: '{id}：{message}',
        inUse: '使用中',
        inUseHint: '该会话仍在某个窗口里使用，先切换到其他会话再删除',
        untitled: '未命名会话',
        untitledHint: '这条会话没有保存标题',
        unknownTime: '时间未知',
        failed: '操作失败：{message}',
        failedLive: '{name} 仍被某个窗口打开着，先切换到其他会话再删除。',
        rowSelect: '选中会话 {title}',
        groupSelect: '选中「{title}」下全部归档会话',
      },
      en: {
        panel: 'Archived',
        title: 'Archived sessions',
        subtitle: 'Archived sessions grouped by workspace. Deleting removes the session log and its index record; it cannot be undone.',
        refresh: 'Refresh',
        refreshing: 'Refreshing…',
        back: 'Back to chat',
        selectAll: 'Select all',
        clearAll: 'Clear',
        selected: '{n} selected',
        deleteSelected: 'Delete selected',
        restoreSelected: 'Unarchive selected',
        restore: 'Unarchive',
        restoreHint: 'Bring it back to the sidebar session list',
        delete: 'Delete',
        deleteHint: 'Permanently remove this session log, cache and index record',
        empty: 'No archived sessions yet.',
        emptyHint: 'Pick Archive from a session row menu in the sidebar to collect one here.',
        emptySelection: 'Tick the checkbox on the left to delete several at once.',
        loading: 'Loading archived sessions…',
        retry: 'Retry',
        errorPrefix: 'Could not load: ',
        orphanGroup: 'No workspace',
        folderMissing: 'folder missing',
        total: '{n} workspaces · {m} sessions · {size}',
        sessionCount: '{n}',
        created: 'created {time}',
        updated: 'updated {time}',
        confirmTitle: 'Delete archived sessions',
        confirmBody: '{n} archived sessions will be deleted. Their logs, projection caches and index records are removed for good.',
        confirmMore: 'and {n} more',
        confirmCancel: 'Cancel',
        confirmDelete: 'Delete permanently',
        deleting: 'Deleting…',
        deleted: 'Deleted {n} archived sessions',
        deletedPartial: 'Deleted {n}, {m} failed',
        restored: 'Unarchived {n} sessions',
        restoredPartial: 'Unarchived {n}, {m} failed',
        failureItem: '{id}: {message}',
        inUse: 'In use',
        inUseHint: 'This session is still open in a window; switch to another session before deleting it',
        untitled: 'Untitled session',
        untitledHint: 'This session stored no title',
        unknownTime: 'unknown time',
        failed: 'Operation failed: {message}',
        failedLive: '{name} is still open in a window. Switch to another session first.',
        rowSelect: 'Select session {title}',
        groupSelect: 'Select every archived session of {title}',
      },
    }

    let activeContext = undefined

    function localeIdOf(ctx) {
      try {
        const snapshot = ctx?.locale?.getLocale?.() ?? ctx?.locale?.getSnapshot?.()
        const id = snapshot?.id ?? snapshot?.locale ?? snapshot?.current
        return typeof id === 'string' ? id : ''
      } catch {
        return ''
      }
    }

    function translator(ctx) {
      return function t(key, params) {
        // Read the locale on every call: the sidebar's label thunk and every render
        // then follow a language switch without re-registering the slot.
        const dict = /^en/i.test(localeIdOf(ctx)) ? TEXT.en : TEXT.zh
        const raw = dict[key] ?? TEXT.zh[key] ?? key
        if (params === undefined || params === null) return raw
        return raw.replace(/\{(\w+)\}/g, (whole, name) =>
          Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
        )
      }
    }

    /* --------------------------------------------------------- helpers */

    function pad2(value) {
      return value < 10 ? '0' + value : String(value)
    }

    function formatBytes(bytes) {
      const value = typeof bytes === 'number' && Number.isFinite(bytes) ? bytes : 0
      if (value <= 0) return '0 B'
      const units = ['B', 'KB', 'MB', 'GB', 'TB']
      let index = 0
      let size = value
      while (size >= 1024 && index < units.length - 1) {
        size /= 1024
        index += 1
      }
      const digits = size >= 100 || index === 0 ? 0 : 1
      return size.toFixed(digits) + ' ' + units[index]
    }

    function formatTime(t, value) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return t('unknownTime')
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return t('unknownTime')
      const now = new Date()
      const sameDay =
        date.getFullYear() === now.getFullYear() &&
        date.getMonth() === now.getMonth() &&
        date.getDate() === now.getDate()
      const clock = pad2(date.getHours()) + ':' + pad2(date.getMinutes())
      if (sameDay) return clock
      const day =
        date.getFullYear() === now.getFullYear()
          ? pad2(date.getMonth() + 1) + '-' + pad2(date.getDate())
          : String(date.getFullYear()) + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate())
      return day + ' ' + clock
    }

    const STYLES = [
      '.dsh-am-root { display: flex; flex-direction: column; height: 100%; min-height: 0; }',
      '.dsh-am-head { display: flex; align-items: flex-start; gap: 12px; padding: 18px 24px 12px; }',
      '.dsh-am-headtext { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1; }',
      '.dsh-am-title { margin: 0; font-size: 16px; font-weight: 600; color: var(--dsw-alias-label-primary); }',
      '.dsh-am-sub { font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }',
      '.dsh-am-toolbar { display: flex; align-items: center; gap: 8px; padding: 0 24px 12px; flex-wrap: wrap; }',
      '.dsh-am-spacer { flex: 1 1 auto; }',
      '.dsh-am-btn { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; font-size: 12px;',
      '  font-family: inherit; border-radius: 8px; cursor: pointer; color: var(--dsw-alias-label-primary);',
      '  background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); }',
      '.dsh-am-btn:hover:not(:disabled) { border-color: var(--dsw-alias-border-l2); }',
      '.dsh-am-btn:disabled { opacity: .5; cursor: default; }',
      '.dsh-am-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }',
      '.dsh-am-danger { color: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-border-l1); }',
      '.dsh-am-danger.filled { color: var(--dsw-alias-bg-base); background: var(--dsw-alias-state-error-primary);',
      '  border-color: var(--dsw-alias-state-error-primary); }',
      '.dsh-am-link { border: none; background: none; padding: 0 2px; font-size: 12px; cursor: pointer;',
      '  color: var(--dsw-alias-label-secondary); font-family: inherit; }',
      '.dsh-am-link:hover:not(:disabled) { color: var(--dsw-alias-brand-primary); }',
      '.dsh-am-link:disabled { opacity: .45; cursor: default; }',
      '.dsh-am-badge { margin-left: 6px; padding: 1px 6px; border-radius: 999px; font-size: 10.5px;',
      '  color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2);',
      '  border: 1px solid var(--dsw-alias-border-l1); vertical-align: 1px; }',
      '.dsh-am-link.danger:hover { color: var(--dsw-alias-state-error-primary); }',
      '.dsh-am-body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 0 24px 32px; }',
      '.dsh-am-group { margin-bottom: 18px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; overflow: hidden; }',
      '.dsh-am-grouphead { display: flex; align-items: center; gap: 10px; padding: 10px 12px;',
      '  background: var(--dsw-alias-bg-layer-2); }',
      '.dsh-am-caret { width: 18px; height: 18px; padding: 0; border: none; background: none; cursor: pointer;',
      '  color: var(--dsw-alias-label-secondary); display: inline-flex; align-items: center; justify-content: center; }',
      '.dsh-am-groupname { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary);',
      '  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '.dsh-am-grouppath { font-size: 11.5px; color: var(--dsw-alias-label-secondary); overflow: hidden;',
      '  text-overflow: ellipsis; white-space: nowrap; direction: ltr; }',
      '.dsh-am-count { font-size: 11.5px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }',
      '.dsh-am-row { display: flex; align-items: center; gap: 10px; padding: 9px 12px;',
      '  border-top: 1px solid var(--dsw-alias-border-l1); }',
      '.dsh-am-row:hover { background: var(--dsw-alias-bg-layer-1); }',
      '.dsh-am-row.picked { background: var(--dsw-alias-bg-layer-1); }',
      '.dsh-am-check { width: 15px; height: 15px; flex: none; accent-color: var(--dsw-alias-brand-primary); cursor: pointer; }',
      '.dsh-am-rowmain { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 auto; }',
      '.dsh-am-rowtitle { font-size: 13px; color: var(--dsw-alias-label-primary); overflow: hidden;',
      '  text-overflow: ellipsis; white-space: nowrap; }',
      '.dsh-am-rowmeta { font-size: 11.5px; color: var(--dsw-alias-label-secondary); display: flex; gap: 8px;',
      '  flex-wrap: wrap; }',
      '.dsh-am-rowactions { display: flex; align-items: center; gap: 8px; flex: none; }',
      '.dsh-am-state { padding: 32px 24px; font-size: 13px; color: var(--dsw-alias-label-secondary); }',
      '.dsh-am-empty { margin: 32px auto; max-width: 460px; text-align: center; display: flex; flex-direction: column;',
      '  gap: 8px; color: var(--dsw-alias-label-secondary); }',
      '.dsh-am-emptytitle { font-size: 14px; font-weight: 600; color: var(--dsw-alias-label-primary); }',
      '.dsh-am-error { color: var(--dsw-alias-state-error-primary); }',
      '.dsh-am-overlay { position: fixed; inset: 0; z-index: 40; display: flex; align-items: center;',
      '  justify-content: center; background: rgba(0, 0, 0, .38); padding: 24px; }',
      '.dsh-am-dialog { width: 100%; max-width: 460px; border-radius: 14px; padding: 18px 20px 16px;',
      '  background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l2);',
      '  box-shadow: 0 18px 48px rgba(0, 0, 0, .28); display: flex; flex-direction: column; gap: 12px; }',
      '.dsh-am-dialogtitle { font-size: 14.5px; font-weight: 600; color: var(--dsw-alias-label-primary); }',
      '.dsh-am-dialogbody { font-size: 12.5px; line-height: 1.7; color: var(--dsw-alias-label-secondary); }',
      '.dsh-am-list { margin: 0; padding: 8px 10px; list-style: none; max-height: 168px; overflow: auto;',
      '  border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1);',
      '  display: flex; flex-direction: column; gap: 4px; }',
      '.dsh-am-list li { font-size: 12px; color: var(--dsw-alias-label-primary); overflow: hidden;',
      '  text-overflow: ellipsis; white-space: nowrap; }',
      '.dsh-am-dialogactions { display: flex; justify-content: flex-end; gap: 8px; }',
      '.dsh-am-toast { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); z-index: 60;',
      '  max-width: 520px; padding: 9px 14px; border-radius: 10px; font-size: 12.5px;',
      '  color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2);',
      '  border: 1px solid var(--dsw-alias-border-l2); box-shadow: 0 10px 30px rgba(0, 0, 0, .22); }',
      '.dsh-am-toast.bad { color: var(--dsw-alias-state-error-primary); }',
    ].join('\n')

    /* ---------------------------------------------------------- data io */

    async function request(path, init) {
      const response = await fetch(API + path, Object.assign({ headers: { 'content-type': 'application/json' } }, init))
      let body = undefined
      try {
        body = await response.json()
      } catch {
        body = undefined
      }
      if (!response.ok || body === undefined || body.ok !== true) {
        const message = body && typeof body.error === 'string' ? body.error : 'HTTP ' + response.status
        throw new Error(message)
      }
      return body
    }

    function collectIds(state) {
      const ids = []
      if (state === null || typeof state !== 'object') return ids
      const groups = Array.isArray(state.workspaces) ? state.workspaces : []
      for (const group of groups) {
        for (const session of group.sessions ?? []) if (session.live !== true) ids.push(session.id)
      }
      for (const orphan of state.orphans ?? []) if (orphan.live !== true) ids.push(orphan.id)
      return ids
    }

    function titleOf(t, session) {
      const title = typeof session.title === 'string' ? session.title.trim() : ''
      return title === '' ? t('untitled') : title
    }

    /* -------------------------------------------------------- components */

    function PanelIcon(props) {
      const size = typeof props?.size === 'number' && props.size > 0 ? props.size : 18
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        h('rect', { key: 'lid', x: 3, y: 4, width: 18, height: 4.5, rx: 1.5 }),
        h('path', { key: 'body', d: 'M4.5 8.5h15v9a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2z' }),
        h('path', { key: 'line1', d: 'M9.5 13h5' }),
        h('path', { key: 'line2', d: 'M9.5 16.5h3' }),
      )
    }

    function Toast(props) {
      if (props.toast === null) return null
      return h('div', { className: 'dsh-am-toast' + (props.toast.bad === true ? ' bad' : ''), role: 'status' }, props.toast.text)
    }

    function ConfirmDialog(props) {
      const { t, count, names, more, busy, onCancel, onConfirm } = props
      React.useEffect(() => {
        function onKey(event) {
          if (event.key === 'Escape' && !busy) onCancel()
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [busy, onCancel])
      return h(
        'div',
        {
          className: 'dsh-am-overlay',
          role: 'presentation',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget && !busy) onCancel()
          },
        },
        h(
          'div',
          { className: 'dsh-am-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('confirmTitle') },
          h('div', { className: 'dsh-am-dialogtitle' }, t('confirmTitle')),
          h('div', { className: 'dsh-am-dialogbody' }, t('confirmBody', { n: count })),
          h(
            'ul',
            { className: 'dsh-am-list' },
            names.map((name, index) => h('li', { key: index, title: name }, name)),
            more > 0 ? h('li', { key: 'more' }, t('confirmMore', { n: more })) : null,
          ),
          h(
            'div',
            { className: 'dsh-am-dialogactions' },
            h('button', { type: 'button', className: 'dsh-am-btn', onClick: onCancel, disabled: busy }, t('confirmCancel')),
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-am-btn dsh-am-danger filled',
                onClick: onConfirm,
                disabled: busy,
                autoFocus: true,
              },
              busy ? t('deleting') : t('confirmDelete'),
            ),
          ),
        ),
      )
    }

    function SessionRow(props) {
      const { t, session, picked, onToggle, onDelete, onRestore } = props
      const title = titleOf(t, session)
      const meta = []
      meta.push(t('updated', { time: formatTime(t, session.updatedAt) }))
      if (typeof session.bytes === 'number' && session.bytes > 0) meta.push(formatBytes(session.bytes))
      if (session.stored === false) meta.push(t('folderMissing'))
      const live = session.live === true
      return h(
        'div',
        { className: 'dsh-am-row' + (picked ? ' picked' : '') + (live ? ' live' : '') },
        h('input', {
          type: 'checkbox',
          className: 'dsh-am-check',
          checked: picked,
          disabled: live,
          title: live ? t('inUseHint') : undefined,
          onChange: () => onToggle(session.id),
          'aria-label': t('rowSelect', { title: title }),
        }),
        h(
          'div',
          { className: 'dsh-am-rowmain' },
          h(
            'div',
            { className: 'dsh-am-rowtitle', title: title },
            h('span', null, title),
            live ? h('span', { className: 'dsh-am-badge', title: t('inUseHint') }, t('inUse')) : null,
          ),
          h('div', { className: 'dsh-am-rowmeta' }, meta.map((item, index) => h('span', { key: index }, item))),
        ),
        h(
          'div',
          { className: 'dsh-am-rowactions' },
          h(
            'button',
            { type: 'button', className: 'dsh-am-link', title: t('restoreHint'), onClick: () => onRestore(session.id) },
            t('restore'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-am-link danger',
              title: live ? t('inUseHint') : t('deleteHint'),
              disabled: live,
              onClick: () => onDelete(session.id),
            },
            t('delete'),
          ),
        ),
      )
    }

    function WorkspaceGroup(props) {
      const { t, group, collapsed, pickedSet, onToggleCollapse, onToggleSession, onToggleGroup, onDelete, onRestore } = props
      const sessions = Array.isArray(group.sessions) ? group.sessions : []
      const selectable = sessions.filter((session) => session.live !== true)
      const pickedCount = selectable.filter((session) => pickedSet.has(session.id)).length
      const allPicked = selectable.length > 0 && pickedCount === selectable.length
      return h(
        'section',
        { className: 'dsh-am-group', 'aria-label': group.title },
        h(
          'div',
          { className: 'dsh-am-grouphead' },
          selectable.length > 0
            ? h('input', {
                type: 'checkbox',
                className: 'dsh-am-check',
                checked: allPicked,
                ref: (node) => {
                  if (node !== null) node.indeterminate = pickedCount > 0 && !allPicked
                },
                onChange: () => onToggleGroup(selectable.map((session) => session.id), !allPicked),
                'aria-label': t('groupSelect', { title: group.title }),
              })
            : null,
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-am-caret',
              onClick: () => onToggleCollapse(group.workspaceId),
              'aria-expanded': collapsed ? 'false' : 'true',
              'aria-label': group.title,
            },
            h('svg', {
              width: 14,
              height: 14,
              viewBox: '0 0 24 24',
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: 2.2,
              strokeLinecap: 'round',
              strokeLinejoin: 'round',
              style: { transform: collapsed ? 'rotate(-90deg)' : 'none' },
              'aria-hidden': 'true',
            }, h('path', { d: 'M6 9l6 6 6-6' })),
          ),
          h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', minWidth: 0, flex: '1 1 auto' } },
            h('span', { className: 'dsh-am-groupname', title: group.title }, group.title || t('orphanGroup')),
            group.path
              ? h('span', { className: 'dsh-am-grouppath', title: group.path }, group.path)
              : null,
          ),
          h('span', { className: 'dsh-am-count' }, t('sessionCount', { n: sessions.length })),
        ),
        collapsed
          ? null
          : sessions.map((session) =>
              h(SessionRow, {
                key: session.id,
                t: t,
                session: session,
                picked: pickedSet.has(session.id),
                onToggle: onToggleSession,
                onDelete: onDelete,
                onRestore: onRestore,
              }),
            ),
      )
    }

    function ArchiveManagerPage() {
      const ctx = activeContext
      const [localeTick, setLocaleTick] = React.useState(0)
      React.useEffect(() => {
        if (ctx?.locale === undefined || typeof ctx.locale.subscribe !== 'function') return undefined
        return ctx.locale.subscribe(() => setLocaleTick((value) => value + 1))
      }, [ctx])
      const t = translator(ctx)

      const [state, setState] = React.useState(null)
      const [loading, setLoading] = React.useState(true)
      const [error, setError] = React.useState('')
      const [picked, setPicked] = React.useState(() => [])
      const [collapsed, setCollapsed] = React.useState(() => [])
      const [pending, setPending] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [toast, setToast] = React.useState(null)

      const showToast = React.useCallback((text, bad) => {
        setToast({ text: text, bad: bad === true, seq: Date.now() })
      }, [])

      React.useEffect(() => {
        if (toast === null) return undefined
        const timer = setTimeout(() => setToast(null), 3600)
        return () => clearTimeout(timer)
      }, [toast])

      const load = React.useCallback(
        async (quiet) => {
          if (quiet !== true) setLoading(true)
          try {
            const body = await request('/state')
            setState(body)
            setError('')
          } catch (failure) {
            setError(failure?.message ?? String(failure))
          } finally {
            if (quiet !== true) setLoading(false)
          }
        },
        [],
      )

      React.useEffect(() => {
        load(false)
      }, [load])

      const pickedSet = React.useMemo(() => new Set(picked), [picked])

      const toggleSession = React.useCallback((id) => {
        setPicked((current) => (current.includes(id) ? current.filter((item) => item !== id) : current.concat(id)))
      }, [])

      const toggleGroup = React.useCallback((ids, select) => {
        setPicked((current) => {
          const next = new Set(current)
          for (const id of ids) {
            if (select) next.add(id)
            else next.delete(id)
          }
          return Array.from(next)
        })
      }, [])

      const toggleCollapse = React.useCallback((workspaceId) => {
        setCollapsed((current) =>
          current.includes(workspaceId) ? current.filter((item) => item !== workspaceId) : current.concat(workspaceId),
        )
      }, [])

      const allIds = React.useMemo(() => collectIds(state), [state])
      const allPicked = allIds.length > 0 && picked.length === allIds.length

      const undoArchive = React.useCallback(
        async (ids) => {
          if (ids.length === 0) return
          setBusy(true)
          try {
            const body = await request('/unarchive', { method: 'POST', body: JSON.stringify({ ids: ids }) })
            const restored = Array.isArray(body.restored) ? body.restored.length : 0
            const failed = Array.isArray(body.failed) ? body.failed : []
            if (failed.length === 0) showToast(t('restored', { n: restored }), false)
            else showToast(t('restoredPartial', { n: restored, m: failed.length }) + ' · ' + t('failureItem', { id: failed[0].id, message: failed[0].message }), true)
            setPicked((current) => current.filter((id) => !ids.includes(id)))
            if (body.state !== undefined) setState(body.state)
            else await load(true)
          } catch (failure) {
            showToast(t('failed', { message: failure?.message ?? String(failure) }), true)
          } finally {
            setBusy(false)
          }
        },
        [load, showToast, t],
      )

      const askDelete = React.useCallback(
        (ids) => {
          const names = []
          const groups = Array.isArray(state?.workspaces) ? state.workspaces : []
          const byId = new Map()
          for (const group of groups) for (const session of group.sessions ?? []) byId.set(session.id, session)
          for (const orphan of state?.orphans ?? []) byId.set(orphan.id, orphan)
          for (const id of ids) {
            const session = byId.get(id)
            names.push(session === undefined ? id : titleOf(t, session))
          }
          setPending({ ids: ids, names: names.slice(0, 6), more: Math.max(0, names.length - 6) })
        },
        [state, t],
      )

      const nameOf = React.useCallback(
        (id) => {
          const groups = Array.isArray(state?.workspaces) ? state.workspaces : []
          for (const group of groups) {
            for (const session of group.sessions ?? []) if (session.id === id) return titleOf(t, session)
          }
          for (const orphan of state?.orphans ?? []) if (orphan.id === id) return titleOf(t, orphan)
          return id
        },
        [state, t],
      )

      const describeFailure = React.useCallback(
        (failure) => {
          const name = nameOf(failure.id)
          if (failure.code === 'archive/session-live') return t('failedLive', { name: name })
          return t('failureItem', { id: name, message: failure.message })
        },
        [nameOf, t],
      )

      const confirmDelete = React.useCallback(async () => {
        if (pending === null) return
        const ids = pending.ids
        setBusy(true)
        try {
          const body = await request('/delete', { method: 'POST', body: JSON.stringify({ ids: ids }) })
          const removed = Array.isArray(body.deleted) ? body.deleted.length : 0
          const failed = Array.isArray(body.failed) ? body.failed : []
          setPending(null)
          if (failed.length === 0) showToast(t('deleted', { n: removed }), false)
          else showToast(t('deletedPartial', { n: removed, m: failed.length }) + ' · ' + describeFailure(failed[0]), true)
          setPicked((current) => current.filter((id) => !ids.includes(id)))
          if (body.state !== undefined) setState(body.state)
          else await load(true)
        } catch (failure) {
          setPending(null)
          showToast(t('failed', { message: failure?.message ?? String(failure) }), true)
        } finally {
          setBusy(false)
        }
      }, [describeFailure, load, pending, showToast, t])

      const closePanel = React.useCallback(() => {
        try {
          ctx?.layout?.selectPanel?.(null)
        } catch {
          /* the shell owns panel selection; a rejected request keeps the page open */
        }
      }, [ctx])

      const groups = Array.isArray(state?.workspaces) ? state.workspaces : []
      const orphans = Array.isArray(state?.orphans) ? state.orphans : []
      const totalSessions = state?.totals?.sessions ?? 0

      const head = h(
        'div',
        { className: 'dsh-am-head' },
        h(
          'div',
          { className: 'dsh-am-headtext' },
          h('h1', { className: 'dsh-am-title' }, t('title')),
          h('div', { className: 'dsh-am-sub' }, t('subtitle')),
        ),
        h(
          'div',
          { style: { display: 'flex', gap: 8, flex: 'none' } },
          h(
            'button',
            { type: 'button', className: 'dsh-am-btn', onClick: () => load(false), disabled: loading },
            loading ? t('refreshing') : t('refresh'),
          ),
          h('button', { type: 'button', className: 'dsh-am-btn', onClick: closePanel }, t('back')),
        ),
      )

      const toolbar = h(
        'div',
        { className: 'dsh-am-toolbar' },
        h(
          'button',
          {
            type: 'button',
            className: 'dsh-am-btn',
            disabled: allIds.length === 0,
            onClick: () => setPicked(allPicked ? [] : allIds),
          },
          allPicked ? t('clearAll') : t('selectAll'),
        ),
        h('span', { className: 'dsh-am-count' }, t('selected', { n: picked.length })),
        picked.length === 0
          ? h('span', { className: 'dsh-am-count' }, t('emptySelection'))
          : null,
        h('span', { className: 'dsh-am-spacer' }),
        picked.length > 0
          ? h(
              'button',
              {
                type: 'button',
                className: 'dsh-am-btn',
                disabled: busy,
                onClick: () => undoArchive(picked.slice()),
              },
              t('restoreSelected'),
            )
          : null,
        picked.length > 0
          ? h(
              'button',
              {
                type: 'button',
                className: 'dsh-am-btn dsh-am-danger filled',
                disabled: busy,
                onClick: () => askDelete(picked.slice()),
              },
              t('deleteSelected'),
            )
          : null,
        h('span', { className: 'dsh-am-count' },
          t('total', {
            n: state?.totals?.workspaces ?? 0,
            m: totalSessions,
            size: formatBytes(state?.totals?.bytes ?? 0),
          }),
        ),
      )

      let bodyContent
      if (loading && state === null) {
        bodyContent = h('div', { className: 'dsh-am-state' }, t('loading'))
      } else if (error !== '' && state === null) {
        bodyContent = h(
          'div',
          { className: 'dsh-am-state' },
          h('div', { className: 'dsh-am-error' }, t('errorPrefix') + error),
          h(
            'button',
            { type: 'button', className: 'dsh-am-btn', style: { marginTop: 12 }, onClick: () => load(false) },
            t('retry'),
          ),
        )
      } else if (totalSessions === 0) {
        bodyContent = h(
          'div',
          { className: 'dsh-am-empty' },
          h('div', { className: 'dsh-am-emptytitle' }, t('empty')),
          h('div', null, t('emptyHint')),
        )
      } else {
        bodyContent = h(
          'div',
          null,
          groups.map((group) =>
            h(WorkspaceGroup, {
              key: group.workspaceId,
              t: t,
              group: group,
              collapsed: collapsed.includes(group.workspaceId),
              pickedSet: pickedSet,
              onToggleCollapse: toggleCollapse,
              onToggleSession: toggleSession,
              onToggleGroup: toggleGroup,
              onDelete: (id) => askDelete([id]),
              onRestore: (id) => undoArchive([id]),
            }),
          ),
          orphans.length > 0
            ? h(WorkspaceGroup, {
                key: '__orphans__',
                t: t,
                group: { workspaceId: '__orphans__', title: t('orphanGroup'), path: '', sessions: orphans },
                collapsed: collapsed.includes('__orphans__'),
                pickedSet: pickedSet,
                onToggleCollapse: toggleCollapse,
                onToggleSession: toggleSession,
                onToggleGroup: toggleGroup,
                onDelete: (id) => askDelete([id]),
                onRestore: (id) => undoArchive([id]),
              })
            : null,
        )
      }

      return h(
        'div',
        { className: 'dsh-am-root' },
        h('style', { key: 'dsh-am-styles' }, STYLES),
        head,
        toolbar,
        h('div', { className: 'dsh-am-body' }, bodyContent),
        error !== '' && state !== null
          ? h('div', { className: 'dsh-am-state dsh-am-error' }, t('errorPrefix') + error)
          : null,
        pending === null
          ? null
          : h(ConfirmDialog, {
              t: t,
              count: pending.ids.length,
              names: pending.names,
              more: pending.more,
              busy: busy,
              onCancel: () => {
                if (!busy) setPending(null)
              },
              onConfirm: confirmDelete,
            }),
        h(Toast, { toast: toast }),
      )
    }

    return {
      inject: ['slots', 'locale', 'layout'],
      apply(ctx) {
        activeContext = ctx
        const t = translator(ctx)
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 40,
              label: () => t('panel'),
            },
            PanelIcon,
          ),
        )
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL_ID }, ArchiveManagerPage),
        )
      },
    }
  },
})
