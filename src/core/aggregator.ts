import { emptyInsights } from '../shared/types'
import type { SessionInsights, SessionStatus, SessionSummary, TokenTotals } from '../shared/types'
import type { TranscriptRecord } from './parser'
import { contextWindowFor, usageCostParts } from './pricing'

/** A session with activity newer than this is considered running */
const ACTIVE_WINDOW_MS = 2 * 60 * 1000

type LastEvent = 'assistant-done' | 'assistant-partial' | 'assistant-error' | 'user' | 'none'

interface SessionState {
  sessionId: string
  projectDir: string
  filePath: string
  cwd: string | null
  gitBranch: string | null
  model: string | null
  startedAt: number | null
  lastActivityAt: number | null
  messageCount: number
  totals: TokenTotals
  contextTokens: number
  costUsd: number
  title: string | null
  tools: Record<string, number>
  commands: Record<string, number>
  agents: Record<string, number>
  cacheTtlMs: number
  insights: SessionInsights
  /** timestamp of the last counted main-conversation turn (cache-refresh detection) */
  lastTurnAt: number | null
  /** tool_use ids already counted, mapped to tool name for tool_result attribution */
  seenToolUseIds: Map<string, string>
  lastEvent: LastEvent
  /** message.ids whose usage has been counted (one API response can span several records) */
  seenMessageIds: Set<string>
}

/** A cold-cache re-write smaller than this is just ordinary context growth */
const REFRESH_MIN_TOKENS = 10_000

export interface FileOrigin {
  sessionId: string
  projectDir: string
  filePath: string
  /** subagent transcripts contribute cost/tokens but not messages/context/status */
  isSubagent: boolean
}

/**
 * Derive which session a transcript file belongs to from its path.
 * Top-level:  <projects>/<projectDir>/<session-uuid>.jsonl
 * Subagents:  <projects>/<projectDir>/<session-uuid>/subagents/agent-*.jsonl
 */
export function originForFile(projectsRoot: string, filePath: string): FileOrigin | null {
  if (!filePath.startsWith(projectsRoot) || !filePath.endsWith('.jsonl')) return null
  const rel = filePath.slice(projectsRoot.length).replace(/^\/+/, '')
  const parts = rel.split('/')
  if (parts.length === 2 && parts[0] && parts[1]) {
    return {
      sessionId: parts[1].replace(/\.jsonl$/, ''),
      projectDir: parts[0],
      filePath,
      isSubagent: false
    }
  }
  if (parts.length === 4 && parts[0] && parts[1] && parts[2] === 'subagents') {
    return { sessionId: parts[1], projectDir: parts[0], filePath, isSubagent: true }
  }
  return null
}

export class SessionAggregator {
  private sessions = new Map<string, SessionState>()
  /**
   * Rows seeded from the DB for sessions whose transcripts may have been purged.
   * Kept apart from live parse state: if any transcript data arrives for a
   * session, the freshly parsed numbers fully shadow the stored row — merging
   * the two would double-count usage on every restart.
   */
  private restored = new Map<string, SessionSummary>()

  restore(summary: SessionSummary): void {
    this.restored.set(summary.sessionId, {
      ...summary,
      totals: { ...summary.totals },
      tools: { ...summary.tools },
      commands: { ...summary.commands },
      agents: { ...summary.agents },
      insights: {
        ...summary.insights,
        costParts: { ...summary.insights.costParts },
        composition: {
          ...summary.insights.composition,
          toolChars: { ...summary.insights.composition.toolChars }
        }
      },
      // A session can't still be running if all we have is its stored row
      status: summary.status === 'running' ? 'interrupted' : summary.status
    })
  }

