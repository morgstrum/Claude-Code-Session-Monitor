import { useEffect, useMemo, useState } from 'react'
import type { SessionStatus, SessionSummary, SortKey } from '@shared/types'

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

export function App(): React.JSX.Element {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [sortKey, setSortKey] = useState<SortKey>('lastActivityAt')
  const [sortAsc, setSortAsc] = useState(false)
  const [filter, setFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<SessionStatus | 'all'>('all')
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    let unsub: (() => void) | undefined
    window.sessionMonitor.getSessions().then((snap) => setSessions(snap.sessions))
    unsub = window.sessionMonitor.onSessionsUpdated((snap) => setSessions(snap.sessions))
    const t = setInterval(() => setNow(Date.now()), 10_000)
    return () => {
      unsub?.()
      clearInterval(t)
    }
  }, [])

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
          <span className={runningCount > 0 ? 'running-badge' : ''}>
            {runningCount} running
          </span>
          <span>{sessions.length} sessions</span>
          <span>{formatCost(totalCost)} total</span>
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
              <tr key={s.sessionId}>
                <td>
                  <div className="project">{projectName(s)}</div>
                  {s.gitBranch && <div className="branch">{s.gitBranch}</div>}
                </td>
                <td className="title" title={s.title ?? undefined}>
                  {s.title ?? '—'}
                </td>
                <td>
                  <span className={`status status-${s.status}`}>{s.status}</span>
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
