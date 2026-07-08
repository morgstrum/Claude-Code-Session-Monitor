import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { SessionStatus, SessionSummary, SortKey, TurnCost } from '@shared/types'
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

type DetailTab = 'overview' | 'cost' | 'advice' | 'tools' | 'commands' | 'agents'

interface Advice {
  title: string
  evidence: string
  tip: string
}

const EXPLORE_TOOLS = ['Read', 'Grep', 'Glob', 'LS']

function topEntries(rec: Record<string, number>, min: number, n: number): Array<[string, number]> {
  return Object.entries(rec)
    .filter(([, v]) => v >= min)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
}

function baseName(p: string): string {
  const parts = p.split('/')
  return parts[parts.length - 1] || p
}

function buildAdvice(s: SessionSummary): Advice[] {
  const ins = s.insights
  const eff = ins.efficiency
  const advice: Advice[] = []
  const toolCalls = countOf(s.tools)
  const exploreCalls = EXPLORE_TOOLS.reduce((a, t) => a + (s.tools[t] ?? 0), 0)

  if (eff.compactions > 0) {
    advice.push({
      title: 'Context overflowed — work likely too big for one session',
      evidence: `${eff.compactions} compaction${eff.compactions > 1 ? 's' : ''}: the context filled up and had to be summarized, losing detail.`,
      tip: 'Split the work into smaller sessions with a fresh context each. A compaction means every earlier token was paid for and then thrown away.'
    })
  }

  if (ins.turns.length >= 40) {
    const q = Math.floor(ins.turns.length / 4)
    const avg = (ts: typeof ins.turns): number => ts.reduce((a, t) => a + t.usd, 0) / ts.length
    const first = avg(ins.turns.slice(0, q))
    const last = avg(ins.turns.slice(-q))
    if (first > 0 && last / first > 2.5) {
      advice.push({
        title: 'Cost per turn grew steeply as the session aged',
        evidence: `Late turns average ${formatCost(last)} vs ${formatCost(first)} early — ${(last / first).toFixed(1)}× more, because every turn re-reads the grown context.`,
        tip: 'Long sessions pay compounding rent on their context. Finish or hand off to a fresh session once the immediate task is done.'
      })
    }
  }

  if (eff.firstEditSeen && s.costUsd > 5 && eff.costToFirstEditUsd / s.costUsd > 0.2) {
    advice.push({
      title: 'Large comprehension overhead before the first change',
      evidence: `${formatCost(eff.costToFirstEditUsd)} (${Math.round((eff.costToFirstEditUsd / s.costUsd) * 100)}% of session cost) and ${eff.turnsToFirstEdit} turns were spent before the first edit.`,
      tip: 'The agent bought understanding of the codebase with tokens. An architecture overview in CLAUDE.md, or pointing at the right files in the prompt, front-loads that knowledge for free.'
    })
  }

  if (toolCalls >= 30 && exploreCalls / toolCalls > 0.5) {
    advice.push({
      title: 'Session was dominated by exploration',
      evidence: `${Math.round((exploreCalls / toolCalls) * 100)}% of ${toolCalls} tool calls were Read/Grep/Glob/LS.`,
      tip: 'Heavy searching suggests structure or naming was hard to navigate. Consider a CLAUDE.md map of key modules, or delegate exploration to subagents so it doesn’t bloat the main context.'
    })
  }

  const reReads = topEntries(eff.fileReads, 4, 3)
  if (reReads.length > 0) {
    advice.push({
      title: 'Same files re-read repeatedly',
      evidence: reReads.map(([f, n]) => `${baseName(f)} ×${n}`).join(', '),
      tip: 'Files the agent keeps coming back to are prime CLAUDE.md material — summarize their role and invariants so re-reading (and re-paying) stops.'
    })
  }

  const churn = topEntries(eff.fileEdits, 6, 3)
  if (churn.length > 0) {
    advice.push({
      title: 'High edit churn on a few files',
      evidence: churn.map(([f, n]) => `${baseName(f)} edited ×${n}`).join(', '),
      tip: 'Many edits to one file can mean requirements arrived piecemeal or the approach thrashed. Fuller specs up front, or asking for a plan first, cuts rework loops.'
    })
  }

  if (eff.toolErrors >= 10 && toolCalls > 0 && eff.toolErrors / toolCalls > 0.08) {
    advice.push({
      title: 'Many failed tool calls',
      evidence: `${eff.toolErrors} tool errors (${Math.round((eff.toolErrors / toolCalls) * 100)}% of calls).`,
      tip: 'Each failure costs a full round trip. Common causes: missing build/test setup the agent had to discover, flaky commands, or permissions friction — document the working commands in CLAUDE.md.'
    })
  }

  if (ins.cacheRefreshCount > 0) {
    advice.push({
      title: 'Paid cold-cache restarts',
      evidence: `${ins.cacheRefreshCount} cache refresh${ins.cacheRefreshCount > 1 ? 'es' : ''} cost ≈${formatCost(ins.cacheRefreshUsd)} re-writing context after idle gaps.`,
      tip: 'Resume sessions while the ❄ hasn’t appeared, or wrap up before stepping away — an expired cache re-bills the whole context at the write premium.'
    })
  }

  if (eff.corrections >= 3) {
    advice.push({
      title: 'Several corrective replies',
      evidence: `${eff.corrections} of your messages read as corrections ("no…", "actually…", "that's not what I meant…").`,
      tip: 'Corrections mean paid work got discarded. Spending a minute on the initial prompt — constraints, examples, what NOT to do — is far cheaper than steering afterwards.'
    })
  }

  if (countOf(s.agents) === 0 && exploreCalls >= 60) {
    advice.push({
      title: 'No subagents despite heavy exploration',
      evidence: `${exploreCalls} exploration calls all ran in the main conversation, growing the context every turn pays to re-read.`,
      tip: 'Ask the agent to use subagents for searches and research — they explore in a disposable context and return only conclusions.'
    })
  }

  return advice
}

