import { z } from "zod";

/** Everything the spec calls config, not code (decisions 8 and 10). Read once at startup. */
const EnvSchema = z.object({
  DATABASE_URL: z.string().url().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  MODEL: z.string().default("claude-sonnet-5"),
  DAILY_SPEND_CEILING_USD: z.coerce.number().positive().default(1),
  /** Batches halve cost and add up to an hour of latency (decision 9). Off for a fast local run. */
  LLM_BATCH: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  /** Public base URL of the Worker, for links in email. */
  WEB_BASE_URL: z.string().url().default("https://2dayai.workers.dev"),
  MAIL_FROM: z.string().default("2DayAI <edition@2dayai.example>"),
});

export type Effort = "low" | "medium" | "high";

export type Config = {
  databaseUrl: string | undefined;
  anthropicApiKey: string | undefined;
  resendApiKey: string | undefined;
  model: string;
  dailySpendCeilingUsd: number;
  llmBatch: boolean;
  webBaseUrl: string;
  mailFrom: string;
  /** Effort per stage (decision 8). */
  effort: { cluster: Effort; explain: Effort; select: Effort };
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // An unset GitHub Actions variable arrives as "", which a default would not cover.
  const e = EnvSchema.parse(Object.fromEntries(Object.entries(env).filter(([, v]) => v !== "")));
  return {
    databaseUrl: e.DATABASE_URL,
    anthropicApiKey: e.ANTHROPIC_API_KEY,
    resendApiKey: e.RESEND_API_KEY,
    model: e.MODEL,
    dailySpendCeilingUsd: e.DAILY_SPEND_CEILING_USD,
    llmBatch: e.LLM_BATCH,
    webBaseUrl: e.WEB_BASE_URL.replace(/\/$/, ""),
    mailFrom: e.MAIL_FROM,
    effort: { cluster: "low", explain: "medium", select: "high" },
  };
}

export function requireDatabaseUrl(config: Config): string {
  if (!config.databaseUrl) throw new Error("DATABASE_URL is required for this command");
  return config.databaseUrl;
}
