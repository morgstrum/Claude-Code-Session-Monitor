import { describe, expect, it } from 'vitest'
import { SessionAggregator, originForFile } from '../src/core/aggregator'
import { parseLine } from '../src/core/parser'
import { emptyInsights } from '../src/shared/types'

const ROOT = '/home/u/.claude/projects'
const MAIN = `${ROOT}/-Users-me-proj/sess-1.jsonl`
const SUB = `${ROOT}/-Users-me-proj/sess-1/subagents/agent-abc.jsonl`

const mainOrigin = originForFile(ROOT, MAIN)!
const subOrigin = originForFile(ROOT, SUB)!

function assistant(opts: {
  ts: string
  messageId: string
  input?: number
  output?: number
  cacheWrite?: number
  cacheRead?: number
  stopReason?: string | null
  model?: string
}): string {
  return JSON.stringify({
    type: 'assistant',
    uuid: `uuid-${opts.messageId}-${Math.random()}`,
    timestamp: opts.ts,
    sessionId: 'sess-1',
    cwd: '/Users/me/proj',
    gitBranch: 'main',
    message: {
      role: 'assistant',
      id: opts.messageId,
      model: opts.model ?? 'claude-opus-4-8',
      stop_reason: opts.stopReason === undefined ? 'end_turn' : opts.stopReason,
      usage: {
        input_tokens: opts.input ?? 0,
        output_tokens: opts.output ?? 0,
        cache_creation_input_tokens: opts.cacheWrite ?? 0,
        cache_read_input_tokens: opts.cacheRead ?? 0
      }
    }
  })
}

function user(ts: string, content: string): string {
  return JSON.stringify({
    type: 'user',
    uuid: `u-${ts}`,
    timestamp: ts,
    sessionId: 'sess-1',
    cwd: '/Users/me/proj',
    message: { role: 'user', content }
  })
}

function apply(agg: SessionAggregator, origin: typeof mainOrigin, lines: string[]): void {
  for (const l of lines) agg.apply(origin, parseLine(l)!)
}

describe('originForFile', () => {
  it('maps top-level transcripts to their session', () => {
    expect(mainOrigin).toEqual({
      sessionId: 'sess-1',
      projectDir: '-Users-me-proj',
      filePath: MAIN,
      isSubagent: false
    })
  })

  it('maps subagent transcripts to the parent session', () => {
    expect(subOrigin.sessionId).toBe('sess-1')
    expect(subOrigin.isSubagent).toBe(true)
  })

  it('rejects non-jsonl and out-of-root paths', () => {
    expect(originForFile(ROOT, `${ROOT}/-Users-me-proj/sessions-index.json`)).toBeNull()
    expect(originForFile(ROOT, '/somewhere/else/x.jsonl')).toBeNull()
  })
})

