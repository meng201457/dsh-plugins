window.__ModuleLoader__.load({
  id: 'dsh-api-proxy',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const API = '/api/dsh-api-proxy'

    const TEXT = {
      zh: {
        title: '网络代理',
        description: '为模型 API 请求指定 HTTP/HTTPS（CONNECT）代理。只代理你勾选的目标，其余请求保持直连。',
        enabled: '启用代理',
        host: '代理 IP / 主机',
        port: '端口',
        username: '用户名（可选）',
        password: '密码（可选）',
        passwordSet: '已保存密码，留空表示不修改',
        skipPrivate: '私有网段保持直连（10.x / 172.16-31.x / 192.168.x）',
        targets: '走代理的 API 目标',
        targetsHint: '列表来自当前 DSH 配置里手动填写的 API 地址。',
        targetsEmpty: '没有检测到已配置的 API 地址。',
        privateTag: '私有网段',
        extra: '额外域名（每行一个，支持 *.example.com）',
        save: '保存',
        saving: '保存中…',
        saved: '已保存并生效',
        test: '测试连接',
        testing: '测试中…',
        refresh: '刷新',
        status: '代理状态：{state}',
        statusOn: '已启用',
        statusOff: '未启用',
        proxiedCount: '本次运行已转发 {n} 个请求',
        noTargets: '还没有勾选任何 API 目标，代理不会生效。',
        selectAll: '全选',
        clearAll: '清空',
        testSuccess: '测试成功：HTTP {status}，耗时 {ms} ms（经 {proxy}）',
        testFailed: '测试失败：{error}',
        testNoTarget: '请先勾选至少一个目标，或填写代理地址后再测试',
        error: '出错了：{error}',
      },
      en: {
        title: 'Network proxy',
        description: 'Route model API requests through an HTTP/HTTPS (CONNECT) proxy. Only the targets you check are proxied.',
        enabled: 'Enable proxy',
        host: 'Proxy IP / host',
        port: 'Port',
        username: 'User name (optional)',
        password: 'Password (optional)',
        passwordSet: 'A password is stored; leave blank to keep it',
        skipPrivate: 'Keep private networks direct (10.x / 172.16-31.x / 192.168.x)',
        targets: 'API targets that use the proxy',
        targetsHint: 'Detected from the API endpoints currently configured in this Harness.',
        targetsEmpty: 'No configured API endpoint was detected.',
        privateTag: 'private',
        extra: 'Extra hosts (one per line, *.example.com supported)',
        save: 'Save',
        saving: 'Saving…',
        saved: 'Saved and applied',
        test: 'Test connection',
        testing: 'Testing…',
        refresh: 'Refresh',
        status: 'Proxy status: {state}',
        statusOn: 'enabled',
        statusOff: 'disabled',
        proxiedCount: '{n} requests forwarded this run',
        noTargets: 'No API target selected yet — the proxy stays idle.',
        selectAll: 'Select all',
        clearAll: 'Clear',
        testSuccess: 'Connected: HTTP {status} in {ms} ms (via {proxy})',
        testFailed: 'Test failed: {error}',
        testNoTarget: 'Pick a target or fill in the proxy address first',
        error: 'Error: {error}',
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

    function keepPasswordFlag(current, snapshot) {
      return snapshot.password !== '' || current.passwordSet
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

    const localStyles = `
      .dsap-button:hover:not(:disabled) { border-color: var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); }
      .dsap-primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover, var(--dsw-alias-border-l2)); border-color: var(--dsw-alias-button-primary-hover, var(--dsw-alias-border-l2)); }
      .dsap-button:disabled { cursor: default; opacity: 0.6; }
      .dsap-button:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
      .dsap-input:focus { border-color: var(--dsw-alias-border-l2); }
    `

    const cardStyle = {
      border: '1px solid var(--dsw-alias-border-l1)',
      borderRadius: 12,
      padding: 16,
      background: 'var(--dsw-alias-bg-layer-1)',
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
    }

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

    function ProxySettingsPage() {
      const ctx = activeContext
      const t = React.useMemo(() => makeTranslate(ctx), [ctx])
      const [state, setState] = React.useState(null)
      const [draft, setDraft] = React.useState(null)
      const [error, setError] = React.useState('')
      const [busy, setBusy] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [testResult, setTestResult] = React.useState(null)

      const load = React.useCallback(async () => {
        try {
          const response = await fetch(API + '/state', { cache: 'no-store' })
          const body = await response.json()
          if (body.ok !== true) throw new Error(body.error ?? 'state failed')
          setState(body)
          setDraft({
            enabled: body.settings.enabled,
            host: body.settings.host,
            port: String(body.settings.port || ''),
            username: body.settings.username,
            password: '',
            passwordSet: body.settings.passwordSet,
            targets: [...body.settings.targets],
            extraHosts: [...body.settings.extraHosts],
            skipPrivateNetworks: body.settings.skipPrivateNetworks,
          })
          setError('')
        } catch (cause) {
          setError(String(cause?.message ?? cause))
        }
      }, [])

      React.useEffect(() => {
        load()
      }, [load])

      const update = (patch) => setDraft((current) => (current === null ? current : { ...current, ...patch }))

      const toggleTarget = (id) => {
        setDraft((current) => {
          if (current === null) return current
          const has = current.targets.includes(id)
          return { ...current, targets: has ? current.targets.filter((item) => item !== id) : [...current.targets, id] }
        })
      }

      const save = async () => {
        if (draft === null) return
        setBusy('save')
        setNotice('')
        setError('')
        try {
          const payload = {
            enabled: draft.enabled,
            host: draft.host,
            port: Number(draft.port) || 0,
            username: draft.username,
            targets: draft.targets,
            extraHosts: draft.extraHosts
              .map((line) => line.trim())
              .filter((line) => line !== ''),
            skipPrivateNetworks: draft.skipPrivateNetworks,
          }
          if (draft.password !== '') payload.password = draft.password
          const response = await fetch(API + '/save', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ settings: payload }),
          })
          const body = await response.json()
          if (body.ok !== true) throw new Error(body.error ?? 'save failed')
          setState(body)
          setDraft((current) => (current === null ? current : { ...current, password: '', passwordSet: keepPasswordFlag(current, draft) }))
          setNotice(body.warning ? body.warning : t('saved'))
        } catch (cause) {
          setError(t('error', { error: String(cause?.message ?? cause) }))
        } finally {
          setBusy('')
        }
      }

      const runTest = async () => {
        if (draft === null) return
        const target = (state?.endpoints ?? []).find((item) => draft.targets.includes(item.id)) ?? state?.endpoints?.[0]
        if (target === undefined) {
          setError(t('testNoTarget'))
          return
        }
        setBusy('test')
        setTestResult(null)
        try {
          const response = await fetch(API + '/test', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              host: draft.host,
              port: Number(draft.port) || 0,
              username: draft.username,
              password: draft.password,
              url: target.baseURL,
            }),
          })
          const body = await response.json()
          if (body.ok !== true) throw new Error(body.error ?? 'test failed')
          setTestResult(body.result)
        } catch (cause) {
          setTestResult({ ok: false, error: String(cause?.message ?? cause) })
        } finally {
          setBusy('')
        }
      }

      if (draft === null) {
        return h(
          'div',
          { style: { padding: 24, color: 'var(--dsw-alias-label-secondary)', fontSize: 13 } },
          error === '' ? '…' : t('error', { error }),
        )
      }

      const settings = state?.settings ?? { enabled: false, targets: [] }
      const status = state?.status ?? {}
      const endpoints = state?.endpoints ?? []

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 16, padding: '4px 2px 32px' } },
        h('style', { key: 'dsap-styles' }, localStyles),
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

        h(
          'div',
          { style: cardStyle },
          h(Toggle, {
            checked: draft.enabled,
            label: t('enabled'),
            onChange: (value) => update({ enabled: value }),
          }),
          h(
            'div',
            { style: { display: 'grid', gridTemplateColumns: '1fr 120px', gap: 12 } },
            h(Field, { label: t('host') }, h('input', {
              style: inputStyle,
              className: 'dsap-input',
              value: draft.host,
              placeholder: '127.0.0.1',
              onChange: (event) => update({ host: event.target.value }),
            })),
            h(Field, { label: t('port') }, h('input', {
              style: inputStyle,
              className: 'dsap-input',
              value: draft.port,
              inputMode: 'numeric',
              placeholder: '7890',
              onChange: (event) => update({ port: event.target.value.replace(/[^0-9]/g, '') }),
            })),
          ),
          h(
            'div',
            { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 } },
            h(Field, { label: t('username') }, h('input', {
              style: inputStyle,
              className: 'dsap-input',
              value: draft.username,
              autoComplete: 'off',
              onChange: (event) => update({ username: event.target.value }),
            })),
            h(Field, { label: t('password'), hint: draft.passwordSet ? t('passwordSet') : undefined }, h('input', {
              style: inputStyle,
              className: 'dsap-input',
              type: 'password',
              value: draft.password,
              autoComplete: 'new-password',
              onChange: (event) => update({ password: event.target.value }),
            })),
          ),
          h(Toggle, {
            checked: draft.skipPrivateNetworks,
            label: t('skipPrivate'),
            onChange: (value) => update({ skipPrivateNetworks: value }),
          }),
        ),

        h(
          'div',
          { style: cardStyle },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 } },
            h(
              'div',
              null,
              h('div', { style: { fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } }, t('targets')),
              h('div', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)', marginTop: 3 } }, t('targetsHint')),
            ),
            h(
              'div',
              { style: { display: 'flex', gap: 8 } },
              h('button', {
                type: 'button',
                className: 'dsap-button',
                style: { ...buttonStyle, padding: '4px 10px', fontSize: 12 },
                onClick: () => update({ targets: endpoints.map((item) => item.id) }),
              }, t('selectAll')),
              h('button', {
                type: 'button',
                className: 'dsap-button',
                style: { ...buttonStyle, padding: '4px 10px', fontSize: 12 },
                onClick: () => update({ targets: [] }),
              }, t('clearAll')),
            ),
          ),
          endpoints.length === 0
            ? h('div', { style: { fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)' } }, t('targetsEmpty'))
            : h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                endpoints.map((endpoint) =>
                  h(
                    'label',
                    {
                      key: endpoint.id,
                      style: {
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '8px 10px',
                        borderRadius: 8,
                        border: '1px solid var(--dsw-alias-border-l1)',
                        background: 'var(--dsw-alias-bg-layer-2)',
                        cursor: 'pointer',
                      },
                    },
                    h('input', {
                      type: 'checkbox',
                      checked: draft.targets.includes(endpoint.id),
                      onChange: () => toggleTarget(endpoint.id),
                      style: { width: 15, height: 15, accentColor: 'var(--dsw-alias-brand-primary)' },
                    }),
                    h(
                      'div',
                      { style: { display: 'flex', flexDirection: 'column', minWidth: 0 } },
                      h(
                        'span',
                        { style: { fontSize: 12.5, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } },
                        endpoint.label,
                        endpoint.private === true
                          ? h('span', {
                              style: {
                                marginLeft: 8,
                                fontSize: 10.5,
                                padding: '1px 6px',
                                borderRadius: 999,
                                color: 'var(--dsw-alias-state-warn-primary)',
                                border: '1px solid var(--dsw-alias-state-warn-primary)',
                              },
                            }, t('privateTag'))
                          : null,
                      ),
                      h(
                        'span',
                        {
                          style: {
                            fontSize: 11.5,
                            color: 'var(--dsw-alias-label-secondary)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          },
                        },
                        endpoint.baseURL,
                      ),
                    ),
                  ),
                ),
              ),
          draft.enabled && draft.targets.length === 0
            ? h(
                'div',
                {
                  style: {
                    fontSize: 12,
                    color: 'var(--dsw-alias-state-warn-primary)',
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: '1px solid var(--dsw-alias-border-l1)',
                  },
                },
                t('noTargets'),
              )
            : null,
          h(Field, { label: t('extra') }, h('textarea', {
            style: { ...inputStyle, minHeight: 64, resize: 'vertical', fontFamily: 'ui-monospace, monospace' },
            className: 'dsap-input',
            value: draft.extraHosts.join('\n'),
            onChange: (event) => update({ extraHosts: event.target.value.split('\n') }),
          })),
        ),

        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
          h('button', {
            type: 'button',
            className: 'dsap-button dsap-primary',
            disabled: busy !== '',
            style: primaryButtonStyle,
            onClick: save,
          }, busy === 'save' ? t('saving') : t('save')),
          h('button', {
            type: 'button',
            className: 'dsap-button',
            disabled: busy !== '',
            style: buttonStyle,
            onClick: runTest,
          }, busy === 'test' ? t('testing') : t('test')),
          h('button', {
            type: 'button',
            className: 'dsap-button',
            disabled: busy !== '',
            style: buttonStyle,
            onClick: load,
          }, t('refresh')),
          notice === ''
            ? null
            : h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-state-success-primary)' } }, notice),
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
                  color: testResult.ok === true
                    ? 'var(--dsw-alias-state-success-primary)'
                    : 'var(--dsw-alias-state-error-primary)',
                  background: 'var(--dsw-alias-bg-layer-1)',
                },
              },
              testResult.ok === true
                ? t('testSuccess', { status: testResult.status, ms: testResult.ms, proxy: testResult.proxy })
                : t('testFailed', { error: `${testResult.error}${testResult.code ? ` (${testResult.code})` : ''}` }),
            ),

        error === ''
          ? null
          : h(
              'div',
              { style: { fontSize: 12.5, color: 'var(--dsw-alias-state-error-primary)' } },
              error,
            ),

        h(
          'div',
          {
            style: {
              fontSize: 11.5,
              lineHeight: 1.7,
              color: 'var(--dsw-alias-label-secondary)',
              borderTop: '1px solid var(--dsw-alias-border-l1)',
              paddingTop: 12,
            },
          },
          h('div', null, t('status', { state: settings.enabled ? t('statusOn') : t('statusOff') })),
          h('div', null, t('proxiedCount', { n: status.proxied ?? 0 })),
          status.lastError ? h('div', null, status.lastError) : null,
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
              id: 'api-proxy',
              order: 30,
              label: () => t('title'),
            },
            ProxySettingsPage,
          ),
        )
      },
    }
  },
})