function buildAnalysisPrompt(s: SessionSummary): string {
  const ins = s.insights
  const eff = ins.efficiency
  const toolCalls = countOf(s.tools)
  const exploreCalls = EXPLORE_TOOLS.reduce((a, t) => a + (s.tools[t] ?? 0), 0)
  const reReads = topEntries(eff.fileReads, 3, 5)
    .map(([f, n]) => `${f} ×${n}`)
    .join(', ')
  const churn = topEntries(eff.fileEdits, 4, 5)
    .map(([f, n]) => `${f} ×${n}`)
    .join(', ')
  return `Review this finished Claude Code session for cost efficiency and effectiveness. Be direct and specific.

Transcript: ${s.filePath}
Working directory: ${s.cwd}

Measured stats:
- Total cost ${formatCost(s.costUsd)} over ${ins.apiTurns} LLM turns (${formatCost(ins.apiTurns > 0 ? s.costUsd / ins.apiTurns : 0)}/turn)
- Spend: cache reads ${formatCost(ins.costParts.cacheReadUsd)}, cache writes ${formatCost(ins.costParts.cacheWriteUsd)}, output ${formatCost(ins.costParts.outputUsd)}, uncached input ${formatCost(ins.costParts.inputUsd)}
- ${ins.cacheRefreshCount} cold-cache refreshes (≈${formatCost(ins.cacheRefreshUsd)}), ${eff.compactions} context compactions
- ${toolCalls} tool calls (${exploreCalls} exploration), ${eff.toolErrors} tool errors, cost before first edit ${formatCost(eff.costToFirstEditUsd)}
- Frequently re-read files: ${reReads || 'none'}
- High-churn files: ${churn || 'none'}
- ${eff.userTurns} user messages, ~${eff.corrections} corrections

Read the transcript (sample strategically if large — first prompt, corrections, error clusters, the most expensive stretches). Then answer:
1. Was the initial prompt well specified? Quote what was missing or ambiguous.
2. Should the work have been split into smaller sessions or delegated to subagents? Where exactly?
3. Did codebase structure or missing documentation force excess exploration? What specifically should go into CLAUDE.md?
4. Which failed or repeated work cost the most, and what setup change would prevent it?
5. Top 3 changes to how I prompt or structure work that would cut cost the most next time.`
}

