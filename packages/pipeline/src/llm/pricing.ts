/** Dollars per million tokens. Anthropic first-party rates from the SDK reference, June 2026. Batch halves both. */
export const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1 },
};

export function costUsd(model: string, usage: { input: number; output: number; cacheRead: number }, batch = false): number {
  const p = PRICES[model];
  if (!p) throw new Error(`No price table entry for model ${model}; add it to pricing.ts`);
  const raw = (usage.input * p.input + usage.output * p.output + usage.cacheRead * p.cacheRead) / 1_000_000;
  return batch ? raw / 2 : raw;
}
