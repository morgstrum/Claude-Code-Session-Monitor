import { describe, expect, it } from 'vitest'
import { parseLine } from '../src/core/parser'

const assistantLine = JSON.stringify({
  type: 'assistant',
  uuid: 'rec-1',
  parentUuid: 'rec-0',
  timestamp: '2026-06-18T10:55:20.432Z',
  sessionId: 'sess-1',
  cwd: '/Users/me/proj',
  gitBranch: 'main',
  isSidechain: false,
  requestId: 'req_123',
  message: {
    role: 'assistant',
    model: 'claude-opus-4-8',
    id: 'msg_01ABC',
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: 'hi' }],
    usage: {
      input_tokens: 7009,
      output_tokens: 177,
      cache_creation_input_tokens: 4187,
      cache_read_input_tokens: 18846,
      service_tier: 'standard'
    }
  }
})

describe('parseLine', () => {
  it('parses assistant records with usage and model', () => {
    const r = parseLine(assistantLine)
    expect(r).not.toBeNull()
    expect(r!.type).toBe('assistant')
    expect(r!.sessionId).toBe('sess-1')
    expect(r!.model).toBe('claude-opus-4-8')
    expect(r!.messageId).toBe('msg_01ABC')
    expect(r!.stopReason).toBe('end_turn')
    expect(r!.usage).toEqual({
      inputTokens: 7009,
      outputTokens: 177,
      cacheCreationTokens: 4187,
      cacheReadTokens: 18846
    })
    expect(r!.timestamp).toBe(Date.parse('2026-06-18T10:55:20.432Z'))
  })

  it('parses user records with string content as user text', () => {
    const r = parseLine(
      JSON.stringify({
        type: 'user',
        uuid: 'u1',
        timestamp: '2026-06-18T10:55:18.146Z',
        sessionId: 'sess-1',
        message: { role: 'user', content: 'do the thing' }
      })
    )
    expect(r!.type).toBe('user')
    expect(r!.isUserText).toBe(true)
    expect(r!.usage).toBeNull()
  })

  it('treats tool_result-only user records as non-text', () => {
    const r = parseLine(
      JSON.stringify({
        type: 'user',
        uuid: 'u2',
        sessionId: 'sess-1',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }]
        }
      })
    )
    expect(r!.isUserText).toBe(false)
  })

  it('extracts titles from ai-title records', () => {
    const r = parseLine(
      JSON.stringify({ type: 'ai-title', aiTitle: 'Build session monitor', sessionId: 'sess-1' })
    )
    expect(r!.title).toBe('Build session monitor')
  })

  it('returns null for malformed lines', () => {
    expect(parseLine('not json')).toBeNull()
    expect(parseLine('42')).toBeNull()
    expect(parseLine('{"noType": true}')).toBeNull()
  })

  it('extracts tool_use blocks with agent spawn types', () => {
    const r = parseLine(
      JSON.stringify({
        type: 'assistant',
        uuid: 'a3',
        sessionId: 'sess-1',
        message: {
          role: 'assistant',
          model: 'claude-opus-4-8',
          content: [
            { type: 'text', text: 'working' },
            { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } },
            {
              type: 'tool_use',
              id: 'toolu_2',
              name: 'Agent',
              input: { subagent_type: 'Explore', description: 'look around' }
            }
          ]
        }
      })
    )
    expect(r!.toolUses).toEqual([
      { id: 'toolu_1', name: 'Bash', subagentType: null },
      { id: 'toolu_2', name: 'Agent', subagentType: 'Explore' }
    ])
  })

  it('extracts slash command names from user messages', () => {
    const r = parseLine(
      JSON.stringify({
        type: 'user',
        uuid: 'u3',
        sessionId: 'sess-1',
        message: {
          role: 'user',
          content: '<command-name>/ship-next</command-name>\n<command-args></command-args>'
        }
      })
    )
    expect(r!.commandName).toBe('/ship-next')

    const plain = parseLine(
      JSON.stringify({
        type: 'user',
        uuid: 'u4',
        sessionId: 'sess-1',
        message: { role: 'user', content: 'just text' }
      })
    )
    expect(plain!.commandName).toBeNull()
  })

  it('detects the prompt-cache TTL from usage.cache_creation', () => {
    const mk = (cache_creation?: object, cache_creation_input_tokens = 0): string =>
      JSON.stringify({
        type: 'assistant',
        uuid: 'a-ttl',
        sessionId: 'sess-1',
        message: {
          role: 'assistant',
          model: 'claude-opus-4-8',
          content: [],
          usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens, cache_read_input_tokens: 0, cache_creation }
        }
      })
    expect(
      parseLine(mk({ ephemeral_1h_input_tokens: 4187, ephemeral_5m_input_tokens: 0 }))!.cacheTtl
    ).toBe('1h')
    expect(
      parseLine(mk({ ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 900 }))!.cacheTtl
    ).toBe('5m')
    // Older records without the breakdown: any cache write implies the 5m default
    expect(parseLine(mk(undefined, 500))!.cacheTtl).toBe('5m')
    // No cache written this turn -> unknown
    expect(parseLine(mk({ ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 }))!.cacheTtl).toBeNull()
  })

  it('survives missing usage and null model', () => {
    const r = parseLine(
      JSON.stringify({
        type: 'assistant',
        uuid: 'a2',
        sessionId: 'sess-1',
        message: { role: 'assistant', model: null, content: [] }
      })
    )
    expect(r!.model).toBeNull()
    expect(r!.usage).toBeNull()
  })
})