function DetailAdvice({ s }: { s: SessionSummary }): React.JSX.Element {
  const advice = buildAdvice(s)
  const [copied, setCopied] = useState(false)
  return (
    <div className="detail detail-advice">
      <div className="detail-col-full">
        {advice.length === 0 ? (
          <div className="advice-clear">
            No inefficiency signals detected — this session looks lean.
          </div>
        ) : (
          advice.map((a) => (
            <div key={a.title} className="advice-item">
              <div className="advice-title">{a.title}</div>
              <div className="advice-evidence">{a.evidence}</div>
              <div className="advice-tip">{a.tip}</div>
            </div>
          ))
        )}
        <div className="advice-analyze">
          <button
            type="button"
            className="analyze-btn"
            onClick={() => {
              void navigator.clipboard.writeText(buildAnalysisPrompt(s))
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
          >
            {copied ? 'Copied ✓' : 'Copy analysis prompt'}
          </button>
          <span className="advice-analyze-hint">
            Paste into a fresh Claude Code session for a qualitative review of this session:
            prompt quality, chunking, and what to add to CLAUDE.md. The heuristics above count;
            Claude can judge.
          </span>
        </div>
      </div>
    </div>
  )
}

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

  const adviceCount = buildAdvice(s).length
  const tabs: Array<{ key: DetailTab; label: string }> = [
    { key: 'overview', label: 'Overview' },
    { key: 'cost', label: 'Cost' },
    { key: 'advice', label: adviceCount > 0 ? `Advice (${adviceCount})` : 'Advice' },
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
      {tab === 'advice' && <DetailAdvice s={s} />}
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

const CHART_W = 600
const CHART_H = 96

function TurnTimeline({
  turns,
  compactionsAt
}: {
  turns: TurnCost[]
  compactionsAt: number[]
}): React.JSX.Element | null {
  if (turns.length < 2) return null
  const maxUsd = Math.max(...turns.map((t) => t.usd), 0.000001)
  const total = turns.reduce((a, t) => a + t.usd, 0)
  const barW = CHART_W / turns.length

  // Cumulative spend as a 0..1 path over the same x axis
  let acc = 0
  const cumPoints = turns
    .map((t, i) => {
      acc += t.usd
      const x = (i + 0.5) * barW
      const y = CHART_H - (acc / total) * CHART_H
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  const timeLabel = (t: number | null): string =>
    t === null
      ? ''
      : new Date(t).toLocaleString(undefined, {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit'
        })

  return (
    <div className="turn-chart">
      <div className="turn-chart-head">
        <span>Cost per turn</span>
        <span className="turn-chart-max">max {formatCost(maxUsd)}/turn</span>
      </div>
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        preserveAspectRatio="none"
        className="turn-chart-svg"
      >
        {turns.map((t, i) => {
          const h = Math.max(1.5, (t.usd / maxUsd) * CHART_H)
          return (
            <rect
              key={i}
              className={t.refresh ? 'turn-bar turn-bar-refresh' : 'turn-bar'}
              x={i * barW}
              y={CHART_H - h}
              width={Math.max(barW - 0.4, 0.6)}
              height={h}
            >
              <title>
                {`Turn ${i + 1} — ${formatCost(t.usd)}${t.refresh ? ' (cache refresh)' : ''}${
                  t.t ? `\n${timeLabel(t.t)}` : ''
                }${t.writeUsd > 0.001 ? `\ncache write ${formatCost(t.writeUsd)}` : ''}`}
              </title>
            </rect>
          )
        })}
        {compactionsAt.map((ct, j) => {
          const idx = turns.findIndex((t) => t.t !== null && t.t >= ct)
          const x = (idx === -1 ? turns.length : idx) * barW
          return (
            <rect
              key={`c${j}`}
              className="turn-compaction"
              x={Math.max(0, x - 1)}
              y={0}
              width={2}
              height={CHART_H}
            >
              <title>{`Context compacted — window overflowed\n${timeLabel(ct)}`}</title>
            </rect>
          )
        })}
        <polyline className="turn-cumline" points={cumPoints} />
      </svg>
      <div className="turn-chart-axis">
        <span>{timeLabel(turns[0]?.t ?? null)}</span>
        <span className="turn-chart-legend">
          <span className="legend-swatch legend-bar" /> $/turn
          <span className="legend-swatch legend-refresh" /> cache refresh
          {compactionsAt.length > 0 && (
            <>
              <span className="legend-swatch legend-compaction" /> compaction
            </>
          )}
          <span className="legend-swatch legend-line" /> cumulative
        </span>
        <span>{timeLabel(turns[turns.length - 1]?.t ?? null)}</span>
      </div>
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
      <div className="detail-col detail-col-full">
        <TurnTimeline turns={ins.turns} compactionsAt={ins.compactionsAt} />
      </div>
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

          <dt>Compactions</dt>
          <dd>
            {ins.compactionsAt.length === 0
              ? 'none — context never overflowed'
              : `${ins.compactionsAt.length} — the context filled up and was summarized, losing detail (purple markers on the timeline)`}
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
