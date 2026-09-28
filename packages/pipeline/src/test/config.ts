import { loadConfig, type Config } from "../config.js";

export function testConfig(overrides: Partial<Config> = {}): Config {
  return { ...loadConfig({ LLM_PROVIDER: "anthropic", MODEL: "claude-sonnet-5", LLM_BATCH: "false", WEB_BASE_URL: "https://example.test" }), ...overrides };
}
