import type { TokenTotals } from '../shared/types'

/** USD per million tokens */
interface ModelPricing {
  input: number
  output: number
  /** 5-minute-TTL cache write; 1h-TTL writes cost 2x input but transcripts don't distinguish, so we use the common 1.25x rate */
  cacheWrite: number
  cacheRead: number
  contextWindow: number
}

const MTOK = 1_000_000

/**
 * Pricing per million tokens (as of 2026-06). Cache writes are 1.25x base input,
 * cache reads 0.1x. Keys are matched by substring against the full model id
 * (transcripts record ids like "claude-opus-4-5-20251101").
 * Order matters: first match wins, so more specific keys go first.
 */
const PRICING: Array<[key: string, p: ModelPricing]> = [
  ['fable-5', { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 1, contextWindow: 1_000_000 }],
  ['mythos-5', { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 1, contextWindow: 1_000_000 }],
  ['opus-4-8', { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5, contextWindow: 1_000_000 }],
  ['opus-4-7', { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5, contextWindow: 1_000_000 }],
  ['opus-4-6', { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5, contextWindow: 1_000_000 }],
  ['opus-4-5', { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5, contextWindow: 200_000 }],
  ['opus-4-1', { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5, contextWindow: 200_000 }],
  ['opus-4', { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5, contextWindow: 200_000 }],
  ['sonnet-5', { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3, contextWindow: 1_000_000 }],
  ['sonnet-4-6', { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3, contextWindow: 1_000_000 }],
  ['sonnet-4-5', { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3, contextWindow: 200_000 }],
  ['sonnet-4', { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3, contextWindow: 200_000 }],
  ['sonnet-3-7', { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3, contextWindow: 200_000 }],
  ['3-7-sonnet', { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3, contextWindow: 200_000 }],
  ['haiku-4-5', { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1, contextWindow: 200_000 }],
  ['3-5-haiku', { input: 0.8, output: 4, cacheWrite: 1, cacheRead: 0.08, contextWindow: 200_000 }]
]

/** Fallback for unrecognized models: Sonnet-tier pricing, 200K window */
const DEFAULT_PRICING: ModelPricing = {
  input: 3,
  output: 15,
  cacheWrite: 3.75,
  cacheRead: 0.3,
  contextWindow: 200_000
}

export function pricingFor(model: string | null): ModelPricing {
  if (!model) return DEFAULT_PRICING
  for (const [key, p] of PRICING) {
    if (model.includes(key)) return p
  }
  return DEFAULT_PRICING
}

export function contextWindowFor(model: string | null): number {
  return pricingFor(model).contextWindow
}

/** Cost in USD for one usage record from a given model */
export function usageCostUsd(model: string | null, usage: TokenTotals): number {
  const p = pricingFor(model)
  return (
    (usage.inputTokens * p.input +
      usage.outputTokens * p.output +
      usage.cacheCreationTokens * p.cacheWrite +
      usage.cacheReadTokens * p.cacheRead) /
    MTOK
  )
}
