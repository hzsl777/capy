import { z } from "zod";

/** Everything the spec calls config, not code (decision 8, 10). Read once at startup. */
const EnvSchema = z.object({
  DATABASE_URL: z.string().url().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  MODEL: z.string().default("claude-sonnet-5"),
  DAILY_SPEND_CEILING_USD: z.coerce.number().positive().default(1),
});

export type Config = {
  databaseUrl: string | undefined;
  anthropicApiKey: string | undefined;
  resendApiKey: string | undefined;
  model: string;
  dailySpendCeilingUsd: number;
  /** Effort per stage (spec decision 8). */
  effort: { cluster: "low"; explain: "medium"; select: "high" };
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const e = EnvSchema.parse(env);
  return {
    databaseUrl: e.DATABASE_URL,
    anthropicApiKey: e.ANTHROPIC_API_KEY,
    resendApiKey: e.RESEND_API_KEY,
    model: e.MODEL,
    dailySpendCeilingUsd: e.DAILY_SPEND_CEILING_USD,
    effort: { cluster: "low", explain: "medium", select: "high" },
  };
}

export function requireDatabaseUrl(config: Config): string {
  if (!config.databaseUrl) throw new Error("DATABASE_URL is required for this command");
  return config.databaseUrl;
}
