/**
 * Dollars per million tokens. Anthropic first-party rates from the SDK reference, June 2026. Batch halves both.
 * Rates other than Anthropic's come from search results dated September 2026, not the providers' own pages (decision 28): check them
 * before trusting a spend figure. Gemini's free tier bills nothing, so its row over-counts there, which only makes
 * the spend ceiling trip early.
 */
export const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1 },
  // DeepSeek peak rates (01:00-04:00 and 06:00-10:00 UTC, weekdays). Off-peak is half, so this over-counts then.
  "deepseek-flash": { input: 0.3, output: 1.2, cacheRead: 0.006 },
  "deepseek-v4-pro": { input: 1.32, output: 3.96, cacheRead: 0.044 },
  "gpt-6-luna": { input: 0.1, output: 0.5, cacheRead: 0.01 },
  "gpt-5.4-nano": { input: 0.2, output: 1.25, cacheRead: 0.02 },
  "gpt-5.4-mini": { input: 0.75, output: 4.5, cacheRead: 0.075 },
  "gemini-3.5-flash-lite": { input: 0.3, output: 2.5, cacheRead: 0.03 },
  "gemini-3.8-flash": { input: 0.75, output: 3.75, cacheRead: 0.225 },
  "openai/gpt-oss-120b": { input: 0.15, output: 0.6, cacheRead: 0.075 },
  "mistral-small-2603": { input: 0.15, output: 0.6, cacheRead: 0.15 },
};

export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number };

/**
 * Cache writes bill at 1.25 times the input rate (Anthropic; other providers report none). input excludes both
 * cache figures. OpenRouter's ":free" models cost nothing. An override prices a model the table lacks.
 */
export function costUsd(model: string, usage: Usage, batch = false, override?: { input: number; output: number }): number {
  const p = override ? { ...override, cacheRead: override.input } : model.endsWith(":free") ? { input: 0, output: 0, cacheRead: 0 } : PRICES[model];
  if (!p) throw new Error(`No price table entry for model ${model}; add it to pricing.ts or set LLM_PRICE_PER_MTOK`);
  const raw = (usage.input * p.input + usage.output * p.output + usage.cacheRead * p.cacheRead + usage.cacheWrite * p.input * 1.25) / 1_000_000;
  return batch ? raw / 2 : raw;
}
