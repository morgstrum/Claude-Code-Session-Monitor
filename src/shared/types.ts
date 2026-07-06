export type SessionStatus = 'running' | 'completed' | 'interrupted' | 'error' | 'unknown'

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
  sessionsUpdated: 'sessions:updated'
} as const
