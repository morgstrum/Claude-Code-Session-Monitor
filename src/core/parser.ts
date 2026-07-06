/**
 * Typed view over Claude Code transcript JSONL records.
 *
 * The on-disk schema is not a stable API and varies across Claude Code
 * versions, so parsing is deliberately defensive: unknown record types are
 * passed through with just the common metadata, and all field access is
 * guarded. Verified against transcripts written by Claude Code 2.1.x.
 */
import type { TokenTotals } from '../shared/types'

export interface TranscriptRecord {
  type: string
  uuid: string | null
  parentUuid: string | null
  timestamp: number | null
  sessionId: string | null
  cwd: string | null
  gitBranch: string | null
  isSidechain: boolean
  /** assistant records only */
  model: string | null
  messageId: string | null
  requestId: string | null
  stopReason: string | null
  usage: TokenTotals | null
  /** user records only: true if the message carries real user text (not just tool_result blocks) */
  isUserText: boolean
  /** ai-title records */
  title: string | null
  /** true when message.content mentions a compact/summary boundary (best-effort) */
  isCompactBoundary: boolean
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

export function parseLine(line: string): TranscriptRecord | null {
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(line)
  } catch {
    return null
  }
  if (raw === null || typeof raw !== 'object' || typeof raw.type !== 'string') return null

  const message = (raw.message ?? null) as Record<string, unknown> | null
  const ts = str(raw.timestamp)
  const timestamp = ts ? Date.parse(ts) : NaN

  let usage: TokenTotals | null = null
  let model: string | null = null
  let messageId: string | null = null
  let stopReason: string | null = null
  if (raw.type === 'assistant' && message) {
    model = str(message.model)
    messageId = str(message.id)
    stopReason = str(message.stop_reason)
    const u = message.usage as Record<string, unknown> | undefined
    if (u && typeof u === 'object') {
      usage = {
        inputTokens: num(u.input_tokens),
        outputTokens: num(u.output_tokens),
        cacheCreationTokens: num(u.cache_creation_input_tokens),
        cacheReadTokens: num(u.cache_read_input_tokens)
      }
    }
  }

  let isUserText = false
  let isCompactBoundary = false
  if (raw.type === 'user' && message) {
    const content = message.content
    if (typeof content === 'string') {
      isUserText = content.trim().length > 0
      isCompactBoundary = content.includes('conversation was summarized')
    } else if (Array.isArray(content)) {
      isUserText = content.some(
        (b) => b && typeof b === 'object' && (b as { type?: string }).type === 'text'
      )
    }
    if ((raw as { isCompactSummary?: unknown }).isCompactSummary === true) {
      isCompactBoundary = true
    }
  }
  if (raw.type === 'system' && str((raw as { subtype?: unknown }).subtype) === 'compact_boundary') {
    isCompactBoundary = true
  }

  return {
    type: raw.type,
    uuid: str(raw.uuid),
    parentUuid: str(raw.parentUuid),
    timestamp: Number.isFinite(timestamp) ? timestamp : null,
    sessionId: str(raw.sessionId),
    cwd: str(raw.cwd),
    gitBranch: str(raw.gitBranch),
    isSidechain: raw.isSidechain === true,
    model,
    messageId,
    requestId: str(raw.requestId),
    stopReason,
    usage,
    isUserText,
    title: str((raw as { aiTitle?: unknown }).aiTitle),
    isCompactBoundary
  }
}
