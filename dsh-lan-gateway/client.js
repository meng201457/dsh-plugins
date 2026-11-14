window.__ModuleLoader__.load({
  id: 'dsh-lan-gateway',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const ENDPOINTS = {
      state: '/api/dsh-lan-gateway/state',
      save: '/api/dsh-lan-gateway/save',
      test: '/api/dsh-lan-gateway/test',
      testNotify: '/api/dsh-lan-gateway/test-notify',
    }
    const PUBLIC_URL_EXAMPLE = 'https://dsh.example.com'
    const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace'
    const PRIMARY_KEY = 'primary-link'

    const TEXT = {
      zh: {
        title: '局域网访问',
        description: '把当前 Harness 的 Web 界面反向代理到本机端口，并可在启动时把访问令牌推送到 QQ 群 / 私聊。',
        statusTitle: '运行状态',
        upstream: 'DSH 上游',
        autoDetected: '端口自动检测自当前 Web 服务',
        upstreamHint: '端口 {port} · 自动检测自当前 Web 服务',
        unknown: '未检测到',
        token: '访问令牌',
        ready: '已就绪',
        notReady: '未就绪',
        listener: '网关监听',
        listeningOn: '监听 {host}:{port}',
        notListening: '未监听',
        portFallback: '请求端口 {requested}，实际使用 {actual}',
        login: '上游登录',
        loginReady: '已登录',
        loginPending: '首次访问时自动登录',
        requests: '请求数',
        requestsWithErrors: '{n}（{errors} 个失败）',
        connections: '活动连接',
        uptime: '运行时长',
        lastError: '最近错误',
        none: '无',
        justStarted: '不到 1 秒',
        statusRunning: '监听中',
        statusStopped: '未监听',
        statusOff: '未启用',
        configTitle: '配置',
        enable: '启用局域网访问',
        port: '端口',
        portHint: '1–65535；端口被占用时会在状态里报错',
        bindHost: '绑定地址',
        bindHint: '0.0.0.0 表示所有网卡，127.0.0.1 仅本机可访问',
        requireToken: '要求访问令牌',
        requireTokenHint: '开启后链接会带上 ?token=…，未携带令牌的请求会被拒绝；局域网环境建议保持开启。',
        publicUrl: '外部域名',
        publicUrlHint:
          '路由器反代入口，如 https://dsh.example.com；用于生成访问链接。配置后才会发送 QQ 启动推送（推送内容只有令牌，不含链接）。',
        notifyCardTitle: 'QQ 启动通知',
        notifyCardHint:
          '每次 DSH 启动时，通过 OneBot v11 把本次访问令牌推送到 QQ（不发送完整链接）；必须先在「外部域名」里配置域名才会发送。',
        notifyOnStartup: '启用启动推送',
        oneBotWsUrl: 'OneBot WS 地址',
        oneBotWsHint: 'OneBot 正向 WebSocket，NapCat / Lagrange 监听端口',
        oneBotToken: 'OneBot access_token',
        oneBotTokenStored: '已设置，留空不修改',
        oneBotTokenPlaceholder: '未设置，可填写 access_token',
        oneBotTokenHint: '只写字段，不会回显；留空表示保持已保存的令牌。',
        notifyTargets: '投递目标',
        notifyGroup: '群聊',
        notifyPrivate: '私聊',
        groupId: '群号',
        userId: 'QQ 号',
        notifyTitleLabel: '消息标题',
        notifyTitleHint: 'QQ 消息的标题行',
        notifyTitlePlaceholder: 'DSH 已启动',
        includeTimestamp: '附带时间戳',
        notifyTargetRequired: '启用启动推送时，请至少勾选一个投递目标（群聊或私聊）。',
        notifyGroupIdInvalid: '群号需为纯数字。',
        notifyUserIdInvalid: 'QQ 号需为纯数字。',
        notifyUrlInvalid: 'OneBot 地址需为 ws:// 或 wss:// 开头的完整地址。',
        notifyPublicUrlInvalid: '外部域名需为 http:// 或 https:// 开头的完整地址，例如 https://dsh.example.com。',
        notifyPreviewLabel: '推送令牌',
        notifyPreviewEmpty: '未配置外部域名，或尚未读取到访问令牌，不会推送',
        notifyLast: '上次推送：{time} · {state}',
        notifyLastContentLabel: '上次推送内容：',
        notifyLastTokenLabel: '上次推送令牌：',
        notifyNever: '还没有推送记录',
        notifyLastOk: '成功',
        notifyLastFailed: '失败',
        notifyDelivered: '已送达：{targets}',
        notifyFailed: '失败：{targets}',
        notifyListSep: '、',
        notifyTest: '发送测试消息',
        notifyTesting: '发送中…',
        notifyTestHint: '会真正向已配置的 QQ 目标发送一条消息。',
        notifyDomainRequired: '需要配置外部域名后才能发送。',
        notifyTestTargetRequired: '请至少选择一个投递目标。',
        notifyTestOk: '已发送（{ms} ms）',
        notifyTestFailed: '发送失败：{error}',
        notifyTestToken: '推送令牌：{token}',
        notifyTestDelivered: '已送达：{targets}',
        notifyTestFailedTargets: '失败：{targets}',
        save: '保存',
        saving: '保存中…',
        saved: '已保存并生效',
        test: '测试连接',
        testing: '测试中…',
        refresh: '刷新',
        testSuccess: 'HTTP {status} · {ms} ms',
        testFailed: '测试失败：{error}',
        testUpstream: '经 {upstream}',
        testElapsed: '耗时 {ms} ms',
        loadError: '加载失败：{error}',
        error: '出错了：{error}',
        loading: '加载中…',
        copyFailed: '复制失败，请手动选中链接复制',
        portInvalid: '端口需为 1–65535 之间的整数',
        bindHostRequired: '请填写绑定地址，例如 0.0.0.0 或 127.0.0.1',
        linksTitle: '访问链接',
        linksHint: '在同一局域网的设备上打开下面的地址；令牌由 Host 自动写入链接。',
        primary: '推荐链接',
        copy: '复制',
        copied: '已复制',
        open: '打开',
        markPrimary: '推荐',
        linksEmpty: 'Host 还没有生成访问链接，请确认 DSH 的 Web 服务已启动。',
        linksDisabled: '网关当前未启用，下面的链接暂时无法访问。',
        storePath: '配置存储：{path}',
        footerNote: '网关复用当前这个桌面会话（同一个 DSH 进程）；关闭 Harness 或停用此页面后，局域网链接立即失效。',
        tokenWarn: '当前未要求访问令牌：同一局域网内的任何设备都能打开这个界面。',
        hourUnit: '小时',
        minuteUnit: '分',
        secondUnit: '秒',
        unitGap: ' ',
      },
      en: {
        title: 'LAN access',
        description: 'Reverse-proxy the Harness Web UI to a local port and push the launch token to QQ on startup.',
        statusTitle: 'Status',
        upstream: 'DSH upstream',
        autoDetected: 'Port detected from the running Web server',
        upstreamHint: 'Port {port} · detected from the running Web server',
        unknown: 'Not detected',
        token: 'Access token',
        ready: 'Ready',
        notReady: 'Not ready',
        listener: 'Gateway listener',
        listeningOn: 'Listening on {host}:{port}',
        notListening: 'Not listening',
        portFallback: 'Requested port {requested}, using {actual}',
        login: 'Upstream login',
        loginReady: 'Signed in',
        loginPending: 'Signs in on the first request',
        requests: 'Requests',
        requestsWithErrors: '{n} ({errors} failed)',
        connections: 'Active connections',
        uptime: 'Uptime',
        lastError: 'Last error',
        none: 'None',
        justStarted: 'under 1 second',
        statusRunning: 'Listening',
        statusStopped: 'Not listening',
        statusOff: 'Disabled',
        configTitle: 'Configuration',
        enable: 'Enable LAN access',
        port: 'Port',
        portHint: '1–65535; a taken port is reported in Status',
        bindHost: 'Bind address',
        bindHint: '0.0.0.0 = all interfaces, 127.0.0.1 = this machine only',
        requireToken: 'Require access token',
        requireTokenHint: 'Links then carry ?token=… and requests without it are rejected. Keep this on for shared networks.',
        publicUrl: 'External domain',
        publicUrlHint:
          'Router reverse-proxy entry such as https://dsh.example.com; used for access links. The QQ startup push only starts once this is set (the message carries just the token, not the link).',
        notifyCardTitle: 'QQ startup notification',
        notifyCardHint:
          'On every DSH start, OneBot v11 pushes this launch token to QQ (the full link is never sent). Configure the external domain first — nothing is pushed without it.',
        notifyOnStartup: 'Push on startup',
        oneBotWsUrl: 'OneBot WS address',
        oneBotWsHint: 'OneBot forward WebSocket — the port NapCat / Lagrange listens on',
        oneBotToken: 'OneBot access_token',
        oneBotTokenStored: 'A token is stored; leave blank to keep it',
        oneBotTokenPlaceholder: 'Not set — enter the access_token',
        oneBotTokenHint: 'Write-only and never echoed back; leave blank to keep the stored token.',
        notifyTargets: 'Delivery targets',
        notifyGroup: 'Group chat',
        notifyPrivate: 'Private chat',
        groupId: 'Group number',
        userId: 'QQ number',
        notifyTitleLabel: 'Message title',
        notifyTitleHint: 'Title line of the QQ message',
        notifyTitlePlaceholder: 'DSH started',
        includeTimestamp: 'Include a timestamp',
        notifyTargetRequired: 'Pick at least one delivery target (group or private) when startup push is on.',
        notifyGroupIdInvalid: 'The group number must contain digits only.',
        notifyUserIdInvalid: 'The QQ number must contain digits only.',
        notifyUrlInvalid: 'The OneBot address must be an absolute ws:// or wss:// URL.',
        notifyPublicUrlInvalid: 'The external domain must be an absolute http:// or https:// URL, for example https://dsh.example.com.',
        notifyPreviewLabel: 'Pushed token',
        notifyPreviewEmpty: 'No external domain configured, or the launch token is not readable yet — nothing will be pushed.',
        notifyLast: 'Last push: {time} · {state}',
        notifyLastContentLabel: 'Last pushed message:',
        notifyLastTokenLabel: 'Last pushed token:',
        notifyNever: 'No push yet',
        notifyLastOk: 'succeeded',
        notifyLastFailed: 'failed',
        notifyDelivered: 'Delivered: {targets}',
        notifyFailed: 'Failed: {targets}',
        notifyListSep: ', ',
        notifyTest: 'Send test message',
        notifyTesting: 'Sending…',
        notifyTestHint: 'This really sends a message to the configured QQ targets.',
        notifyDomainRequired: 'Configure the external domain before sending.',
        notifyTestTargetRequired: 'Select at least one delivery target.',
        notifyTestOk: 'Sent ({ms} ms)',
        notifyTestFailed: 'Send failed: {error}',
        notifyTestToken: 'Token: {token}',
        notifyTestDelivered: 'Delivered: {targets}',
        notifyTestFailedTargets: 'Failed: {targets}',
        save: 'Save',
        saving: 'Saving…',
        saved: 'Saved and applied',
        test: 'Test connection',
        testing: 'Testing…',
        refresh: 'Refresh',
        testSuccess: 'HTTP {status} · {ms} ms',
        testFailed: 'Test failed: {error}',
        testUpstream: 'via {upstream}',
        testElapsed: 'Took {ms} ms',
        loadError: 'Could not load: {error}',
        error: 'Error: {error}',
        loading: 'Loading…',
        copyFailed: 'Copy failed — select the link and copy it manually',
        portInvalid: 'The port must be an integer between 1 and 65535',
        bindHostRequired: 'Enter a bind address such as 0.0.0.0 or 127.0.0.1',
        linksTitle: 'Access links',
        linksHint: 'Open one of these addresses from a device on the same network; the Host puts the token in the link for you.',
        primary: 'Primary link',
        copy: 'Copy',
        copied: 'Copied',
        open: 'Open',
        markPrimary: 'primary',
        linksEmpty: 'The Host has not produced any access link yet — check that the DSH Web server is running.',
        linksDisabled: 'The gateway is disabled, so these links will not respond right now.',
        storePath: 'Settings store: {path}',
        footerNote: 'The gateway reuses this desktop session (the same DSH process). Closing the Harness or turning this off stops the LAN links immediately.',
        tokenWarn: 'No access token is required — any device on the same network can open this UI.',
        hourUnit: 'h',
        minuteUnit: 'm',
        secondUnit: 's',
        unitGap: '',
      },
    }

    function localeIdOf(ctx) {
      try {
        const snapshot = ctx.locale?.getLocale?.() ?? ctx.locale?.getSnapshot?.()
        const id = snapshot?.id ?? snapshot?.locale ?? snapshot?.current
        return typeof id === 'string' ? id : ''
      } catch {
        return ''
      }
    }

    function makeTranslate(ctx) {
      const id = localeIdOf(ctx)
      const dict = /^en/i.test(id) ? TEXT.en : TEXT.zh
      return (key, params) => {
        const template = dict[key] ?? TEXT.zh[key] ?? key
        if (params === undefined) return template
        return template.replace(/\{(\w+)\}/g, (_, name) => (params[name] === undefined ? '' : String(params[name])))
      }
    }

    /** Set by apply(); keeps the registered component identity stable across re-registrations. */
    let activeContext

    function settingsToDraft(settings) {
      const source = settings ?? {}
      return {
        enabled: source.enabled === true,
        port: source.port === undefined || source.port === null ? '' : String(source.port),
        bindHost: typeof source.bindHost === 'string' ? source.bindHost : '',
        requireToken: source.requireToken !== false,
        publicUrl: typeof source.publicUrl === 'string' ? source.publicUrl : '',
        notifyOnStartup: source.notifyOnStartup !== false,
        notifyGroup: source.notifyGroup === true,
        groupId: typeof source.groupId === 'string' ? source.groupId : '',
        notifyPrivate: source.notifyPrivate === true,
        userId: typeof source.userId === 'string' ? source.userId : '',
        oneBotWsUrl: typeof source.oneBotWsUrl === 'string' ? source.oneBotWsUrl : '',
        oneBotTokenSet: source.oneBotTokenSet === true,
        // Write-only: never prefilled, reset after every load/save.
        oneBotAccessToken: '',
        notifyTitle: typeof source.notifyTitle === 'string' ? source.notifyTitle : '',
        includeTimestamp: source.includeTimestamp !== false,
      }
    }

    function isWsUrl(value) {
      if (typeof value !== 'string' || value.trim() === '') return false
      try {
        const url = new URL(value.trim())
        return (url.protocol === 'ws:' || url.protocol === 'wss:') && url.hostname !== ''
      } catch {
        return false
      }
    }

    function isHttpUrl(value) {
      if (typeof value !== 'string' || value.trim() === '') return false
      try {
        const url = new URL(value.trim())
        return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== ''
      } catch {
        return false
      }
    }

    function formatTimestamp(ms) {
      const value = Number(ms)
      if (!Number.isFinite(value) || value <= 0) return ''
      try {
        return new Date(value).toLocaleString()
      } catch {
        return new Date(value).toISOString()
      }
    }

    /** Renders notify target arrays that may hold plain strings or { target, error } objects. */
    function describeEntries(list, separator) {
      if (!Array.isArray(list)) return ''
      return list
        .map((entry) => {
          if (typeof entry === 'string') return entry
          if (entry === null || typeof entry !== 'object') return ''
          const target = typeof entry.target === 'string' ? entry.target : ''
          if (target === '') return ''
          return typeof entry.error === 'string' && entry.error !== '' ? target + ': ' + entry.error : target
        })
        .filter((text) => text !== '')
        .join(separator)
    }

    function linkKey(link, index) {
      return typeof link?.id === 'string' && link.id !== '' ? link.id : 'link-' + index
    }

    function formatDuration(ms, t) {
      const value = Number(ms)
      if (!Number.isFinite(value) || value < 1000) return t('justStarted')
      const total = Math.floor(value / 1000)
      const hours = Math.floor(total / 3600)
      const minutes = Math.floor((total % 3600) / 60)
      const seconds = total % 60
      const gap = t('unitGap')
      const hourText = String(hours) + gap + t('hourUnit')
      const minuteText = String(minutes) + gap + t('minuteUnit')
      const secondText = String(seconds) + gap + t('secondUnit')
      if (hours > 0) return hourText + ' ' + minuteText
      if (minutes > 0) return minuteText + ' ' + secondText
      return secondText
    }

    async function requestJson(path, init) {
      const response = await fetch(path, { ...init, cache: 'no-store' })
      let body = null
      try {
        body = await response.json()
      } catch {
        body = null
      }
      if (body === null || typeof body !== 'object') {
        throw new Error('HTTP ' + response.status)
      }
      if (body.ok !== true) {
        throw new Error(typeof body.error === 'string' && body.error !== '' ? body.error : 'HTTP ' + response.status)
      }
      return body
    }

    function copyWithTextarea(text) {
      let area = null
      try {
        area = document.createElement('textarea')
        area.value = text
        area.setAttribute('readonly', '')
        area.style.position = 'fixed'
        area.style.top = '0'
        area.style.left = '-9999px'
        area.style.opacity = '0'
        document.body.appendChild(area)
        area.focus()
        area.select()
        area.setSelectionRange(0, text.length)
        const copied = document.execCommand('copy')
        return copied === true
      } catch {
        return false
      } finally {
        if (area !== null && area.parentNode !== null) area.parentNode.removeChild(area)
      }
    }

    async function copyToClipboard(text) {
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(text)
          return true
        }
      } catch {
        // Plain-HTTP LAN pages have no async clipboard; fall through to the textarea path.
      }
      return copyWithTextarea(text)
    }

    const fieldLabel = {
      display: 'block',
      fontSize: 12,
      fontWeight: 600,
      color: 'var(--dsw-alias-label-secondary)',
      marginBottom: 6,
    }

    const inputStyle = {
      width: '100%',
      boxSizing: 'border-box',
      padding: '8px 10px',
      fontSize: 13,
      color: 'var(--dsw-alias-label-primary)',
      background: 'var(--dsw-alias-bg-layer-2)',
      border: '1px solid var(--dsw-alias-border-l1)',
      borderRadius: 8,
      outline: 'none',
      fontFamily: 'inherit',
    }

    const buttonStyle = {
      padding: '8px 16px',
      fontSize: 13,
      fontWeight: 600,
      color: 'var(--dsw-alias-label-primary)',
      background: 'var(--dsw-alias-bg-layer-2)',
      border: '1px solid var(--dsw-alias-border-l1)',
      borderRadius: 8,
      cursor: 'pointer',
      fontFamily: 'inherit',
    }

    // The host's primary fill is near-white in dark mode and near-black in light
    // mode, so the label has to be the base background rather than a fixed white.
    const primaryButtonStyle = {
      ...buttonStyle,
      color: 'var(--dsw-alias-bg-base)',
      background: 'var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary))',
      border: '1px solid var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary))',
    }

    const cardStyle = {
      border: '1px solid var(--dsw-alias-border-l1)',
      borderRadius: 12,
      padding: 16,
      background: 'var(--dsw-alias-bg-layer-1)',
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
    }

    const localStyles = `
      .dshlg-button:hover:not(:disabled) { border-color: var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); }
      .dshlg-primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover, var(--dsw-alias-border-l2)); border-color: var(--dsw-alias-button-primary-hover, var(--dsw-alias-border-l2)); }
      .dshlg-button:disabled { cursor: default; opacity: 0.6; }
      .dshlg-button:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
      .dshlg-input:focus { border-color: var(--dsw-alias-border-l2); }
      .dshlg-mono { font-family: ${MONO}; }
      .dshlg-grid { display: grid; grid-template-columns: minmax(0, 1fr) 140px; gap: 12px; }
      .dshlg-grid-2 { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
      @media (max-width: 620px) { .dshlg-grid, .dshlg-grid-2 { grid-template-columns: 1fr; } }
      .dshlg-url { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .dshlg-dot { width: 8px; height: 8px; border-radius: 999px; flex: none; display: inline-block; }
    `

    function Field(props) {
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', minWidth: 0 } },
        h('label', { style: fieldLabel }, props.label),
        props.children,
        props.hint === undefined
          ? null
          : h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', marginTop: 4 } }, props.hint),
      )
    }

    function Toggle(props) {
      return h(
        'label',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            cursor: props.disabled === true ? 'default' : 'pointer',
            fontSize: 13,
            color: 'var(--dsw-alias-label-primary)',
          },
        },
        h('input', {
          type: 'checkbox',
          role: 'switch',
          checked: props.checked === true,
          disabled: props.disabled === true,
          onChange: (event) => props.onChange(event.target.checked),
          style: { width: 16, height: 16, accentColor: 'var(--dsw-alias-brand-primary)', cursor: 'inherit' },
        }),
        h('span', null, props.label),
      )
    }

    function Card(props) {
      return h(
        'div',
        { style: cardStyle },
        props.title === undefined
          ? null
          : h(
              'div',
              {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  flexWrap: 'wrap',
                },
              },
              h('div', { style: { fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } }, props.title),
              props.aside === undefined ? null : props.aside,
            ),
        props.children,
      )
    }

    function StatusDot(props) {
      return h('span', { className: 'dshlg-dot', style: { background: props.color } })
    }

    function Badge(props) {
      return h(
        'span',
        {
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '3px 9px',
            borderRadius: 999,
            fontSize: 11.5,
            fontWeight: 600,
            color: props.color,
            border: '1px solid ' + props.color,
          },
        },
        h(StatusDot, { color: props.color }),
        props.children,
      )
    }

    function InfoRow(props) {
      return h(
        'div',
        { style: { display: 'flex', gap: 12, alignItems: 'baseline', minWidth: 0, flexWrap: 'wrap' } },
        h(
          'span',
          {
            style: {
              flex: '0 0 96px',
              fontSize: 12,
              color: 'var(--dsw-alias-label-secondary)',
            },
          },
          props.label,
        ),
        h(
          'div',
          { style: { minWidth: 0, flex: '1 1 160px', display: 'flex', flexDirection: 'column', gap: 2 } },
          h(
            'span',
            {
              className: props.mono === true ? 'dshlg-mono' : undefined,
              style: {
                fontSize: 12.5,
                color: props.color ?? 'var(--dsw-alias-label-primary)',
                wordBreak: 'break-all',
              },
            },
            props.value,
          ),
          props.hint === undefined
            ? null
            : h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, props.hint),
        ),
      )
    }

    function RowButton(props) {
      return h(
        'button',
        {
          type: 'button',
          className: 'dshlg-button',
          style: { ...buttonStyle, padding: '4px 10px', fontSize: 12, flex: 'none' },
          onClick: props.onClick,
          disabled: props.disabled === true,
        },
        props.children,
      )
    }

    function message(tone, text) {
      const color =
        tone === 'error'
          ? 'var(--dsw-alias-state-error-primary)'
          : tone === 'warn'
            ? 'var(--dsw-alias-state-warn-primary)'
            : 'var(--dsw-alias-state-success-primary)'
      return h(
        'div',
        {
          style: {
            fontSize: 12.5,
            lineHeight: 1.6,
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid var(--dsw-alias-border-l1)',
            color,
            background: 'var(--dsw-alias-bg-layer-1)',
            wordBreak: 'break-word',
          },
        },
        text,
      )
    }

    function LanGatewayPage() {
      const ctx = activeContext
      // Keying the translator on the locale id keeps the page bilingual when the
      // user switches language while it is open (localeIdOf is a cheap snapshot read).
      const localeId = localeIdOf(ctx)
      const t = React.useMemo(() => makeTranslate(ctx), [ctx, localeId])
      const [state, setState] = React.useState(null)
      const [draft, setDraft] = React.useState(null)
      const [loadError, setLoadError] = React.useState('')
      const [actionError, setActionError] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [busy, setBusy] = React.useState('')
      const [testResult, setTestResult] = React.useState(null)
      const [notifyResult, setNotifyResult] = React.useState(null)
      const [copiedKey, setCopiedKey] = React.useState('')
      const dirtyRef = React.useRef(false)
      const copyTimer = React.useRef(null)

      const load = React.useCallback(async (options) => {
        const keepDraft = options?.keepDraft === true
        if (keepDraft) setBusy((current) => (current === '' ? 'refresh' : current))
        try {
          const body = await requestJson(ENDPOINTS.state)
          setState(body)
          if (!keepDraft || !dirtyRef.current) {
            setDraft(settingsToDraft(body.settings))
            dirtyRef.current = false
          }
          setLoadError('')
        } catch (cause) {
          setLoadError(String(cause?.message ?? cause))
        } finally {
          setBusy((current) => (current === 'refresh' ? '' : current))
        }
      }, [])

      React.useEffect(() => {
        load({ keepDraft: false })
      }, [load])

      React.useEffect(() => {
        if (typeof window === 'undefined') return undefined
        const onFocus = () => {
          load({ keepDraft: true })
        }
        window.addEventListener('focus', onFocus)
        return () => window.removeEventListener('focus', onFocus)
      }, [load])

      React.useEffect(
        () => () => {
          if (copyTimer.current !== null) {
            clearTimeout(copyTimer.current)
            copyTimer.current = null
          }
        },
        [],
      )

      const update = (patch) => {
        dirtyRef.current = true
        setDraft((current) => (current === null ? current : { ...current, ...patch }))
      }

      const save = async () => {
        if (draft === null) return
        const port = Number(draft.port)
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          setActionError(t('portInvalid'))
          return
        }
        const bindHost = draft.bindHost.trim()
        if (bindHost === '') {
          setActionError(t('bindHostRequired'))
          return
        }
        const oneBotWsUrl = draft.oneBotWsUrl.trim()
        const publicUrl = draft.publicUrl.trim()
        const groupId = draft.groupId.trim()
        const userId = draft.userId.trim()
        if ((draft.notifyOnStartup || oneBotWsUrl !== '') && !isWsUrl(oneBotWsUrl)) {
          setActionError(t('notifyUrlInvalid'))
          return
        }
        // The external domain is the opt-in for pushing: without it the Host stays silent.
        if (draft.notifyOnStartup && !isHttpUrl(publicUrl)) {
          setActionError(t('notifyPublicUrlInvalid'))
          return
        }
        if (draft.notifyGroup && !/^\d+$/.test(groupId)) {
          setActionError(t('notifyGroupIdInvalid'))
          return
        }
        if (draft.notifyPrivate && !/^\d+$/.test(userId)) {
          setActionError(t('notifyUserIdInvalid'))
          return
        }
        if (draft.notifyOnStartup && !draft.notifyGroup && !draft.notifyPrivate) {
          setActionError(t('notifyTargetRequired'))
          return
        }
        setBusy('save')
        setNotice('')
        setActionError('')
        setTestResult(null)
        setNotifyResult(null)
        try {
          const nextSettings = {
            enabled: draft.enabled,
            port,
            bindHost,
            requireToken: draft.requireToken,
            publicUrl,
            notifyOnStartup: draft.notifyOnStartup,
            notifyGroup: draft.notifyGroup,
            groupId,
            notifyPrivate: draft.notifyPrivate,
            userId,
            oneBotWsUrl,
            notifyTitle: draft.notifyTitle.trim(),
            includeTimestamp: draft.includeTimestamp,
          }
          // Write-only: only send the OneBot token when the user actually typed one.
          if (draft.oneBotAccessToken !== '') nextSettings.oneBotAccessToken = draft.oneBotAccessToken
          const body = await requestJson(ENDPOINTS.save, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ settings: nextSettings }),
          })
          const warning = typeof body.warning === 'string' ? body.warning : ''
          setState(body)
          setDraft(settingsToDraft(body.settings))
          dirtyRef.current = false
          setNotice(warning === '' ? t('saved') : '')
        } catch (cause) {
          setActionError(t('error', { error: String(cause?.message ?? cause) }))
        } finally {
          setBusy('')
        }
      }

      const runTest = async () => {
        setBusy('test')
        setTestResult(null)
        setActionError('')
        setNotice('')
        let passed = false
        try {
          const body = await requestJson(ENDPOINTS.test, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
          })
          const result = body.result ?? null
          setTestResult(result)
          passed = result?.ok === true
        } catch (cause) {
          setTestResult({ ok: false, error: String(cause?.message ?? cause) })
        } finally {
          setBusy('')
        }
        if (passed) await load({ keepDraft: true })
      }

      const runNotifyTest = async () => {
        if (draft === null || busy !== '') return
        // Sending is gated on the saved external domain: it is the opt-in for QQ pushes.
        if (draft.publicUrl.trim() === '' || state?.notify?.domainReady !== true) {
          setActionError(t('notifyDomainRequired'))
          return
        }
        const hasTarget =
          (draft.notifyGroup && draft.groupId.trim() !== '') ||
          (draft.notifyPrivate && draft.userId.trim() !== '')
        if (!hasTarget) {
          setActionError(t('notifyTestTargetRequired'))
          return
        }
        setBusy('notify')
        setNotifyResult(null)
        setActionError('')
        setNotice('')
        let passed = false
        try {
          const body = await requestJson(ENDPOINTS.testNotify, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
          })
          const result = body.result ?? null
          setNotifyResult(result)
          passed = result?.ok === true
        } catch (cause) {
          setNotifyResult({ ok: false, error: String(cause?.message ?? cause) })
        } finally {
          setBusy('')
        }
        if (passed) await load({ keepDraft: true })
      }

      const refresh = () => {
        setActionError('')
        load({ keepDraft: true })
      }

      const copyLink = async (key, url) => {
        if (typeof url !== 'string' || url === '') return
        const copied = await copyToClipboard(url)
        if (!copied) {
          setActionError(t('copyFailed'))
          return
        }
        setActionError('')
        setCopiedKey(key)
        if (copyTimer.current !== null) clearTimeout(copyTimer.current)
        copyTimer.current = setTimeout(() => {
          setCopiedKey('')
          copyTimer.current = null
        }, 1800)
      }

      const openLink = (url) => {
        if (typeof url !== 'string' || url === '') return
        try {
          window.open(url, '_blank', 'noopener')
        } catch (cause) {
          setActionError(t('error', { error: String(cause?.message ?? cause) }))
        }
      }

      if (draft === null) {
        return h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 12, padding: 24 } },
          h(
            'div',
            {
              style: {
                fontSize: 13,
                lineHeight: 1.6,
                color: loadError === '' ? 'var(--dsw-alias-label-secondary)' : 'var(--dsw-alias-state-error-primary)',
              },
            },
            loadError === '' ? t('loading') : t('loadError', { error: loadError }),
          ),
          loadError === ''
            ? null
            : h(
                'div',
                null,
                h('button', { type: 'button', className: 'dshlg-button', style: buttonStyle, onClick: refresh }, t('refresh')),
              ),
        )
      }

      const settings = state?.settings ?? {}
      const status = state?.status ?? {}
      const upstream = state?.upstream ?? {}
      const links = Array.isArray(state?.links) ? state.links : []
      const primaryLink = typeof state?.primaryLink === 'string' ? state.primaryLink : ''
      const warning = typeof state?.warning === 'string' ? state.warning : ''
      const enabled = settings.enabled === true
      const listening = status.listening === true
      const tokenReady = status.tokenReady === true
      const cookieReady = status.cookieReady === true
      const bindHost = typeof status.bindHost === 'string' && status.bindHost !== '' ? status.bindHost : draft.bindHost
      const actualPort = status.port
      const requestedPort = status.requestedPort
      const requests = Number.isFinite(status.requests) ? status.requests : 0
      const errors = Number.isFinite(status.errors) ? status.errors : 0
      const connections = Number.isFinite(status.activeConnections) ? status.activeConnections : 0
      const uptimeMs = Number.isFinite(status.uptimeMs)
        ? status.uptimeMs
        : Number.isFinite(status.startedAt)
          ? Date.now() - status.startedAt
          : null
      const lastError = typeof status.lastError === 'string' ? status.lastError : ''
      const notify = state?.notify ?? {}
      const notifyPreview = typeof state?.notifyPreview === 'string' ? state.notifyPreview : ''
      const notifyLastAt = Number.isFinite(notify.lastAt) && notify.lastAt > 0 ? notify.lastAt : 0
      const notifyLastContent = typeof notify.lastContent === 'string' ? notify.lastContent : ''
      const notifyLastToken = typeof notify.lastToken === 'string' ? notify.lastToken : ''
      const notifyHasTarget =
        (draft.notifyGroup && draft.groupId.trim() !== '') ||
        (draft.notifyPrivate && draft.userId.trim() !== '')
      const notifyDomainReady = notify.domainReady === true && draft.publicUrl.trim() !== ''
      const notifyCanTest = notifyDomainReady && notifyHasTarget
      const notifyLastDelivered = describeEntries(notify.lastDelivered, t('notifyListSep'))
      const notifyLastFailed = describeEntries(notify.lastFailed, t('notifyListSep'))
      const notifyResultDelivered =
        notifyResult === null ? '' : describeEntries(notifyResult.delivered, t('notifyListSep'))
      const notifyResultFailed =
        notifyResult === null ? '' : describeEntries(notifyResult.failed, t('notifyListSep'))

      const tone = enabled ? (listening ? 'ok' : 'error') : 'muted'
      const toneColor =
        tone === 'ok'
          ? 'var(--dsw-alias-state-success-primary)'
          : tone === 'error'
            ? 'var(--dsw-alias-state-error-primary)'
            : 'var(--dsw-alias-label-secondary)'
      const badgeText = enabled ? (listening ? t('statusRunning') : t('statusStopped')) : t('statusOff')
      const portHint =
        Number.isFinite(actualPort) && Number.isFinite(requestedPort) && actualPort !== requestedPort
          ? t('portFallback', { requested: requestedPort, actual: actualPort })
          : undefined

      const linkRow = (link, index) => {
        const key = linkKey(link, index)
        const copyState = 'link:' + key
        const url = typeof link?.url === 'string' ? link.url : ''
        const label = typeof link?.label === 'string' && link.label !== '' ? link.label : key
        return h(
          'div',
          {
            key: 'link:' + key,
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 10px',
              borderRadius: 8,
              border: '1px solid var(--dsw-alias-border-l1)',
              background: 'var(--dsw-alias-bg-layer-2)',
              minWidth: 0,
              flexWrap: 'wrap',
            },
          },
          h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: '1 1 200px' } },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 } },
              h(
                'span',
                { style: { fontSize: 12.5, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } },
                label,
              ),
              url !== '' && url === primaryLink
                ? h(
                    'span',
                    {
                      style: {
                        fontSize: 10.5,
                        padding: '0 6px',
                        borderRadius: 999,
                        color: 'var(--dsw-alias-brand-primary)',
                        border: '1px solid var(--dsw-alias-brand-primary)',
                      },
                    },
                    t('markPrimary'),
                  )
                : null,
            ),
            h(
              'span',
              {
                className: 'dshlg-mono dshlg-url',
                title: url,
                style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)' },
              },
              url,
            ),
          ),
          h(
            RowButton,
            { onClick: () => copyLink(copyState, url) },
            copiedKey === copyState ? t('copied') : t('copy'),
          ),
          h(RowButton, { onClick: () => openLink(url) }, t('open')),
        )
      }

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 16, padding: '4px 2px 32px' } },
        h('style', { key: 'dshlg-styles' }, localStyles),

        h(
          'div',
          null,
          h('h2', { style: { margin: 0, fontSize: 17, color: 'var(--dsw-alias-label-primary)' } }, t('title')),
          h(
            'p',
            { style: { margin: '6px 0 0', fontSize: 12.5, lineHeight: 1.6, color: 'var(--dsw-alias-label-secondary)' } },
            t('description'),
          ),
        ),

        loadError === '' ? null : message('error', t('loadError', { error: loadError })),

        h(
          Card,
          {
            title: t('statusTitle'),
            aside: h(Badge, { color: toneColor }, badgeText),
          },
          h(InfoRow, {
            label: t('upstream'),
            value: typeof upstream.origin === 'string' && upstream.origin !== '' ? upstream.origin : t('unknown'),
            mono: true,
            hint: Number.isFinite(upstream.port) && upstream.port > 0 ? t('upstreamHint', { port: upstream.port }) : t('autoDetected'),
          }),
          h(InfoRow, {
            label: t('token'),
            value: tokenReady ? t('ready') : t('notReady'),
            color: tokenReady ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-warn-primary)',
          }),
          h(InfoRow, {
            label: t('listener'),
            value: listening
              ? t('listeningOn', { host: bindHost === '' ? '—' : bindHost, port: Number.isFinite(actualPort) ? actualPort : '—' })
              : t('notListening'),
            color: listening ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-error-primary)',
            hint: portHint,
          }),
          h(InfoRow, {
            label: t('login'),
            value: cookieReady ? t('loginReady') : t('loginPending'),
            color: cookieReady ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-label-secondary)',
          }),
          h(InfoRow, {
            label: t('requests'),
            value: errors > 0 ? t('requestsWithErrors', { n: requests, errors }) : String(requests),
          }),
          h(InfoRow, { label: t('connections'), value: String(connections) }),
          h(InfoRow, {
            label: t('uptime'),
            value: listening && uptimeMs !== null ? formatDuration(uptimeMs, t) : t('none'),
          }),
          h(InfoRow, {
            label: t('lastError'),
            value: lastError === '' ? t('none') : lastError,
            color: lastError === '' ? 'var(--dsw-alias-label-secondary)' : 'var(--dsw-alias-state-error-primary)',
          }),
        ),

        h(
          Card,
          { title: t('configTitle') },
          h(Toggle, {
            checked: draft.enabled,
            label: t('enable'),
            disabled: busy !== '',
            onChange: (value) => update({ enabled: value }),
          }),
          h(
            'div',
            { className: 'dshlg-grid' },
            h(
              Field,
              { label: t('bindHost'), hint: t('bindHint') },
              h('input', {
                style: inputStyle,
                className: 'dshlg-input',
                value: draft.bindHost,
                placeholder: '0.0.0.0',
                spellCheck: false,
                autoComplete: 'off',
                onChange: (event) => update({ bindHost: event.target.value }),
              }),
            ),
            h(
              Field,
              { label: t('port'), hint: t('portHint') },
              h('input', {
                style: inputStyle,
                className: 'dshlg-input',
                value: draft.port,
                inputMode: 'numeric',
                placeholder: '3080',
                onChange: (event) => update({ port: event.target.value.replace(/[^0-9]/g, '') }),
              }),
            ),
          ),
          h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
            h(Toggle, {
              checked: draft.requireToken,
              label: t('requireToken'),
              disabled: busy !== '',
              onChange: (value) => update({ requireToken: value }),
            }),
            h(
              'span',
              { style: { fontSize: 11, lineHeight: 1.6, color: 'var(--dsw-alias-label-secondary)', paddingLeft: 26 } },
              t('requireTokenHint'),
            ),
          ),
          h(
            Field,
            { label: t('publicUrl'), hint: t('publicUrlHint') },
            h('input', {
              style: inputStyle,
              className: 'dshlg-input dshlg-mono',
              value: draft.publicUrl,
              placeholder: PUBLIC_URL_EXAMPLE,
              spellCheck: false,
              autoComplete: 'off',
              onChange: (event) => update({ publicUrl: event.target.value }),
            }),
          ),
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
            h(
              'button',
              {
                type: 'button',
                className: 'dshlg-button dshlg-primary',
                disabled: busy !== '',
                style: primaryButtonStyle,
                onClick: save,
              },
              busy === 'save' ? t('saving') : t('save'),
            ),
            h(
              'button',
              { type: 'button', className: 'dshlg-button', disabled: busy !== '', style: buttonStyle, onClick: runTest },
              busy === 'test' ? t('testing') : t('test'),
            ),
            h(
              'button',
              { type: 'button', className: 'dshlg-button', disabled: busy !== '', style: buttonStyle, onClick: refresh },
              t('refresh'),
            ),
          ),
          testResult === null
            ? null
            : h(
                'div',
                {
                  style: {
                    fontSize: 12.5,
                    lineHeight: 1.6,
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid var(--dsw-alias-border-l1)',
                    color:
                      testResult.ok === true
                        ? 'var(--dsw-alias-state-success-primary)'
                        : 'var(--dsw-alias-state-error-primary)',
                    background: 'var(--dsw-alias-bg-layer-1)',
                    wordBreak: 'break-word',
                  },
                },
                h(
                  'div',
                  { style: { fontWeight: 600 } },
                  testResult.ok === true
                    ? t('testSuccess', { status: testResult.status ?? '—', ms: testResult.ms ?? 0 })
                    : t('testFailed', { error: typeof testResult.error === 'string' && testResult.error !== '' ? testResult.error : t('unknown') }),
                ),
                testResult.ok === true && typeof testResult.upstream === 'string' && testResult.upstream !== ''
                  ? h(
                      'div',
                      { style: { marginTop: 3, fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)' } },
                      t('testUpstream', { upstream: testResult.upstream }) +
                        (typeof testResult.contentType === 'string' && testResult.contentType !== ''
                          ? ' · ' + testResult.contentType
                          : ''),
                    )
                  : null,
                testResult.ok !== true && Number.isFinite(testResult.ms)
                  ? h(
                      'div',
                      { style: { marginTop: 3, fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)' } },
                      t('testElapsed', { ms: testResult.ms }),
                    )
                  : null,
              ),
          warning === '' ? null : message('warn', warning),
          notice === '' ? null : message('ok', notice),
          actionError === '' ? null : message('error', actionError),
        ),

        h(
          Card,
          { title: t('notifyCardTitle') },
          h(
            'p',
            { style: { margin: 0, fontSize: 11.5, lineHeight: 1.6, color: 'var(--dsw-alias-label-secondary)' } },
            t('notifyCardHint'),
          ),
          h(Toggle, {
            checked: draft.notifyOnStartup,
            label: t('notifyOnStartup'),
            disabled: busy !== '',
            onChange: (value) => update({ notifyOnStartup: value }),
          }),
          h(
            'div',
            { className: 'dshlg-grid-2' },
            h(
              Field,
              { label: t('oneBotWsUrl'), hint: t('oneBotWsHint') },
              h('input', {
                style: inputStyle,
                className: 'dshlg-input dshlg-mono',
                value: draft.oneBotWsUrl,
                placeholder: 'ws://127.0.0.1:3001',
                spellCheck: false,
                autoComplete: 'off',
                onChange: (event) => update({ oneBotWsUrl: event.target.value }),
              }),
            ),
            h(
              Field,
              { label: t('notifyTitleLabel'), hint: t('notifyTitleHint') },
              h('input', {
                style: inputStyle,
                value: draft.notifyTitle,
                placeholder: t('notifyTitlePlaceholder'),
                spellCheck: false,
                autoComplete: 'off',
                onChange: (event) => update({ notifyTitle: event.target.value }),
              }),
            ),
          ),
          h(
            Field,
            { label: t('oneBotToken'), hint: t('oneBotTokenHint') },
            h('input', {
              style: inputStyle,
              className: 'dshlg-input',
              type: 'password',
              value: draft.oneBotAccessToken,
              placeholder: draft.oneBotTokenSet ? t('oneBotTokenStored') : t('oneBotTokenPlaceholder'),
              autoComplete: 'new-password',
              spellCheck: false,
              onChange: (event) => update({ oneBotAccessToken: event.target.value }),
            }),
          ),
          h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
            h('div', { style: fieldLabel }, t('notifyTargets')),
            h(
              'div',
              { className: 'dshlg-grid-2' },
              h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 } },
                h(Toggle, {
                  checked: draft.notifyGroup,
                  label: t('notifyGroup'),
                  disabled: busy !== '',
                  onChange: (value) => update({ notifyGroup: value }),
                }),
                h(
                  Field,
                  { label: t('groupId') },
                  h('input', {
                    style: inputStyle,
                    className: 'dshlg-input dshlg-mono',
                    value: draft.groupId,
                    placeholder: '123456789',
                    inputMode: 'numeric',
                    spellCheck: false,
                    autoComplete: 'off',
                    onChange: (event) => update({ groupId: event.target.value.replace(/[^0-9]/g, '') }),
                  }),
                ),
              ),
              h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 } },
                h(Toggle, {
                  checked: draft.notifyPrivate,
                  label: t('notifyPrivate'),
                  disabled: busy !== '',
                  onChange: (value) => update({ notifyPrivate: value }),
                }),
                h(
                  Field,
                  { label: t('userId') },
                  h('input', {
                    style: inputStyle,
                    className: 'dshlg-input dshlg-mono',
                    value: draft.userId,
                    placeholder: '10001',
                    inputMode: 'numeric',
                    spellCheck: false,
                    autoComplete: 'off',
                    onChange: (event) => update({ userId: event.target.value.replace(/[^0-9]/g, '') }),
                  }),
                ),
              ),
            ),
            draft.notifyOnStartup && !draft.notifyGroup && !draft.notifyPrivate
              ? h(
                  'div',
                  { style: { fontSize: 11.5, color: 'var(--dsw-alias-state-warn-primary)' } },
                  t('notifyTargetRequired'),
                )
              : null,
          ),
          h(Toggle, {
            checked: draft.includeTimestamp,
            label: t('includeTimestamp'),
            disabled: busy !== '',
            onChange: (value) => update({ includeTimestamp: value }),
          }),
          h(
            'div',
            {
              style: {
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid var(--dsw-alias-border-l1)',
                background: 'var(--dsw-alias-bg-layer-2)',
                minWidth: 0,
              },
            },
            h('div', { style: fieldLabel }, t('notifyPreviewLabel')),
            h(
              'div',
              {
                className: notifyPreview === '' ? 'dshlg-mono' : 'dshlg-mono dshlg-url',
                title: notifyPreview === '' ? undefined : notifyPreview,
                style: {
                  fontSize: 11.5,
                  lineHeight: 1.6,
                  wordBreak: 'break-all',
                  color:
                    notifyPreview === ''
                      ? 'var(--dsw-alias-label-secondary)'
                      : 'var(--dsw-alias-label-primary)',
                },
              },
              notifyPreview === '' ? t('notifyPreviewEmpty') : notifyPreview,
            ),
            h(
              'div',
              { style: { fontSize: 11.5, lineHeight: 1.6, color: 'var(--dsw-alias-label-secondary)' } },
              notifyLastAt > 0
                ? t('notifyLast', {
                    time: formatTimestamp(notifyLastAt),
                    state: notify.lastOk === true ? t('notifyLastOk') : t('notifyLastFailed'),
                  })
                : t('notifyNever'),
            ),
            notifyLastContent === '' && notifyLastToken === ''
              ? null
              : h(
                  'div',
                  { style: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 } },
                  h(
                    'span',
                    { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } },
                    notifyLastContent === '' ? t('notifyLastTokenLabel') : t('notifyLastContentLabel'),
                  ),
                  h(
                    'span',
                    {
                      className: 'dshlg-mono',
                      title: notifyLastContent === '' ? notifyLastToken : notifyLastContent,
                      style: {
                        fontSize: 11,
                        lineHeight: 1.6,
                        color: 'var(--dsw-alias-label-secondary)',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      },
                    },
                    notifyLastContent === '' ? notifyLastToken : notifyLastContent,
                  ),
                ),
            notifyLastDelivered === ''
              ? null
              : h(
                  'div',
                  {
                    style: {
                      fontSize: 11.5,
                      lineHeight: 1.6,
                      color: 'var(--dsw-alias-state-success-primary)',
                      wordBreak: 'break-word',
                    },
                  },
                  t('notifyDelivered', { targets: notifyLastDelivered }),
                ),
            notifyLastFailed === ''
              ? null
              : h(
                  'div',
                  {
                    style: {
                      fontSize: 11.5,
                      lineHeight: 1.6,
                      color: 'var(--dsw-alias-state-error-primary)',
                      wordBreak: 'break-word',
                    },
                  },
                  t('notifyFailed', { targets: notifyLastFailed }),
                ),
            typeof notify.lastError === 'string' && notify.lastError !== ''
              ? h(
                  'div',
                  {
                    style: {
                      fontSize: 11.5,
                      lineHeight: 1.6,
                      color: 'var(--dsw-alias-state-error-primary)',
                      wordBreak: 'break-word',
                    },
                  },
                  notify.lastError,
                )
              : null,
          ),
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
            h(
              'button',
              {
                type: 'button',
                className: 'dshlg-button',
                disabled: busy !== '' || !notifyCanTest,
                style: buttonStyle,
                onClick: runNotifyTest,
              },
              busy === 'notify' ? t('notifyTesting') : t('notifyTest'),
            ),
            h(
              'span',
              {
                style: {
                  fontSize: 11,
                  color: notifyCanTest
                    ? 'var(--dsw-alias-label-secondary)'
                    : 'var(--dsw-alias-state-warn-primary)',
                },
              },
              notifyDomainReady
                ? notifyHasTarget
                  ? t('notifyTestHint')
                  : t('notifyTestTargetRequired')
                : t('notifyDomainRequired'),
            ),
          ),
          notifyResult === null
            ? null
            : h(
                'div',
                {
                  style: {
                    fontSize: 12.5,
                    lineHeight: 1.6,
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid var(--dsw-alias-border-l1)',
                    color:
                      notifyResult.ok === true
                        ? 'var(--dsw-alias-state-success-primary)'
                        : 'var(--dsw-alias-state-error-primary)',
                    background: 'var(--dsw-alias-bg-layer-1)',
                    wordBreak: 'break-word',
                  },
                },
                h(
                  'div',
                  { style: { fontWeight: 600 } },
                  notifyResult.ok === true
                    ? t('notifyTestOk', { ms: Number.isFinite(notifyResult.ms) ? notifyResult.ms : 0 })
                    : t('notifyTestFailed', {
                        error:
                          typeof notifyResult.error === 'string' && notifyResult.error !== ''
                            ? notifyResult.error
                            : t('unknown'),
                      }),
                ),
                typeof notifyResult.token === 'string' && notifyResult.token !== ''
                  ? h(
                      'div',
                      {
                        className: 'dshlg-mono',
                        title: notifyResult.token,
                        style: {
                          marginTop: 3,
                          fontSize: 11.5,
                          color: 'var(--dsw-alias-label-secondary)',
                          wordBreak: 'break-all',
                        },
                      },
                      t('notifyTestToken', { token: notifyResult.token }),
                    )
                  : null,
                notifyResultDelivered === ''
                  ? null
                  : h(
                      'div',
                      { style: { marginTop: 3, fontSize: 11.5, color: 'var(--dsw-alias-state-success-primary)' } },
                      t('notifyTestDelivered', { targets: notifyResultDelivered }),
                    ),
                notifyResultFailed === ''
                  ? null
                  : h(
                      'div',
                      { style: { marginTop: 3, fontSize: 11.5, color: 'var(--dsw-alias-state-error-primary)' } },
                      t('notifyTestFailedTargets', { targets: notifyResultFailed }),
                    ),
              ),
        ),

        h(
          Card,
          { title: t('linksTitle') },
          h(
            'p',
            { style: { margin: 0, fontSize: 11.5, lineHeight: 1.6, color: 'var(--dsw-alias-label-secondary)' } },
            t('linksHint'),
          ),
          primaryLink === ''
            ? null
            : h(
                'div',
                {
                  style: {
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                    padding: 12,
                    borderRadius: 10,
                    border: '1px solid var(--dsw-alias-border-l2)',
                    background: 'var(--dsw-alias-bg-layer-2)',
                    minWidth: 0,
                  },
                },
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                  h(StatusDot, { color: 'var(--dsw-alias-brand-primary)' }),
                  h(
                    'span',
                    {
                      style: {
                        fontSize: 11.5,
                        fontWeight: 600,
                        letterSpacing: 0.3,
                        textTransform: 'uppercase',
                        color: 'var(--dsw-alias-brand-primary)',
                      },
                    },
                    t('primary'),
                  ),
                ),
                h(
                  'span',
                  {
                    className: 'dshlg-mono',
                    style: { fontSize: 13, color: 'var(--dsw-alias-label-primary)', wordBreak: 'break-all' },
                  },
                  primaryLink,
                ),
                h(
                  'div',
                  { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
                  h(
                    RowButton,
                    { onClick: () => copyLink(PRIMARY_KEY, primaryLink) },
                    copiedKey === PRIMARY_KEY ? t('copied') : t('copy'),
                  ),
                  h(RowButton, { onClick: () => openLink(primaryLink) }, t('open')),
                ),
              ),
          links.length === 0
            ? h(
                'div',
                { style: { fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)' } },
                t('linksEmpty'),
              )
            : h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                links.map((link, index) => linkRow(link ?? {}, index)),
              ),
          enabled
            ? null
            : h(
                'div',
                { style: { fontSize: 12, color: 'var(--dsw-alias-state-warn-primary)' } },
                t('linksDisabled'),
              ),
        ),

        h(
          'div',
          {
            style: {
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              fontSize: 11.5,
              lineHeight: 1.7,
              color: 'var(--dsw-alias-label-secondary)',
              borderTop: '1px solid var(--dsw-alias-border-l1)',
              paddingTop: 12,
            },
          },
          h(
            'div',
            { className: 'dshlg-mono', style: { wordBreak: 'break-all' } },
            t('storePath', { path: typeof state?.storePath === 'string' && state.storePath !== '' ? state.storePath : '—' }),
          ),
          h('div', null, t('footerNote')),
          draft.requireToken === true
            ? null
            : h('div', { style: { color: 'var(--dsw-alias-state-warn-primary)' } }, t('tokenWarn')),
        ),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        activeContext = ctx
        const t = makeTranslate(ctx)
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'lan-gateway',
              order: 35,
              label: () => t('title'),
            },
            LanGatewayPage,
          ),
        )
      },
    }
  },
})
