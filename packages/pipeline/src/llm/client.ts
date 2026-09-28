import type { Db } from "@2dayai/db";
import type { Config } from "../config.js";
import { createAnthropicLlm } from "./anthropic.js";
import { createChatLlm } from "./chat.js";
import type { Llm } from "./types.js";

/** The real model client for the configured provider (decision 28). */
export function createLlm(config: Config, db: Db): Llm {
  return config.provider === "anthropic" ? createAnthropicLlm(config, db) : createChatLlm(config, db);
}
