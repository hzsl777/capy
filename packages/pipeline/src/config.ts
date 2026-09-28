import { z } from "zod";

/** Everything the spec calls config, not code (decisions 8 and 10). Read once at startup. */
const EnvSchema = z.object({
  DATABASE_URL: z.string().url().optional(),
  /** Which model API the stages call (decision 28). Every provider but anthropic speaks the OpenAI chat format. */
  LLM_PROVIDER: z.enum(["deepseek", "openai", "gemini", "groq", "mistral", "openrouter", "openai-compatible", "anthropic"]).default("openai"),
  LLM_API_KEY: z.string().optional(),
  /** Accepted for LLM_PROVIDER=anthropic so an existing secret keeps working. */
  ANTHROPIC_API_KEY: z.string().optional(),
  /** Overrides the provider's base URL. Required for openai-compatible. */
  LLM_BASE_URL: z.string().url().optional(),
  RESEND_API_KEY: z.string().optional(),
  /** Model for every stage. Defaults to the provider's cheap general model (decision 29). */
  MODEL: z.string().optional(),
  /** Model for the two telegram calls only: few tokens, the most judgment (decision 28). Defaults to MODEL, or the provider's pick when MODEL is unset. */
  MODEL_TELEGRAM: z.string().optional(),
  /**
   * Which stages let the model think before answering. Thinking costs output tokens and time, and helps judgment
   * more than bulk work, so the default is the telegram only. Sent to providers with a known switch.
   */
  LLM_THINKING: z.enum(["off", "telegram", "all"]).default("telegram"),
  /** "input,output" dollars per million tokens, for a model not in pricing.ts. */
  LLM_PRICE_PER_MTOK: z
    .string()
    .regex(/^\d+(\.\d+)?,\d+(\.\d+)?$/, "two numbers, input and output, for example 0.28,0.42")
    .optional(),
  DAILY_SPEND_CEILING_USD: z.coerce.number().positive().default(1),
  /** Anthropic only. Batches halve cost and add up to an hour of latency (decision 9). Off for a fast local run. */
  LLM_BATCH: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  /** Public base URL of the Worker, for links in email. */
  WEB_BASE_URL: z.string().url().default("https://2dayai.workers.dev"),
  MAIL_FROM: z.string().default("2DayAI <edition@2dayai.example>"),
  /** World events explained per day: importance 3 or more, highest first (decisions 25 and 26). */
  WORLD_EXPLAIN_MAX: z.coerce.number().int().min(0).default(25),
});

export type Effort = "low" | "medium" | "high";

export type Provider = z.infer<typeof EnvSchema>["LLM_PROVIDER"];

/** Base URL and default model per provider. The model ids are the providers' own; check them when a provider renames. */
export const PROVIDERS: Record<Provider, { baseUrl?: string; model?: string; telegramModel?: string }> = {
  deepseek: { baseUrl: "https://api.deepseek.com", model: "deepseek-flash" },
  // Decision 29: the lowest measured hallucination rate for the bulk stages, a stronger sibling for the word.
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-5.4-nano", telegramModel: "gpt-5.4-mini" },
  // gemini-2.5 models refuse new projects since September 18, 2026.
  gemini: { baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-3.5-flash-lite" },
  groq: { baseUrl: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-120b" },
  mistral: { baseUrl: "https://api.mistral.ai/v1", model: "mistral-small-2603" },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1" },
  "openai-compatible": {},
  anthropic: { model: "claude-sonnet-5" },
};

export type Config = {
  databaseUrl: string | undefined;
  provider: Provider;
  llmApiKey: string | undefined;
  llmBaseUrl: string | undefined;
  resendApiKey: string | undefined;
  model: string;
  telegramModel: string;
  thinking: "off" | "telegram" | "all";
  /** Dollars per million tokens from LLM_PRICE_PER_MTOK, used before the price table. */
  priceOverride: { input: number; output: number } | undefined;
  dailySpendCeilingUsd: number;
  llmBatch: boolean;
  webBaseUrl: string;
  mailFrom: string;
  worldExplainMax: number;
  /** Effort per stage (decision 8). */
  effort: { cluster: Effort; explain: Effort; select: Effort; telegram: Effort };
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // An unset GitHub Actions variable arrives as "", which a default would not cover.
  const e = EnvSchema.parse(Object.fromEntries(Object.entries(env).filter(([, v]) => v !== "")));
  const preset = PROVIDERS[e.LLM_PROVIDER];
  const model = e.MODEL ?? preset.model;
  if (!model) throw new Error(`MODEL is required for LLM_PROVIDER=${e.LLM_PROVIDER}`);
  const baseUrl = e.LLM_BASE_URL ?? preset.baseUrl;
  if (!baseUrl && e.LLM_PROVIDER !== "anthropic") throw new Error(`LLM_BASE_URL is required for LLM_PROVIDER=${e.LLM_PROVIDER}`);
  const price = e.LLM_PRICE_PER_MTOK?.split(",").map(Number);
  return {
    databaseUrl: e.DATABASE_URL,
    provider: e.LLM_PROVIDER,
    llmApiKey: e.LLM_API_KEY ?? (e.LLM_PROVIDER === "anthropic" ? e.ANTHROPIC_API_KEY : undefined),
    llmBaseUrl: baseUrl?.replace(/\/$/, ""),
    resendApiKey: e.RESEND_API_KEY,
    model,
    telegramModel: e.MODEL_TELEGRAM ?? (e.MODEL ? model : (preset.telegramModel ?? model)),
    thinking: e.LLM_THINKING,
    priceOverride: price ? { input: price[0]!, output: price[1]! } : undefined,
    dailySpendCeilingUsd: e.DAILY_SPEND_CEILING_USD,
    llmBatch: e.LLM_BATCH,
    webBaseUrl: e.WEB_BASE_URL.replace(/\/$/, ""),
    mailFrom: e.MAIL_FROM,
    worldExplainMax: e.WORLD_EXPLAIN_MAX,
    effort: { cluster: "low", explain: "medium", select: "high", telegram: "high" },
  };
}

export function requireDatabaseUrl(config: Config): string {
  if (!config.databaseUrl) throw new Error("DATABASE_URL is required for this command");
  return config.databaseUrl;
}
