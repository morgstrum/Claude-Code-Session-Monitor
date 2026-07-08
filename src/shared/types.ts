export type SessionStatus = 'running' | 'completed' | 'interrupted' | 'error' | 'unknown'

export interface CostBreakdown {
  inputUsd: number
  outputUsd: number
  cacheWriteUsd: number
  cacheReadUsd: number
}

/** One LLM round trip in the main conversation */
export interface TurnCost {
  /** turn timestamp (ms), null when the record had none */
  t: number | null
  /** total $ for the turn */
  usd: number
  /** $ of cache writes within the turn (spikes = context growth or refresh) */
  writeUsd: number
  /** true when this turn re-wrote a large cache after the TTL lapsed */
  refresh: boolean
}

/** Efficiency signals used by the Advice tab */
export interface EfficiencySignals {
  /** tool results flagged is_error (failed commands, bad paths, …) */
  toolErrors: number
  /** context compaction events (context window overflowed) */
  compactions: number
  /** user messages that read as corrections — heuristic */
  corrections: number
  /** user text messages (interaction granularity) */
  userTurns: number
  /** spend and turns before the first Edit/Write — comprehension overhead */
  costToFirstEditUsd: number
  turnsToFirstEdit: number
  firstEditSeen: boolean
  /** Edit/Write counts per file — high counts = rework churn */
  fileEdits: Record<string, number>
  /** Read counts per file — high counts = missing docs/memory */
  fileReads: Record<string, number>
}

export function emptyEfficiency(): EfficiencySignals {
  return {
    toolErrors: 0,
    compactions: 0,
    corrections: 0,
    userTurns: 0,
    costToFirstEditUsd: 0,
    turnsToFirstEdit: 0,
    firstEditSeen: false,
    fileEdits: {},
    fileReads: {}
  }
}

/** Derived cost-driver metrics for one session */
export interface SessionInsights {
  costParts: CostBreakdown
  /** Deduped LLM round trips in the main conversation */
  apiTurns: number
  /** Per-turn cost timeline, in transcript order */
  turns: TurnCost[]
  /** timestamps (ms) of context compactions, for timeline markers */
  compactionsAt: number[]
  /** Turns that re-wrote a large cache after the TTL had lapsed */
  cacheRefreshCount: number
  /** Estimated $ spent on those cold-cache re-writes */
  cacheRefreshUsd: number
  /** Content sizes (chars) by source — divide by ~4 for a token estimate */
  composition: {
    assistantChars: number
    userChars: number
    attachmentChars: number
    toolChars: Record<string, number>
  }
  efficiency: EfficiencySignals
}

export function emptyInsights(): SessionInsights {
  return {
    costParts: { inputUsd: 0, outputUsd: 0, cacheWriteUsd: 0, cacheReadUsd: 0 },
    apiTurns: 0,
    turns: [],
    compactionsAt: [],
    cacheRefreshCount: 0,
    cacheRefreshUsd: 0,
    composition: { assistantChars: 0, userChars: 0, attachmentChars: 0, toolChars: {} },
    efficiency: emptyEfficiency()
  }
}

export interface TokenTotals {
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
}

export interface SessionSummary {
  sessionId: string
  /** Real working directory recorded in the transcript (e.g. /Users/me/proj) */
  cwd: string
  /** Encoded project directory name under ~/.claude/projects */
  projectDir: string
  /** Absolute path to the .jsonl transcript file */
  filePath: string
  gitBranch: string | null
  /** Most recent model seen in assistant messages */
  model: string | null
  status: SessionStatus
  startedAt: number | null
  lastActivityAt: number | null
  /** Count of user + assistant messages (excludes meta/tool-result records) */
  messageCount: number
  totals: TokenTotals
  /** Tokens currently in the context window (input + cache at last assistant turn since last compaction) */
  contextTokens: number
  /** contextTokens as a fraction of the model's context window, 0..1 */
  contextFraction: number
  costUsd: number
  /** Optional conversation summary (from summary records) */
  title: string | null
  /** Tool name -> invocation count (main conversation only) */
  tools: Record<string, number>
  /** Slash command name -> invocation count */
  commands: Record<string, number>
  /** Spawned agent type -> spawn count */
  agents: Record<string, number>
  /**
   * TTL of the session's prompt cache in ms (5m or 1h ephemeral, from the
   * last turn's usage). Cache is cold once now - lastActivityAt > cacheTtlMs,
   * meaning resuming the session re-writes the whole context at full price.
   */
  cacheTtlMs: number
  insights: SessionInsights
}

export type SortKey = 'lastActivityAt' | 'costUsd' | 'contextFraction' | 'cwd' | 'status'

export interface SessionsSnapshot {
  sessions: SessionSummary[]
  generatedAt: number
}

/** IPC channel names shared between main and renderer */
export const IPC = {
  /** renderer -> main: request full snapshot */
  getSessions: 'sessions:get',
  /** main -> renderer: push updated sessions (batched) */
  sessionsUpdated: 'sessions:updated',
  /** renderer -> main: switch between full and compact window layouts */
  setCompactMode: 'window:set-compact-mode',
  /** renderer -> main: toggle always-on-top */
  setAlwaysOnTop: 'window:set-always-on-top',
  /** renderer -> main: fit the compact window height to its content (px) */
  setCompactHeight: 'window:set-compact-height',
  /** renderer -> main: set light/dark/auto theme (drives nativeTheme.themeSource) */
  setTheme: 'window:set-theme'
} as const