  apply(origin: FileOrigin, record: TranscriptRecord): void {
    const s = this.getOrCreate(origin)

    if (record.timestamp !== null) {
      if (s.startedAt === null || record.timestamp < s.startedAt) s.startedAt = record.timestamp
      if (s.lastActivityAt === null || record.timestamp > s.lastActivityAt) {
        s.lastActivityAt = record.timestamp
      }
    }

    // Usage/cost counts for both main and subagent transcripts
    if (record.type === 'assistant' && record.usage) {
      const dedupeKey = record.messageId ?? record.uuid ?? Math.random().toString(36)
      if (!s.seenMessageIds.has(dedupeKey)) {
        s.seenMessageIds.add(dedupeKey)
        s.totals.inputTokens += record.usage.inputTokens
        s.totals.outputTokens += record.usage.outputTokens
        s.totals.cacheCreationTokens += record.usage.cacheCreationTokens
        s.totals.cacheReadTokens += record.usage.cacheReadTokens
        const parts = usageCostParts(record.model, record.usage)
        s.insights.costParts.inputUsd += parts.inputUsd
        s.insights.costParts.outputUsd += parts.outputUsd
        s.insights.costParts.cacheWriteUsd += parts.cacheWriteUsd
        s.insights.costParts.cacheReadUsd += parts.cacheReadUsd
        s.costUsd += parts.inputUsd + parts.outputUsd + parts.cacheWriteUsd + parts.cacheReadUsd

        if (!origin.isSubagent) {
          s.insights.apiTurns += 1
          // A large cache write after the TTL lapsed = the cold-cache tax:
          // the context had to be re-written at the cache-write premium.
          if (
            s.lastTurnAt !== null &&
            record.timestamp !== null &&
            record.timestamp - s.lastTurnAt > s.cacheTtlMs &&
            record.usage.cacheCreationTokens > REFRESH_MIN_TOKENS
          ) {
            s.insights.cacheRefreshCount += 1
            s.insights.cacheRefreshUsd += parts.cacheWriteUsd
          }
          if (record.timestamp !== null) s.lastTurnAt = record.timestamp
        }
      }
    }

    if (origin.isSubagent) return

    // Everything below reflects the main conversation only
    if (record.cwd) s.cwd = record.cwd
    if (record.gitBranch) s.gitBranch = record.gitBranch
    if (record.title) s.title = record.title

    if (record.type === 'assistant') {
      if (record.model && record.model !== '<synthetic>') s.model = record.model
      if (record.cacheTtl) s.cacheTtlMs = record.cacheTtl === '1h' ? 3_600_000 : 300_000
      if (record.usage) {
        // Context at the latest turn: everything the model just saw plus what it wrote
        s.contextTokens =
          record.usage.inputTokens +
          record.usage.cacheReadTokens +
          record.usage.cacheCreationTokens +
          record.usage.outputTokens
      }
      for (const tu of record.toolUses) {
        const key = tu.id ?? `${record.uuid ?? 'rec'}:${tu.name}`
        if (s.seenToolUseIds.has(key)) continue
        s.seenToolUseIds.set(key, tu.name)
        s.tools[tu.name] = (s.tools[tu.name] ?? 0) + 1
        if (tu.subagentType) s.agents[tu.subagentType] = (s.agents[tu.subagentType] ?? 0) + 1
      }
      s.insights.composition.assistantChars += record.assistantTextChars
      s.messageCount += 1
      if (record.stopReason === 'refusal') s.lastEvent = 'assistant-error'
      else if (record.stopReason === 'end_turn' || record.stopReason === 'stop_sequence') {
        s.lastEvent = 'assistant-done'
      } else s.lastEvent = 'assistant-partial'
    } else if (record.type === 'user') {
      if (record.isUserText) s.messageCount += 1
      s.lastEvent = 'user'
      if (record.isCompactBoundary) s.contextTokens = 0
      if (record.commandName) {
        s.commands[record.commandName] = (s.commands[record.commandName] ?? 0) + 1
      }
      if (record.toolResults.length > 0) {
        for (const tr of record.toolResults) {
          const tool = (tr.toolUseId && s.seenToolUseIds.get(tr.toolUseId)) || 'other'
          s.insights.composition.toolChars[tool] =
            (s.insights.composition.toolChars[tool] ?? 0) + tr.chars
        }
      } else {
        s.insights.composition.userChars += record.userTextChars
      }
    } else if (record.type === 'attachment') {
      s.insights.composition.attachmentChars += record.attachmentChars
    }
  }

  snapshot(now: number = Date.now()): SessionSummary[] {
    const storedOnly = [...this.restored.values()].filter((r) => !this.sessions.has(r.sessionId))
    return storedOnly.concat(this.live(now))
  }

  private live(now: number): SessionSummary[] {
    return [...this.sessions.values()].map((s) => {
      const window = contextWindowFor(s.model)
      return {
        sessionId: s.sessionId,
        cwd: s.cwd ?? s.projectDir,
        projectDir: s.projectDir,
        filePath: s.filePath,
        gitBranch: s.gitBranch,
        model: s.model,
        status: statusOf(s, now),
        startedAt: s.startedAt,
        lastActivityAt: s.lastActivityAt,
        messageCount: s.messageCount,
        totals: { ...s.totals },
        contextTokens: s.contextTokens,
        contextFraction: window > 0 ? Math.min(1, s.contextTokens / window) : 0,
        costUsd: s.costUsd,
        title: s.title,
        tools: { ...s.tools },
        commands: { ...s.commands },
        agents: { ...s.agents },
        cacheTtlMs: s.cacheTtlMs,
        insights: {
          costParts: { ...s.insights.costParts },
          apiTurns: s.insights.apiTurns,
          cacheRefreshCount: s.insights.cacheRefreshCount,
          cacheRefreshUsd: s.insights.cacheRefreshUsd,
          composition: {
            ...s.insights.composition,
            toolChars: { ...s.insights.composition.toolChars }
          }
        }
      }
    })
  }

  private getOrCreate(origin: FileOrigin): SessionState {
    let s = this.sessions.get(origin.sessionId)
    if (!s) {
      s = {
        sessionId: origin.sessionId,
        projectDir: origin.projectDir,
        filePath: origin.isSubagent ? '' : origin.filePath,
        cwd: null,
        gitBranch: null,
        model: null,
        startedAt: null,
        lastActivityAt: null,
        messageCount: 0,
        totals: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
        contextTokens: 0,
        costUsd: 0,
        title: null,
        tools: {},
        commands: {},
        agents: {},
        cacheTtlMs: 300_000,
        insights: emptyInsights(),
        lastTurnAt: null,
        seenToolUseIds: new Map(),
        lastEvent: 'none',
        seenMessageIds: new Set()
      }
      this.sessions.set(origin.sessionId, s)
    }
    if (!origin.isSubagent && !s.filePath) s.filePath = origin.filePath
    return s
  }
}

function statusOf(s: SessionState, now: number): SessionStatus {
  if (s.lastActivityAt === null) return 'unknown'
  const active = now - s.lastActivityAt < ACTIVE_WINDOW_MS
  switch (s.lastEvent) {
    case 'assistant-error':
      return 'error'
    case 'assistant-done':
      return active ? 'running' : 'completed'
    case 'assistant-partial':
    case 'user':
      // Waiting on a response: live if recent, otherwise the session was cut off
      return active ? 'running' : 'interrupted'
    default:
      return active ? 'running' : 'unknown'
  }
}
