window.__ModuleLoader__.load({
  id: 'mi-note',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const PANEL_ID = 'mi-note'
    const API = '/api/mi-note'

    /* -------------------------------------------------------------- text */

    const TEXT = {
      zh: {
        panel: '小米笔记',
        title: '小米笔记',
        subtitle: '用二维码连接小米账号，把云笔记拉成本地 Markdown 文件。左侧边栏和设置里的这两个入口是同一个页面。',
        account: '小米账号',
        accountDisconnected: '还没有连接。点「连接小米账号」，用手机上的小米账号 App 扫码确认。',
        accountConnected: '已连接',
        accountMasked: '账号 {id}',
        accountSavedAt: '连接于 {time}',
        accountRenewable: '可自动续期',
        accountNotRenewable: '长期凭据缺失，过期后需要重新扫码',
        connect: '连接小米账号',
        reconnect: '重新连接',
        disconnect: '断开',
        disconnecting: '断开中…',
        connected: '已连接',
        cancel: '取消扫码',
        qrHint: '打开手机「小米账号」App → 扫一扫，确认登录。',
        qrExpires: '二维码有效期剩余 {sec} 秒',
        qrExpired: '二维码已过期，请重新生成。',
        qrCancelled: '已取消扫码。',
        qrFailed: '扫码失败：{message}',
        qrVerifying: '已扫码，正在换取登录票据…',
        statusWaiting: '等待手机确认',
        statusVerifying: '验证中',
        statusConnected: '已连接',
        statusExpired: '已过期',
        statusCancelled: '已取消',
        statusFailed: '失败',
        workspace: '笔记工作区',
        workspaceHint: '这个文件夹里的 .md 就是云笔记的本地副本。DSH 会话的工作目录建议与它相同。',
        workspaceUnset: '未配置（建议 {dir}）',
        workspaceChange: '选择目录',
        workspaceSave: '保存',
        workspaceCancel: '取消',
        workspacePlaceholder: 'C:\\Users\\你\\Documents\\小米笔记',
        workspaceAbsolute: '必须是绝对路径。',
        workspaceSaved: '已保存。插件会按新目录重新加载。',
        workspaceCounts: '{files} 篇本地 .md，已关联 {mapped} 篇',
        workspaceLabel: '当前目录',
        sync: '同步',
        syncHint: '设置页只做只读动作：查看状态、预检、拉取。把本地改动推回云端请在会话里让 Agent 调用 mi_note_sync 的 push / publish。',
        syncStatus: '查看状态',
        syncPreflight: '预检',
        syncPull: '拉取',
        syncNeedWorkspace: '请先选择笔记文件夹。',
        syncing: '处理中…',
        syncNoAccount: '请先连接小米账号。',
        footer: '登录令牌保存在 DSH 凭据库，不写入配置，也不发给浏览器。',
        close: '关闭',
        back: '返回对话',
        reload: '重新读取',
        failed: '操作失败：{message}',
        loading: '正在读取状态…',
        unknownTime: '时间未知',
      },
      en: {
        panel: 'Mi Notes',
        title: 'Mi Notes',
        subtitle: 'Connect a Mi account with a QR code and copy cloud notes into local Markdown files. The sidebar entry and this Settings section show the same page.',
        account: 'Mi account',
        accountDisconnected: 'Not connected. Choose Connect and confirm the scan in the Mi Account app on your phone.',
        accountConnected: 'Connected',
        accountMasked: 'Account {id}',
        accountSavedAt: 'connected {time}',
        accountRenewable: 'renews automatically',
        accountNotRenewable: 'no long-lived token, so expiry needs a new scan',
        connect: 'Connect Mi account',
        reconnect: 'Reconnect',
        disconnect: 'Disconnect',
        disconnecting: 'Disconnecting…',
        connected: 'Connected',
        cancel: 'Cancel scan',
        qrHint: 'Open the Mi Account app on your phone, choose Scan, and confirm.',
        qrExpires: 'Code valid for another {sec}s',
        qrExpired: 'The code expired. Generate a new one.',
        qrCancelled: 'Scan cancelled.',
        qrFailed: 'Scan failed: {message}',
        qrVerifying: 'Scanned. Exchanging the login ticket…',
        statusWaiting: 'Waiting for the phone',
        statusVerifying: 'Verifying',
        statusConnected: 'Connected',
        statusExpired: 'Expired',
        statusCancelled: 'Cancelled',
        statusFailed: 'Failed',
        workspace: 'Notes workspace',
        workspaceHint: 'The .md files in this folder mirror the cloud notes. Point the DSH session working directory at the same place.',
        workspaceUnset: 'Not configured (suggested: {dir})',
        workspaceChange: 'Choose folder',
        workspaceSave: 'Save',
        workspaceCancel: 'Cancel',
        workspacePlaceholder: 'C:\\Users\\you\\Documents\\MiNotes',
        workspaceAbsolute: 'An absolute path is required.',
        workspaceSaved: 'Saved. The plugin reloads against the new folder.',
        workspaceCounts: '{files} local .md files, {mapped} linked',
        workspaceLabel: 'Current folder',
        sync: 'Sync',
        syncHint: 'This page only performs read-only steps: status, preflight, pull. To send local edits back, ask the agent to call mi_note_sync push or publish in a session.',
        syncStatus: 'Check status',
        syncPreflight: 'Preflight',
        syncPull: 'Pull',
        syncNeedWorkspace: 'Choose the notes folder first.',
        syncing: 'Working…',
        syncNoAccount: 'Connect a Mi account first.',
        footer: 'Login tokens live in the DSH credential store. They are never written to configuration or sent to the browser.',
        close: 'Close',
        back: 'Back to chat',
        reload: 'Read again',
        failed: 'That failed: {message}',
        loading: 'Reading state…',
        unknownTime: 'unknown time',
      },
    }

    let activeContext

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
        const dict = /^en/i.test(localeIdOf(ctx)) ? TEXT.en : TEXT.zh
        const raw = dict[key] ?? TEXT.zh[key] ?? key
        if (params === undefined || params === null) return raw
        return raw.replace(/\{(\w+)\}/g, (whole, name) =>
          Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
        )
      }
    }

    /* ------------------------------------------------------------ styles */

    const STYLES = [
      '.dsh-mn-root { display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: auto; }',
      '.dsh-mn-head { display: flex; align-items: flex-start; gap: 12px; padding: 18px 24px 10px; }',
      '.dsh-mn-headtext { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1 1 auto; }',
      '.dsh-mn-title { margin: 0; font-size: 16px; font-weight: 600; color: var(--dsw-alias-label-primary); }',
      '.dsh-mn-sub { font-size: 12px; line-height: 1.65; color: var(--dsw-alias-label-secondary); }',
      '.dsh-mn-body { display: flex; flex-direction: column; gap: 14px; padding: 0 24px 28px; }',
      '.dsh-mn-card { border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px;',
      '  background: var(--dsw-alias-bg-layer-1); padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; }',
      '.dsh-mn-cardhead { display: flex; align-items: center; gap: 10px; }',
      '.dsh-mn-cardtitle { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); }',
      '.dsh-mn-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }',
      '.dsh-mn-note { font-size: 12px; line-height: 1.7; color: var(--dsw-alias-label-secondary); }',
      '.dsh-mn-mono { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 11.5px;',
      '  color: var(--dsw-alias-label-primary); word-break: break-all; }',
      '.dsh-mn-btn { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px;',
      '  font-size: 12px; font-family: inherit; border-radius: 8px; cursor: pointer;',
      '  color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2);',
      '  border: 1px solid var(--dsw-alias-border-l1); }',
      '.dsh-mn-btn:hover:not(:disabled) { border-color: var(--dsw-alias-border-l2); }',
      '.dsh-mn-btn:disabled { opacity: .5; cursor: default; }',
      '.dsh-mn-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }',
      '.dsh-mn-btn.primary { color: var(--dsw-alias-bg-base); background: var(--dsw-alias-brand-primary);',
      '  border-color: var(--dsw-alias-brand-primary); }',
      '.dsh-mn-btn.danger { color: var(--dsw-alias-state-error-primary); }',
      '.dsh-mn-pill { display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px; border-radius: 999px;',
      '  font-size: 11.5px; border: 1px solid var(--dsw-alias-border-l1);',
      '  color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); }',
      '.dsh-mn-pill.ok { color: var(--dsw-alias-state-success-primary); }',
      '.dsh-mn-pill.warn { color: var(--dsw-alias-state-warn-primary); }',
      '.dsh-mn-pill.bad { color: var(--dsw-alias-state-error-primary); }',
      '.dsh-mn-qr { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 6px 0 2px; }',
      '.dsh-mn-qrbox { padding: 10px; border-radius: 12px; background: #ffffff;',
      '  border: 1px solid var(--dsw-alias-border-l1); line-height: 0; }',
      '.dsh-mn-qrbox svg { display: block; }',
      '.dsh-mn-input { flex: 1 1 240px; min-width: 0; height: 30px; padding: 0 10px; font-size: 12px;',
      '  font-family: inherit; border-radius: 8px; color: var(--dsw-alias-label-primary);',
      '  background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l1); }',
      '.dsh-mn-input:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }',
      '.dsh-mn-out { margin: 0; padding: 10px 12px; border-radius: 8px; font-size: 11.5px; line-height: 1.75;',
      '  font-family: ui-monospace, SFMono-Regular, Consolas, monospace; white-space: pre-wrap;',
      '  color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2);',
      '  border: 1px solid var(--dsw-alias-border-l1); max-height: 220px; overflow: auto; }',
      '.dsh-mn-error { font-size: 12px; color: var(--dsw-alias-state-error-primary); }',
      '.dsh-mn-foot { font-size: 11.5px; line-height: 1.7; color: var(--dsw-alias-label-secondary);',
      '  border-top: 1px solid var(--dsw-alias-border-l1); padding-top: 12px; }',
    ].join('\n')

    /* -------------------------------------------------------------- fetch */

    async function call(path, init) {
      const response = await fetch(API + path, {
        ...init,
        headers: { 'content-type': 'application/json' },
      })
      let body
      try {
        body = await response.json()
      } catch {
        body = undefined
      }
      if (!response.ok || body === undefined) {
        const message = body?.error?.message ?? body?.message ?? 'HTTP ' + response.status
        const error = new Error(message)
        error.code = body?.error?.code
        throw error
      }
      return body
    }

    /* --------------------------------------------------------------- parts */

    function pad2(value) {
      return value < 10 ? '0' + value : String(value)
    }

    function formatTime(t, value) {
      if (!Number.isFinite(value) || value <= 0) return t('unknownTime')
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return t('unknownTime')
      return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate())
        + ' ' + pad2(date.getHours()) + ':' + pad2(date.getMinutes())
    }

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
        h('path', { key: 'page', d: 'M6 3.5h7.2L18 8.3V20a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 20z' }),
        h('path', { key: 'fold', d: 'M13 3.6V8.5h4.9' }),
        h('path', { key: 'l1', d: 'M9 12.4h6' }),
        h('path', { key: 'l2', d: 'M9 15.9h4' }),
      )
    }

    /**
     * Draw one QR symbol as SVG rectangles.
     *
     * The white plate is drawn here rather than left to the theme: a QR code
     * needs a light background to scan, and the surrounding card may be dark.
     */
    function QrCode(props) {
      const qr = props.qr
      if (qr === null || typeof qr !== 'object' || !Array.isArray(qr.rows)) return null
      const target = typeof props.size === 'number' ? props.size : 224
      const count = qr.rows.length
      if (count === 0) return null
      const scale = target / count
      const dark = []
      for (let row = 0; row < count; row += 1) {
        const line = qr.rows[row]
        for (let column = 0; column < line.length; column += 1) {
          if (line[column] === '1') {
            dark.push(h('rect', {
              key: row + ':' + column,
              x: column * scale,
              y: row * scale,
              width: scale,
              height: scale,
              fill: '#000000',
            }))
          }
        }
      }
      return h(
        'svg',
        {
          width: target,
          height: target,
          viewBox: '0 0 ' + target + ' ' + target,
          role: 'img',
          'aria-label': props.label ?? 'QR',
          style: { shapeRendering: 'crispEdges' },
        },
        h('rect', { key: 'plate', x: 0, y: 0, width: target, height: target, fill: '#ffffff' }),
        dark,
      )
    }

    function Card(props) {
      return h(
        'section',
        { className: 'dsh-mn-card', 'aria-label': props.title },
        h('div', { className: 'dsh-mn-cardhead' }, h('span', { className: 'dsh-mn-cardtitle' }, props.title), props.extra ?? null),
        props.children,
      )
    }

    /* ---------------------------------------------------------------- page */

    function MiNotePage(props) {
      const ctx = activeContext
      const t = translator(ctx)
      const [tick, setTick] = React.useState(0)
      const [state, setState] = React.useState(null)
      const [loading, setLoading] = React.useState(true)
      const [busy, setBusy] = React.useState('')
      const [error, setError] = React.useState('')
      const [output, setOutput] = React.useState('')
      const [editing, setEditing] = React.useState(false)
      const [draft, setDraft] = React.useState('')

      React.useEffect(() => {
        if (ctx?.locale === undefined || typeof ctx.locale.subscribe !== 'function') return undefined
        return ctx.locale.subscribe(() => setTick(value => value + 1))
      }, [ctx])

      const load = React.useCallback(async quiet => {
        if (quiet !== true) setLoading(true)
        try {
          const body = await call('/state', { method: 'GET' })
          setState(body)
          setError('')
        } catch (failure) {
          setError(failure?.message ?? String(failure))
        } finally {
          if (quiet !== true) setLoading(false)
        }
      }, [])

      React.useEffect(() => {
        load(false)
      }, [load])

      const challenge = state?.challenge ?? null
      const waiting = challenge !== null && challenge.status === 'waiting'

      // Poll only while a scan is in flight, and stop as soon as the page is
      // gone: the Host keeps the long poll, the page has no reason to.
      React.useEffect(() => {
        if (!waiting && challenge?.status !== 'verifying') return undefined
        const timer = setInterval(() => {
          load(true).catch(() => undefined)
        }, 2000)
        return () => clearInterval(timer)
      }, [waiting, challenge?.status, load])

      const run = React.useCallback(async (marker, task) => {
        setBusy(marker)
        setError('')
        try {
          await task()
        } catch (failure) {
          setError(t('failed', { message: failure?.message ?? String(failure) }))
        } finally {
          setBusy('')
        }
      }, [t])

      const connect = () => run('connect', async () => {
        const body = await call('/qr', { method: 'POST', body: '{}' })
        if (body?.state !== undefined) setState(body.state)
      })

      const cancelScan = () => run('cancel', async () => {
        const body = await call('/qr/cancel', { method: 'POST', body: '{}' })
        if (body?.state !== undefined) setState(body.state)
      })

      const disconnect = () => run('disconnect', async () => {
        const body = await call('/disconnect', { method: 'POST', body: '{}' })
        if (body?.state !== undefined) setState(body.state)
        setOutput('')
      })

      const saveWorkspace = () => run('workspace', async () => {
        const value = draft.trim()
        if (value !== '' && !/^[A-Za-z]:[\\/]/.test(value) && !value.startsWith('\\\\')) {
          setError(t('workspaceAbsolute'))
          return
        }
        const body = await call('/workspace', { method: 'POST', body: JSON.stringify({ workspaceDir: value }) })
        if (body?.state !== undefined) setState(body.state)
        setEditing(false)
        setOutput(t('workspaceSaved'))
      })

      const sync = action => run(action, async () => {
        const body = await call('/sync', { method: 'POST', body: JSON.stringify({ action }) })
        setOutput(body?.summary ?? '')
        if (body?.status !== undefined || body?.ok === false) {
          // Refresh the counters after a pull; a status call changed nothing.
          await load(true)
        }
      })

      const close = () => {
        if (typeof props?.close === 'function') {
          props.close()
          return
        }
        try {
          ctx?.layout?.selectPanel?.(null)
        } catch {
          /* the shell owns panel selection */
        }
      }

      const account = state?.account ?? { connected: false }
      const workspace = state?.workspace ?? { dir: '', counts: { files: 0, mapped: 0 } }
      const remaining = challenge === null ? 0 : Math.max(0, Math.round((challenge.expiresAt - Date.now()) / 1000))

      let accountBody
      if (account.connected !== true) {
        accountBody = [
          h('div', { className: 'dsh-mn-note', key: 'note' }, t('accountDisconnected')),
          h(
            'div',
            { className: 'dsh-mn-row', key: 'row' },
            h(
              'button',
              { type: 'button', className: 'dsh-mn-btn primary', onClick: connect, disabled: busy !== '' || waiting },
              busy === 'connect' ? t('syncing') : t('connect'),
            ),
          ),
        ]
      } else {
        const pills = [
          h('span', { className: 'dsh-mn-pill ok', key: 'ok' }, t('accountConnected')),
          h('span', { className: 'dsh-mn-pill ' + (account.renewable ? 'ok' : 'warn'), key: 'renew' },
            account.renewable ? t('accountRenewable') : t('accountNotRenewable')),
        ]
        accountBody = [
          h('div', { className: 'dsh-mn-row', key: 'pills' }, pills),
          h('div', { className: 'dsh-mn-note', key: 'meta' },
            t('accountMasked', { id: account.userId ?? '' }) + ' · ' + t('accountSavedAt', { time: formatTime(t, account.savedAt) })),
          h(
            'div',
            { className: 'dsh-mn-row', key: 'actions' },
            h('button', { type: 'button', className: 'dsh-mn-btn', onClick: connect, disabled: busy !== '' }, t('reconnect')),
            h('button', { type: 'button', className: 'dsh-mn-btn danger', onClick: disconnect, disabled: busy !== '' },
              busy === 'disconnect' ? t('disconnecting') : t('disconnect')),
          ),
        ]
      }

      let scanBody = null
      if (challenge !== null && (challenge.status === 'waiting' || challenge.status === 'verifying')) {
        scanBody = h(
          'div',
          { className: 'dsh-mn-qr' },
          challenge.status === 'waiting' && challenge.qr !== null
            ? h('div', { className: 'dsh-mn-qrbox' }, h(QrCode, { qr: challenge.qr, size: 224, label: t('qrHint') }))
            : h('div', { className: 'dsh-mn-note' }, t('qrVerifying')),
          h('div', { className: 'dsh-mn-note' }, challenge.status === 'waiting' ? t('qrHint') : t('statusVerifying')),
          h('div', { className: 'dsh-mn-row' },
            h('span', { className: 'dsh-mn-pill' }, t('qrExpires', { sec: remaining })),
            h('button', { type: 'button', className: 'dsh-mn-btn', onClick: cancelScan, disabled: busy !== '' }, t('cancel'))),
        )
      } else if (challenge !== null && challenge.status === 'expired') {
        scanBody = h('div', { className: 'dsh-mn-note' }, t('qrExpired'))
      } else if (challenge !== null && challenge.status === 'cancelled') {
        scanBody = h('div', { className: 'dsh-mn-note' }, t('qrCancelled'))
      } else if (challenge !== null && challenge.status === 'failed') {
        scanBody = h('div', { className: 'dsh-mn-error' }, t('qrFailed', { message: challenge.message ?? '' }))
      }

      const workspaceValue = workspace.dir !== ''
        ? workspace.dir
        : t('workspaceUnset', { dir: workspace.suggested ?? '' })
      const workspaceReady = workspace.configured === true
      const canSync = account.connected === true && workspaceReady

      return h(
        'div',
        { className: 'dsh-mn-root' },
        h('style', { key: 'styles' }, STYLES),
        h(
          'div',
          { className: 'dsh-mn-head' },
          h(
            'div',
            { className: 'dsh-mn-headtext' },
            h('h1', { className: 'dsh-mn-title' }, t('title')),
            h('div', { className: 'dsh-mn-sub' }, t('subtitle')),
          ),
          h(
            'div',
            { className: 'dsh-mn-row' },
            h('button', { type: 'button', className: 'dsh-mn-btn', onClick: () => load(false), disabled: loading }, t('reload')),
            h('button', { type: 'button', className: 'dsh-mn-btn', onClick: close }, t('close')),
          ),
        ),
        h(
          'div',
          { className: 'dsh-mn-body' },
          loading && state === null
            ? h('div', { className: 'dsh-mn-note' }, t('loading'))
            : null,
          error !== '' ? h('div', { className: 'dsh-mn-error' }, error) : null,
          h(Card, { title: t('account') }, ...accountBody, scanBody),
          h(
            Card,
            { title: t('workspace') },
            h('div', { className: 'dsh-mn-mono' }, workspaceValue),
            workspace.error !== '' ? h('div', { className: 'dsh-mn-error' }, workspace.error) : null,
            h('div', { className: 'dsh-mn-note' }, t('workspaceHint')),
            h('div', { className: 'dsh-mn-note' },
              t('workspaceCounts', { files: workspace.counts?.files ?? 0, mapped: workspace.counts?.mapped ?? 0 })),
            editing
              ? h(
                'div',
                { className: 'dsh-mn-row' },
                h('input', {
                  className: 'dsh-mn-input',
                  value: draft,
                  placeholder: t('workspacePlaceholder'),
                  spellCheck: false,
                  onChange: event => setDraft(event.target.value),
                  'aria-label': t('workspaceLabel'),
                }),
                h('button', { type: 'button', className: 'dsh-mn-btn primary', onClick: saveWorkspace, disabled: busy !== '' }, t('workspaceSave')),
                h('button', { type: 'button', className: 'dsh-mn-btn', onClick: () => setEditing(false) }, t('workspaceCancel')),
              )
              : h(
                'div',
                { className: 'dsh-mn-row' },
                h('button', {
                  type: 'button',
                  className: 'dsh-mn-btn',
                  onClick: () => {
                    setDraft(workspace.configured ? workspace.dir : (workspace.suggested ?? ''))
                    setEditing(true)
                  },
                }, t('workspaceChange')),
              ),
          ),
          h(
            Card,
            { title: t('sync') },
            h('div', { className: 'dsh-mn-note' }, t('syncHint')),
            h(
              'div',
              { className: 'dsh-mn-row' },
              h('button', {
                type: 'button',
                className: 'dsh-mn-btn',
                onClick: () => sync('status'),
                disabled: busy !== '' || !canSync,
                title: account.connected !== true ? t('syncNoAccount') : workspaceReady ? undefined : t('syncNeedWorkspace'),
              }, t('syncStatus')),
              h('button', {
                type: 'button',
                className: 'dsh-mn-btn',
                onClick: () => sync('preflight'),
                disabled: busy !== '' || !canSync,
                title: account.connected !== true ? t('syncNoAccount') : workspaceReady ? undefined : t('syncNeedWorkspace'),
              }, t('syncPreflight')),
              h('button', {
                type: 'button',
                className: 'dsh-mn-btn primary',
                onClick: () => sync('pull'),
                disabled: busy !== '' || !canSync,
                title: account.connected !== true ? t('syncNoAccount') : workspaceReady ? undefined : t('syncNeedWorkspace'),
              }, busy === 'pull' ? t('syncing') : t('syncPull')),
            ),
            output === '' ? null : h('pre', { className: 'dsh-mn-out' }, output),
          ),
          h('div', { className: 'dsh-mn-foot' }, t('footer')),
        ),
      )
    }

    /* ------------------------------------------------------------- register */

    return {
      inject: ['slots', 'locale', 'layout'],
      apply(ctx) {
        activeContext = ctx
        const t = translator(ctx)

        // A real left-sidebar panel entry: the sidebar owns the button and its
        // label, and the matching `main` cell is the page it opens.
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: PANEL_ID, order: 30, label: () => t('panel') },
            PanelIcon,
          ),
        )
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL_ID }, MiNotePage),
        )

        // The same page as a Settings section, so the plugin is reachable from
        // the settings panel as well; the shell passes `close` here.
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            { name: 'settings.section', id: PANEL_ID, order: 30, label: () => t('panel') },
            MiNotePage,
          ),
        )
      },
    }
  },
})
