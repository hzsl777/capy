import type { z } from "zod";
import type { RunDate } from "@2dayai/core";
import type { Prompt } from "../prompts.js";
import type { Effort } from "../config.js";

export type ParseRequest<T extends z.ZodType> = {
  /** Unique within one parseMany call. Becomes the batch custom_id. */
  id: string;
  stage: string;
  prompt: Prompt;
  schema: T;
  user: string;
  effort: Effort;
};

export type ParseOutcome<T> = { ok: true; value: T } | { ok: false; error: string };

/** The one seam between the pipeline and the model. Real (Anthropic SDK) and fake (tests) both satisfy it. */
export interface Llm {
  parse<T extends z.ZodType>(req: Omit<ParseRequest<T>, "id">, date: RunDate): Promise<z.infer<T>>;
  parseMany<T extends z.ZodType>(reqs: ParseRequest<T>[], date: RunDate): Promise<Map<string, ParseOutcome<z.infer<T>>>>;
}

export class LlmParseError extends Error {
  constructor(
    public readonly stage: string,
    public readonly detail: string,
  ) {
    super(`Model output for stage ${stage} was unusable: ${detail}`);
  }
}

export class SpendCeilingError extends Error {
  constructor(spent: number, ceiling: number) {
    super(`Model spend today is ${spent.toFixed(4)} USD, over the ceiling of ${ceiling.toFixed(2)} USD. Stopping.`);
  }
}