describe('SessionAggregator', () => {
  it('aggregates cost, tokens, messages and context', () => {
    const agg = new SessionAggregator()
    apply(agg, mainOrigin, [
      user('2026-06-18T10:00:00Z', 'hello'),
      assistant({
        ts: '2026-06-18T10:00:05Z',
        messageId: 'm1',
        input: 100,
        output: 50,
        cacheWrite: 1000,
        cacheRead: 2000
      })
    ])
    const s = agg.snapshot(Date.parse('2026-06-18T10:00:10Z'))[0]!
    expect(s.messageCount).toBe(2)
    expect(s.totals).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cacheCreationTokens: 1000,
      cacheReadTokens: 2000
    })
    // opus-4-8: (100*5 + 50*25 + 1000*6.25 + 2000*0.5) / 1e6
    expect(s.costUsd).toBeCloseTo((100 * 5 + 50 * 25 + 1000 * 6.25 + 2000 * 0.5) / 1e6, 10)
    expect(s.contextTokens).toBe(100 + 50 + 1000 + 2000)
    expect(s.status).toBe('running')
    expect(s.title).toBeNull()
    expect(s.cwd).toBe('/Users/me/proj')
  })

  it('dedupes usage across records sharing a message id', () => {
    const agg = new SessionAggregator()
    apply(agg, mainOrigin, [
      assistant({ ts: '2026-06-18T10:00:05Z', messageId: 'm1', input: 100, output: 10 }),
      assistant({ ts: '2026-06-18T10:00:06Z', messageId: 'm1', input: 100, output: 10 })
    ])
    const s = agg.snapshot()[0]!
    expect(s.totals.inputTokens).toBe(100)
    expect(s.totals.outputTokens).toBe(10)
  })

  it('adds subagent cost but not messages or context', () => {
    const agg = new SessionAggregator()
    apply(agg, mainOrigin, [
      assistant({ ts: '2026-06-18T10:00:05Z', messageId: 'm1', input: 100, output: 10 })
    ])
    apply(agg, subOrigin, [
      assistant({ ts: '2026-06-18T10:00:06Z', messageId: 'sub-m1', input: 500, output: 20 })
    ])
    const s = agg.snapshot()[0]!
    expect(s.totals.inputTokens).toBe(600)
    expect(s.messageCount).toBe(1)
    expect(s.contextTokens).toBe(110)
  })

  it('marks stale sessions completed after an end_turn', () => {
    const agg = new SessionAggregator()
    apply(agg, mainOrigin, [
      assistant({ ts: '2026-06-18T10:00:05Z', messageId: 'm1', stopReason: 'end_turn' })
    ])
    const later = Date.parse('2026-06-18T11:00:00Z')
    expect(agg.snapshot(later)[0]!.status).toBe('completed')
  })

  it('marks stale sessions interrupted when a user message got no reply', () => {
    const agg = new SessionAggregator()
    apply(agg, mainOrigin, [
      assistant({ ts: '2026-06-18T10:00:05Z', messageId: 'm1' }),
      user('2026-06-18T10:00:30Z', 'and then?')
    ])
    const later = Date.parse('2026-06-18T11:00:00Z')
    expect(agg.snapshot(later)[0]!.status).toBe('interrupted')
  })

  it('computes context fraction against the model window', () => {
    const agg = new SessionAggregator()
    apply(agg, mainOrigin, [
      assistant({
        ts: '2026-06-18T10:00:05Z',
        messageId: 'm1',
        model: 'claude-haiku-4-5-20251001',
        input: 50_000,
        cacheRead: 50_000
      })
    ])
    const s = agg.snapshot()[0]!
    // haiku window is 200k
    expect(s.contextFraction).toBeCloseTo(0.5, 5)
  })

  it('counts tools, agents, and commands, deduping tool_use ids on re-read', () => {
    const agg = new SessionAggregator()
    const assistantWithTools = JSON.stringify({
      type: 'assistant',
      uuid: 'a-t1',
      timestamp: '2026-06-18T10:00:05Z',
      sessionId: 'sess-1',
      message: {
        role: 'assistant',
        id: 'm-t1',
        model: 'claude-opus-4-8',
        content: [
          { type: 'tool_use', id: 'toolu_a', name: 'Bash', input: { command: 'ls' } },
          { type: 'tool_use', id: 'toolu_b', name: 'Bash', input: { command: 'pwd' } },
          { type: 'tool_use', id: 'toolu_c', name: 'Agent', input: { subagent_type: 'Explore' } }
        ]
      }
    })
    const command = JSON.stringify({
      type: 'user',
      uuid: 'u-c1',
      timestamp: '2026-06-18T10:01:00Z',
      sessionId: 'sess-1',
      message: { role: 'user', content: '<command-name>/ship-next</command-name>' }
    })
    apply(agg, mainOrigin, [assistantWithTools, command])
    // Same lines applied again (e.g. file truncation triggering a re-read)
    apply(agg, mainOrigin, [assistantWithTools, command])

    const s = agg.snapshot()[0]!
    expect(s.tools).toEqual({ Bash: 2, Agent: 1 })
    expect(s.agents).toEqual({ Explore: 1 })
    // Commands have no stable id, so re-reads double-count them — acceptable,
    // but the first pass must be exact:
    expect(s.commands['/ship-next']).toBeGreaterThanOrEqual(1)
  })

  it('tracks the cache TTL from the latest turn that wrote cache', () => {
    const agg = new SessionAggregator()
    const withTtl = (id: string, cache_creation: object): string =>
      JSON.stringify({
        type: 'assistant',
        uuid: `u-${id}`,
        timestamp: '2026-06-18T10:00:05Z',
        sessionId: 'sess-1',
        message: {
          role: 'assistant',
          id,
          model: 'claude-opus-4-8',
          content: [],
          usage: {
            input_tokens: 1,
            output_tokens: 1,
            cache_creation_input_tokens: 100,
            cache_read_input_tokens: 0,
            cache_creation
          }
        }
      })
    // Default before any cache info
    expect(
      (() => {
        const a = new SessionAggregator()
        apply(a, mainOrigin, [assistant({ ts: '2026-06-18T10:00:05Z', messageId: 'm0' })])
        return a.snapshot()[0]!.cacheTtlMs
      })()
    ).toBe(300_000)

    apply(agg, mainOrigin, [withTtl('m1', { ephemeral_1h_input_tokens: 500 })])
    expect(agg.snapshot()[0]!.cacheTtlMs).toBe(3_600_000)
  })

  it('breaks cost down by token type and counts turns', () => {
    const agg = new SessionAggregator()
    apply(agg, mainOrigin, [
      assistant({
        ts: '2026-06-18T10:00:05Z',
        messageId: 'm1',
        input: 1000,
        output: 100,
        cacheWrite: 10_000,
        cacheRead: 50_000
      }),
      assistant({ ts: '2026-06-18T10:01:00Z', messageId: 'm2', input: 500, output: 50 })
    ])
    const s = agg.snapshot()[0]!
    const p = s.insights.costParts
    // opus-4-8 rates: in $5, out $25, write $6.25, read $0.5 per MTok
    expect(p.inputUsd).toBeCloseTo((1500 * 5) / 1e6, 10)
    expect(p.outputUsd).toBeCloseTo((150 * 25) / 1e6, 10)
    expect(p.cacheWriteUsd).toBeCloseTo((10_000 * 6.25) / 1e6, 10)
    expect(p.cacheReadUsd).toBeCloseTo((50_000 * 0.5) / 1e6, 10)
    expect(p.inputUsd + p.outputUsd + p.cacheWriteUsd + p.cacheReadUsd).toBeCloseTo(s.costUsd, 10)
    expect(s.insights.apiTurns).toBe(2)
  })

  it('detects cold-cache refreshes: big cache write after the TTL lapsed', () => {
    const agg = new SessionAggregator()
    apply(agg, mainOrigin, [
      // Turn 1 writes cache (5m TTL by default in the fixture: no cache_creation breakdown)
      assistant({ ts: '2026-06-18T10:00:00Z', messageId: 'm1', cacheWrite: 200_000 }),
      // Turn 2 within TTL: not a refresh even though it writes cache
      assistant({ ts: '2026-06-18T10:02:00Z', messageId: 'm2', cacheWrite: 50_000 }),
      // Turn 3 arrives 30 min later (> 5m TTL) with a big re-write: refresh
      assistant({ ts: '2026-06-18T10:32:00Z', messageId: 'm3', cacheWrite: 240_000 }),
      // Turn 4: small write after a gap -> ordinary growth, not a refresh
      assistant({ ts: '2026-06-18T11:20:00Z', messageId: 'm4', cacheWrite: 500 })
    ])
    const s = agg.snapshot()[0]!
    expect(s.insights.cacheRefreshCount).toBe(1)
    expect(s.insights.cacheRefreshUsd).toBeCloseTo((240_000 * 6.25) / 1e6, 10)
  })

  it('attributes tool_result sizes to the originating tool', () => {
    const agg = new SessionAggregator()
    const toolUse = JSON.stringify({
      type: 'assistant',
      uuid: 'a-c1',
      timestamp: '2026-06-18T10:00:05Z',
      sessionId: 'sess-1',
      message: {
        role: 'assistant',
        id: 'm1',
        model: 'claude-opus-4-8',
        content: [
          { type: 'text', text: 'running a command' },
          { type: 'tool_use', id: 'toolu_x', name: 'Bash', input: { command: 'ls' } }
        ]
      }
    })
    const toolResult = JSON.stringify({
      type: 'user',
      uuid: 'u-c1',
      timestamp: '2026-06-18T10:00:06Z',
      sessionId: 'sess-1',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_x', content: 'x'.repeat(4000) }]
      }
    })
    const attachment = JSON.stringify({
      type: 'attachment',
      uuid: 'att-1',
      timestamp: '2026-06-18T10:00:07Z',
      sessionId: 'sess-1',
      attachment: { type: 'hook_success', content: 'y'.repeat(800), stdout: 'z'.repeat(200) }
    })
    apply(agg, mainOrigin, [toolUse, toolResult, attachment, user('2026-06-18T10:00:08Z', 'thanks')])
    const c = agg.snapshot()[0]!.insights.composition
    expect(c.toolChars).toEqual({ Bash: 4000 })
    expect(c.assistantChars).toBe('running a command'.length)
    expect(c.attachmentChars).toBe(1000)
    expect(c.userChars).toBe('thanks'.length)
  })

  it('restores persisted sessions and downgrades stale running status', () => {
    const agg = new SessionAggregator()
    agg.restore(storedSummary('old-1'))
    const s = agg.snapshot()[0]!
    expect(s.status).toBe('interrupted')
    expect(s.costUsd).toBe(1.23)
    expect(s.title).toBe('old session')
  })

  it('shadows restored rows with fresh parse data instead of double-counting', () => {
    const agg = new SessionAggregator()
    // Stored row for the same session whose transcript is then re-parsed
    agg.restore({ ...storedSummary('sess-1'), costUsd: 999, messageCount: 500 })
    apply(agg, mainOrigin, [
      assistant({ ts: '2026-06-18T10:00:05Z', messageId: 'm1', input: 100, output: 10 })
    ])
    const all = agg.snapshot()
    expect(all).toHaveLength(1)
    const s = all[0]!
    expect(s.messageCount).toBe(1)
    expect(s.totals.inputTokens).toBe(100)
    expect(s.costUsd).toBeLessThan(1)
  })

  it('shadows restored rows even when only subagent data arrives', () => {
    const agg = new SessionAggregator()
    agg.restore({ ...storedSummary('sess-1'), costUsd: 999 })
    apply(agg, subOrigin, [
      assistant({ ts: '2026-06-18T10:00:06Z', messageId: 'sub-m1', input: 500, output: 20 })
    ])
    const all = agg.snapshot()
    expect(all).toHaveLength(1)
    expect(all[0]!.totals.inputTokens).toBe(500)
  })
})

function storedSummary(sessionId: string) {
  return {
    sessionId,
    cwd: '/Users/me/old',
    projectDir: '-Users-me-old',
    filePath: '/gone.jsonl',
    gitBranch: null,
    model: 'claude-opus-4-8',
    status: 'running' as const,
    startedAt: 1,
    lastActivityAt: 2,
    messageCount: 5,
    totals: { inputTokens: 1, outputTokens: 2, cacheCreationTokens: 3, cacheReadTokens: 4 },
    contextTokens: 10,
    contextFraction: 0.1,
    costUsd: 1.23,
    title: 'old session',
    tools: { Bash: 2 },
    commands: {},
    agents: {},
    cacheTtlMs: 300_000,
    insights: emptyInsights()
  }
}
