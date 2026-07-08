import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { SessionStatus, SessionSummary, SortKey } from '@shared/types'
import { COMPACT_COUNT_CHOICES, loadSettings, saveSettings } from './settings'
import type { AppSettings, ThemeChoice } from './settings'

const STATUS_ORDER: Record<SessionStatus, number> = {
  running: 0,
  error: 1,
  interrupted: 2,
  completed: 3,
  unknown: 4
}

function projectName(s: SessionSummary): string {
  const parts = s.cwd.split('/')
  return parts[parts.length - 1] || s.cwd
}

function formatCost(usd: number): string {
  if (usd >= 100) return `$${usd.toFixed(0)}`
  if (usd >= 1) return `$${usd.toFixed(2)}`
  return `$${usd.toFixed(3)}`
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function formatAgo(ts: number | null, now: number): string {
  if (ts === null) return '—'
  const s = Math.max(0, Math.floor((now - ts) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m ago`
  return `${Math.floor(h / 24)}d ago`
}

function shortModel(model: string | null): string {
  if (!model) return '—'
  return model.replace(/^claude-/, '').replace(/-\d{8}$/, '')
}

/**
 * True once the session's prompt cache has expired: resuming it re-writes
 * the whole context at full input price instead of cheap cache reads.
 */
function isCacheCold(s: SessionSummary, now: number): boolean {
  if (s.status === 'running') return false
  if (s.lastActivityAt === null) return true
  return now - s.lastActivityAt > s.cacheTtlMs
}

function Snowflake({ small }: { small?: boolean }): React.JSX.Element {
  return (
    <span
      className={small ? 'snowflake snowflake-sm' : 'snowflake'}
      title="Prompt cache expired — resuming this session re-writes its context at full input cost"
    >
      ❄
    </span>
  )
}

export function App(): React.JSX.Element {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    window.sessionMonitor.getSessions().then((snap) => setSessions(snap.sessions))
    const unsub = window.sessionMonitor.onSessionsUpdated((snap) => setSessions(snap.sessions))
    const t = setInterval(() => setNow(Date.now()), 10_000)
    return () => {
      unsub()
      clearInterval(t)
    }
  }, [])

  // Apply persisted window state on first mount.
  // Always-on-top only ever applies to the compact view.
  useEffect(() => {
    window.sessionMonitor.setAlwaysOnTop(settings.viewMode === 'compact' && settings.alwaysOnTop)
    if (settings.viewMode === 'compact') window.sessionMonitor.setCompactMode(true)
    window.sessionMonitor.setTheme(settings.theme)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const update = (patch: Partial<AppSettings>): void => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      saveSettings(next)
      if (patch.viewMode !== undefined && patch.viewMode !== prev.viewMode) {
        window.sessionMonitor.setCompactMode(patch.viewMode === 'compact')
      }
      window.sessionMonitor.setAlwaysOnTop(next.viewMode === 'compact' && next.alwaysOnTop)
      if (patch.theme !== undefined) window.sessionMonitor.setTheme(next.theme)
      return next
    })
  }

  return settings.viewMode === 'compact' ? (
    <CompactView
      sessions={sessions}
      settings={settings}
      now={now}
      update={update}
      selectedId={selectedId}
      setSelectedId={setSelectedId}
    />
  ) : (
    <FullView
      sessions={sessions}
      settings={settings}
      now={now}
      update={update}
      selectedId={selectedId}
      setSelectedId={setSelectedId}
    />
  )
}

interface ViewProps {
  sessions: SessionSummary[]
  settings: AppSettings
  now: number
  update: (patch: Partial<AppSettings>) => void
  selectedId: string | null
  setSelectedId: (id: string | null) => void
}

interface OptionsMenuProps extends Pick<ViewProps, 'settings' | 'update'> {
  onOpenChange?: (open: boolean) => void
}

function OptionsMenu({ settings, update, onOpenChange }: OptionsMenuProps): React.JSX.Element {
  const [open, setOpenRaw] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const setOpen = (v: boolean | ((prev: boolean) => boolean)): void => {
    setOpenRaw((prev) => {
      const next = typeof v === 'function' ? v(prev) : v
      if (next !== prev) onOpenChange?.(next)
      return next
    })
  }

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <div className="options" ref={ref}>
      <button
        type="button"
        className="icon-btn"
        title="Options"
        aria-label="Options"
        onClick={() => setOpen((v) => !v)}
      >
        ⚙
      </button>
      {open && (
        <div className="options-menu">
          <label className="options-row">
            <span>Theme</span>
            <select
              value={settings.theme}
              onChange={(e) => update({ theme: e.target.value as ThemeChoice })}
            >
              <option value="auto">Auto</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <label className="options-row">
            <span>Sessions in compact view</span>
            <select
              value={settings.compactCount}
              onChange={(e) => update({ compactCount: Number(e.target.value) })}
            >
              {COMPACT_COUNT_CHOICES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="options-row">
            <span>Always on top (compact)</span>
            <input
              type="checkbox"
              checked={settings.alwaysOnTop}
              onChange={(e) => update({ alwaysOnTop: e.target.checked })}
            />
          </label>
        </div>
      )}
    </div>
  )
}

function CompactView({ sessions, settings, now, update, setSelectedId }: ViewProps): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  const visible = useMemo(() => {
    return [...sessions]
      .sort((a, b) => {
        const so = STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
        if (a.status === 'running' || b.status === 'running') {
          if (so !== 0) return so
        }
        return (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0)
      })
      .slice(0, settings.compactCount)
  }, [sessions, settings.compactCount])

  // Fit the window height to the rows actually shown (plus the options
  // menu while it is open, so it never renders clipped). Row heights are
  // summed individually: the list itself is flex-stretched to the window,
  // so its scrollHeight can never report less than the current height.
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const header = root.querySelector<HTMLElement>('.compact-header')
    let desired = header?.offsetHeight ?? 42
    for (const el of root.querySelectorAll<HTMLElement>('.compact-row, .compact-list .empty')) {
      desired += el.offsetHeight
    }
    const list = root.querySelector<HTMLElement>('.compact-list')
    if (list) {
      const cs = getComputedStyle(list)
      desired += (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0)
    }
    const menu = root.querySelector<HTMLElement>('.options-menu')
    if (menu) desired = Math.max(desired, menu.getBoundingClientRect().bottom + 10)
    window.sessionMonitor.setCompactHeight(Math.ceil(desired))
  }, [visible.length, menuOpen])

  const runningCount = sessions.filter((s) => s.status === 'running').length

  return (
    <div className="app compact" ref={rootRef}>
      <header className="compact-header">
        <span className={`compact-running${runningCount > 0 ? ' running-badge' : ''}`}>
          {runningCount} running
        </span>
        <div className="header-actions">
          <button
            type="button"
            className="icon-btn"
            title="Switch to full view"
            aria-label="Switch to full view"
            onClick={() => update({ viewMode: 'full' })}
          >
            ⤢
          </button>
          <OptionsMenu settings={settings} update={update} onOpenChange={setMenuOpen} />
        </div>
      </header>
      <div className="compact-list">
        {visible.map((s) => (
          <div
            key={s.sessionId}
            className="compact-row"
            title={s.title ?? undefined}
            onClick={() => {
              setSelectedId(s.sessionId)
              update({ viewMode: 'full' })
            }}
          >
            <div className="compact-status">
              {isCacheCold(s, now) ? (
                <Snowflake />
              ) : (
                <span className={`dot dot-${s.status}`} title={s.status} />
              )}
              <span className="compact-model" title={s.model ?? undefined}>
                {shortModel(s.model)}
              </span>
            </div>
            <div className="compact-main">
              <div className="compact-project">{projectName(s)}</div>
              <div className="compact-title">{s.title ?? formatAgo(s.lastActivityAt, now)}</div>
            </div>
            <div className="compact-cost">{formatCost(s.costUsd)}</div>
            <div className="compact-ctx-track">
              <div
                className={`compact-ctx-fill${s.contextFraction > 0.8 ? ' ctx-high' : ''}`}
                style={{ width: `${Math.round(s.contextFraction * 100)}%` }}
              />
            </div>
          </div>
        ))}
        {visible.length === 0 && <div className="empty">No sessions yet.</div>}
      </div>
    </div>
  )
}

function FullView({
  sessions,
  settings,
  now,
  update,
  selectedId,
  setSelectedId
}: ViewProps): React.JSX.Element {
  const [sortKey, setSortKey] = useState<SortKey>('lastActivityAt')
  const [sortAsc, setSortAsc] = useState(false)
  const [filter, setFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<SessionStatus | 'all'>('all')

  const selected = selectedId ? (sessions.find((s) => s.sessionId === selectedId) ?? null) : null

  useEffect(() => {
    if (!selectedId) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setSelectedId(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selectedId, setSelectedId])

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    const filtered = sessions.filter((s) => {
      if (statusFilter !== 'all' && s.status !== statusFilter) return false
      if (!needle) return true
      return (
        s.cwd.toLowerCase().includes(needle) ||
        (s.title ?? '').toLowerCase().includes(needle) ||
        (s.gitBranch ?? '').toLowerCase().includes(needle) ||
        (s.model ?? '').toLowerCase().includes(needle)
      )
    })
    const dir = sortAsc ? 1 : -1
    return filtered.sort((a, b) => {
      switch (sortKey) {
        case 'cwd':
          return dir * projectName(a).localeCompare(projectName(b))
        case 'status':
          return dir * (STATUS_ORDER[a.status] - STATUS_ORDER[b.status])
        case 'costUsd':
          return dir * (a.costUsd - b.costUsd)
        case 'contextFraction':
          return dir * (a.contextFraction - b.contextFraction)
        default:
          return dir * ((a.lastActivityAt ?? 0) - (b.lastActivityAt ?? 0))
      }
    })
  }, [sessions, sortKey, sortAsc, filter, statusFilter])

  const runningCount = sessions.filter((s) => s.status === 'running').length
  const totalCost = sessions.reduce((acc, s) => acc + s.costUsd, 0)

  const onSort = (key: SortKey): void => {
    if (key === sortKey) setSortAsc(!sortAsc)
    else {
      setSortKey(key)
      setSortAsc(key === 'cwd' || key === 'status')
    }
  }

  const arrow = (key: SortKey): string => (key === sortKey ? (sortAsc ? ' ▲' : ' ▼') : '')

  return (
    <div className="app">
      <header>
        <h1>Claude Code Sessions</h1>
        <div className="summary">
          <span className={runningCount > 0 ? 'running-badge' : ''}>{runningCount} running</span>
          <span>{sessions.length} sessions</span>
          <span>{formatCost(totalCost)} total</span>
          <div className="header-actions">
            <button
              type="button"
              className="icon-btn"
              title="Switch to compact view"
              aria-label="Switch to compact view"
              onClick={() => update({ viewMode: 'compact' })}
            >
              ⤡
            </button>
            <OptionsMenu settings={settings} update={update} />
          </div>
        </div>
        <div className="controls">
          <input
            type="search"
            placeholder="Filter by project, title, branch, model…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as SessionStatus | 'all')}
          >
            <option value="all">All statuses</option>
            <option value="running">Running</option>
            <option value="completed">Completed</option>
            <option value="interrupted">Interrupted</option>
            <option value="error">Error</option>
            <option value="unknown">Unknown</option>
          </select>
        </div>
      </header>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th onClick={() => onSort('cwd')}>Project{arrow('cwd')}</th>
              <th>Title</th>
              <th onClick={() => onSort('status')}>Status{arrow('status')}</th>
              <th>Model</th>
              <th className="num" onClick={() => onSort('costUsd')}>
                Cost{arrow('costUsd')}
              </th>
              <th className="num" onClick={() => onSort('contextFraction')}>
                Context{arrow('contextFraction')}
              </th>
              <th className="num">Tokens</th>
              <th className="num">Msgs</th>
              <th onClick={() => onSort('lastActivityAt')}>
                Last activity{arrow('lastActivityAt')}
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((s) => (
              <Fragment key={s.sessionId}>
              <tr
                className={s.sessionId === selectedId ? 'selected' : undefined}
                onClick={() => setSelectedId(s.sessionId === selectedId ? null : s.sessionId)}
              >
                <td>
                  <div className="project">{projectName(s)}</div>
                  {s.gitBranch && <div className="branch">{s.gitBranch}</div>}
                </td>
                <td className="title" title={s.title ?? undefined}>
                  {s.title ?? '—'}
                </td>
                <td>
                  <span className={`status status-${s.status}`}>{s.status}</span>
                  {isCacheCold(s, now) && <Snowflake small />}
                </td>
                <td className="model">{shortModel(s.model)}</td>
                <td className="num cost">{formatCost(s.costUsd)}</td>
                <td className="num">
                  <div className="ctx">
                    <div className="ctx-bar">
                      <div
                        className={`ctx-fill${s.contextFraction > 0.8 ? ' ctx-high' : ''}`}
                        style={{ width: `${Math.round(s.contextFraction * 100)}%` }}
                      />
                    </div>
                    <span>{Math.round(s.contextFraction * 100)}%</span>
                  </div>
                </td>
                <td className="num tokens">
                  {formatTokens(
                    s.totals.inputTokens +
                      s.totals.outputTokens +
                      s.totals.cacheCreationTokens +
                      s.totals.cacheReadTokens
                  )}
                </td>
                <td className="num">{s.messageCount}</td>
                <td className="ago">{formatAgo(s.lastActivityAt, now)}</td>
              </tr>
              {s.sessionId === selectedId && selected && (
                <tr className="detail-row">
                  <td colSpan={9}>
                    <SessionDetail key={selected.sessionId} s={selected} now={now} />
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={9} className="empty">
                  No sessions match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function formatDuration(startedAt: number | null, lastActivityAt: number | null): string {
  if (startedAt === null || lastActivityAt === null) return '—'
  const mins = Math.max(0, Math.round((lastActivityAt - startedAt) / 60_000))
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  if (h < 48) return `${h}h ${mins % 60}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

function formatWhen(ts: number | null): string {
  if (ts === null) return '—'
  return new Date(ts).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function CopyText({ value }: { value: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <span className="copy-text">
      <span className="mono" title={value}>
        {value}
      </span>
      <button
        type="button"
        className="copy-btn"
        title="Copy"
        aria-label={`Copy ${value}`}
        onClick={() => {
          void navigator.clipboard.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        }}
      >
        {copied ? '✓' : '⧉'}
      </button>
    </span>
  )
}

interface DetailProps {
  s: SessionSummary
  now: number
}

type DetailTab = 'overview' | 'cost' | 'tools' | 'commands' | 'agents'

function countOf(rec: Record<string, number>): number {
  return Object.values(rec).reduce((a, n) => a + n, 0)
}

function CountList({
  counts,
  emptyLabel,
  format
}: {
  counts: Record<string, number>
  emptyLabel: string
  format?: (n: number) => string
}): React.JSX.Element {
  const entries = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  if (entries.length === 0) return <div className="count-empty">{emptyLabel}</div>
  const max = entries[0]?.[1] ?? 1
  const fmt = format ?? String
  return (
    <div className="count-list">
      {entries.map(([name, n]) => (
        <div key={name} className="count-row">
          <span className="count-name" title={name}>
            {name}
          </span>
          <span className="count-bar">
            <span className="count-fill" style={{ width: `${Math.max(4, (n / max) * 100)}%` }} />
          </span>
          <span className="count-n">{fmt(n)}</span>
        </div>
      ))}
    </div>
  )
}

function SessionDetail({ s, now }: DetailProps): React.JSX.Element {
  const [tab, setTab] = useState<DetailTab>('overview')

  const tabs: Array<{ key: DetailTab; label: string }> = [
    { key: 'overview', label: 'Overview' },
    { key: 'cost', label: 'Cost' },
    { key: 'tools', label: `Tools (${countOf(s.tools)})` },
    { key: 'commands', label: `Commands (${countOf(s.commands)})` },
    { key: 'agents', label: `Agents (${countOf(s.agents)})` }
  ]

  return (
    <div className="detail-wrap" onClick={(e) => e.stopPropagation()}>
      <div className="detail-tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`detail-tab${tab === t.key ? ' active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'overview' && <DetailOverview s={s} now={now} />}
      {tab === 'cost' && <DetailCost s={s} />}
      {tab === 'tools' && (
        <div className="detail-pane">
          <CountList counts={s.tools} emptyLabel="No tool calls recorded." />
        </div>
      )}
      {tab === 'commands' && (
        <div className="detail-pane">
          <CountList counts={s.commands} emptyLabel="No slash commands recorded." />
        </div>
      )}
      {tab === 'agents' && (
        <div className="detail-pane">
          <CountList counts={s.agents} emptyLabel="No agents spawned." />
        </div>
      )}
    </div>
  )
}

function DetailCost({ s }: { s: SessionSummary }): React.JSX.Element {
  const ins = s.insights
  const totalUsd =
    ins.costParts.inputUsd +
    ins.costParts.outputUsd +
    ins.costParts.cacheWriteUsd +
    ins.costParts.cacheReadUsd

  const pct = (v: number): string => (totalUsd > 0 ? ` (${Math.round((v / totalUsd) * 100)}%)` : '')
  const spend: Record<string, number> = {
    [`Cache reads — context re-read each turn${pct(ins.costParts.cacheReadUsd)}`]:
      ins.costParts.cacheReadUsd,
    [`Cache writes — new/refreshed context${pct(ins.costParts.cacheWriteUsd)}`]:
      ins.costParts.cacheWriteUsd,
    [`Output — generated text & tool calls${pct(ins.costParts.outputUsd)}`]:
      ins.costParts.outputUsd,
    [`Input — uncached prompt tokens${pct(ins.costParts.inputUsd)}`]: ins.costParts.inputUsd
  }

  // ~4 chars per token turns raw content sizes into a rough token estimate
  const est = (chars: number): number => Math.round(chars / 4)
  const composition: Record<string, number> = {
    'Agent output': est(ins.composition.assistantChars),
    // User turns also carry harness-injected context (system reminders etc.)
    'User turns (incl. injected context)': est(ins.composition.userChars),
    'Hooks & attachments': est(ins.composition.attachmentChars)
  }
  for (const [tool, chars] of Object.entries(ins.composition.toolChars)) {
    composition[`${tool} output`] = est(chars)
  }

  const avgContext =
    ins.apiTurns > 0
      ? (s.totals.inputTokens + s.totals.cacheReadTokens + s.totals.cacheCreationTokens) /
        ins.apiTurns
      : 0

  return (
    <div className="detail">
      <div className="detail-col detail-col-wide">
        <h3 className="detail-section">Spend by token type</h3>
        <CountList counts={spend} emptyLabel="No usage recorded." format={formatCost} />

        <h3 className="detail-section">Why</h3>
        <dl className="detail-grid detail-grid-wide">
          <dt>LLM round trips</dt>
          <dd>
            {ins.apiTurns} turns · {formatCost(ins.apiTurns > 0 ? s.costUsd / ins.apiTurns : 0)}
            /turn — every turn re-reads the whole context
          </dd>

          <dt>Avg context/turn</dt>
          <dd>{formatTokens(Math.round(avgContext))} tokens</dd>

          <dt>Cache refreshes</dt>
          <dd>
            {ins.cacheRefreshCount === 0 ? (
              'none — no cold-cache re-writes detected'
            ) : (
              <>
                {ins.cacheRefreshCount} × <Snowflake small /> cost ≈
                {formatCost(ins.cacheRefreshUsd)} re-writing context after the cache expired
              </>
            )}
          </dd>
        </dl>
      </div>

      <div className="detail-col detail-col-wide">
        <h3 className="detail-section">What fills the context (est. tokens)</h3>
        <CountList
          counts={composition}
          emptyLabel="No content recorded."
          format={(n) => formatTokens(n)}
        />
        <div className="detail-note">
          Estimated from transcript content sizes (~4 chars/token). System prompt and file reads
          into context are included in the totals above but not itemized here.
        </div>
      </div>
    </div>
  )
}

function DetailOverview({ s, now }: DetailProps): React.JSX.Element {
  const total =
    s.totals.inputTokens +
    s.totals.outputTokens +
    s.totals.cacheCreationTokens +
    s.totals.cacheReadTokens
  const contextWindow =
    s.contextFraction > 0 ? Math.round(s.contextTokens / s.contextFraction) : null

  return (
    <div className="detail">
      <div className="detail-col">
        <h3 className="detail-section">Activity</h3>
        <dl className="detail-grid">
          <dt>Started</dt>
          <dd>{formatWhen(s.startedAt)}</dd>

          <dt>Last activity</dt>
          <dd>
            {formatWhen(s.lastActivityAt)} ({formatAgo(s.lastActivityAt, now)})
          </dd>

          <dt>Duration</dt>
          <dd>{formatDuration(s.startedAt, s.lastActivityAt)}</dd>

          <dt>Messages</dt>
          <dd>{s.messageCount}</dd>

          <dt>Context</dt>
          <dd>
            {formatTokens(s.contextTokens)}
            {contextWindow ? ` of ${formatTokens(contextWindow)}` : ''} (
            {Math.round(s.contextFraction * 100)}%)
          </dd>

          <dt>Cache</dt>
          <dd>
            {isCacheCold(s, now) ? (
              <>
                <Snowflake small /> cold — resuming re-writes context
              </>
            ) : s.status === 'running' ? (
              'warm'
            ) : (
              `warm — expires in ${Math.max(1, Math.ceil((s.cacheTtlMs - (now - (s.lastActivityAt ?? now))) / 60_000))}m`
            )}
          </dd>
        </dl>
      </div>

      <div className="detail-col">
        <h3 className="detail-section">Tokens</h3>
        <dl className="detail-grid">
          <dt>Input</dt>
          <dd>{formatTokens(s.totals.inputTokens)}</dd>
          <dt>Output</dt>
          <dd>{formatTokens(s.totals.outputTokens)}</dd>
          <dt>Cache write</dt>
          <dd>{formatTokens(s.totals.cacheCreationTokens)}</dd>
          <dt>Cache read</dt>
          <dd>{formatTokens(s.totals.cacheReadTokens)}</dd>
          <dt>Total</dt>
          <dd>{formatTokens(total)}</dd>
        </dl>
      </div>

      <div className="detail-col detail-col-wide">
        <h3 className="detail-section">Session</h3>
        <dl className="detail-grid">
          <dt>Directory</dt>
          <dd>
            <CopyText value={s.cwd} />
          </dd>

          <dt>Session ID</dt>
          <dd>
            <CopyText value={s.sessionId} />
          </dd>

          <dt>Transcript</dt>
          <dd>{s.filePath ? <CopyText value={s.filePath} /> : '—'}</dd>

          <dt>Model</dt>
          <dd>{shortModel(s.model)}</dd>
        </dl>
      </div>
    </div>
  )
}
