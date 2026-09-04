// The only file in the codebase that imports the Anthropic SDK (spec decision 7).
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import type { Prompt, RunDate } from "@2dayai/core";
import { llmCalls, type Db } from "@2dayai/db";
import type { Config } from "../config.js";
import { costUsd } from "./pricing.js";

export type Effort = "low" | "medium" | "high";

export class LlmParseError extends Error {
  constructor(public readonly stage: string, public readonly stopReason: string | null) {
    super(`Model output for stage ${stage} did not match its schema (stop_reason ${stopReason})`);
  }
}

export type Llm = {
  /** One structured call. Validated at the boundary, logged with cost. Used for clustering (direct) in milestone 1. */
  parse<T extends z.ZodTypeAny>(args: { stage: string; date: RunDate; prompt: Prompt; schema: T; user: string; effort: Effort }): Promise<z.infer<T>>;
};

export function createLlm(config: Config, db: Db): Llm {
  if (!config.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY is required for model stages");
  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  return {
    async parse({ stage, date, prompt, schema, user, effort }) {
      const response = await client.messages.parse({
        model: config.model,
        max_tokens: 16000,
        output_config: { format: zodOutputFormat(schema), effort },
        system: [{ type: "text", text: prompt.system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: user }],
      });
      const usage = {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
        cacheRead: response.usage.cache_read_input_tokens ?? 0,
      };
      await db.insert(llmCalls).values({
        runDate: date,
        stage,
        model: config.model,
        promptVersion: prompt.label,
        inputTokens: usage.input,
        outputTokens: usage.output,
        cacheReadTokens: usage.cacheRead,
        costUsd: costUsd(config.model, usage).toFixed(6),
      });
      if (!response.parsed_output) throw new LlmParseError(stage, response.stop_reason);
      return response.parsed_output;
    },
  };
}
