import { loadConfig, type Config } from "../config.js";

export function testConfig(overrides: Partial<Config> = {}): Config {
  // GDELT_PER_TOWN 0: tests never call the network. The local stage has its own tests with built files.
  return { ...loadConfig({ LLM_PROVIDER: "anthropic", MODEL: "claude-sonnet-5", LLM_BATCH: "false", WEB_BASE_URL: "https://example.test", GDELT_PER_TOWN: "0" }), ...overrides };
}
