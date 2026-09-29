// The only file in the codebase that imports the Anthropic SDK (spec decision 7).
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import type { RunDate } from "@2dayai/core";
import { llmCalls, type Db } from "@2dayai/db";
import type { Config } from "../config.js";
import { costUsd, type Usage } from "./pricing.js";
import { assertUnderCeiling } from "./spend.js";
import { LlmParseError, type Llm, type ParseOutcome, type ParseRequest } from "./types.js";
import { modelFor } from "./models.js";
import { noControlDeep } from "../text.js";

const MAX_TOKENS = 16000;
const BATCH_POLL_MS = 30_000;
const BATCH_MAX_WAIT_MS = 3 * 60 * 60 * 1000;

function usageOf(m: Anthropic.Message): Usage {
  return { input: m.usage.input_tokens, output: m.usage.output_tokens, cacheRead: m.usage.cache_read_input_tokens ?? 0, cacheWrite: m.usage.cache_creation_input_tokens ?? 0 };
}

function textOf(m: Anthropic.Message): string {
  return m.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

export function createAnthropicLlm(config: Config, db: Db, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Llm {
  if (!config.llmApiKey) throw new Error("LLM_API_KEY (or ANTHROPIC_API_KEY) is required for model stages");
  const client = new Anthropic({ apiKey: config.llmApiKey });

  async function log(date: RunDate, req: { stage: string; prompt: { label: string } }, usage: Usage, batch: boolean): Promise<void> {
    await db.insert(llmCalls).values({
      runDate: date,
      stage: req.stage,
      model: modelFor(config, req.stage),
      promptVersion: req.prompt.label,
      batch,
      inputTokens: usage.input,
      outputTokens: usage.output,
      cacheReadTokens: usage.cacheRead,
      cacheWriteTokens: usage.cacheWrite,
      costUsd: costUsd(modelFor(config, req.stage), usage, batch, config.priceOverride).toFixed(6),
    });
  }

  function params<T extends z.ZodType>(req: Omit<ParseRequest<T>, "id">) {
    return {
      model: modelFor(config, req.stage),
      max_tokens: MAX_TOKENS,
      output_config: { format: zodOutputFormat(req.schema), effort: req.effort },
      system: [{ type: "text" as const, text: req.prompt.system, cache_control: { type: "ephemeral" as const } }],
      messages: [{ role: "user" as const, content: req.user }],
    };
  }

  async function parse<T extends z.ZodType>(req: Omit<ParseRequest<T>, "id">, date: RunDate): Promise<z.infer<T>> {
    await assertUnderCeiling(db, date, config.dailySpendCeilingUsd);
    const response = await client.messages.parse(params(req));
    await log(date, req, usageOf(response), false);
    if (response.stop_reason === "refusal") throw new LlmParseError(req.stage, `refusal: ${response.stop_details?.explanation ?? "no explanation"}`);
    if (response.stop_reason === "max_tokens") throw new LlmParseError(req.stage, "output hit max_tokens");
    if (!response.parsed_output) throw new LlmParseError(req.stage, "output did not match the schema");
    return noControlDeep(response.parsed_output);
  }

  async function parseMany<T extends z.ZodType>(reqs: ParseRequest<T>[], date: RunDate): Promise<Map<string, ParseOutcome<z.infer<T>>>> {
    const out = new Map<string, ParseOutcome<z.infer<T>>>();
    if (reqs.length === 0) return out;
    if (!config.llmBatch || reqs.length === 1) {
      for (const req of reqs) {
        try {
          out.set(req.id, { ok: true, value: await parse(req, date) });
        } catch (err) {
          out.set(req.id, { ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      }
      return out;
    }

    await assertUnderCeiling(db, date, config.dailySpendCeilingUsd);
    const formats = new Map(reqs.map((r) => [r.id, zodOutputFormat(r.schema)]));
    const batch = await client.messages.batches.create({
      requests: reqs.map((r) => ({ custom_id: r.id, params: { ...params(r), output_config: { format: formats.get(r.id)!, effort: r.effort } } })),
    });
    const started = Date.now();
    let status = batch;
    while (status.processing_status !== "ended") {
      if (Date.now() - started > BATCH_MAX_WAIT_MS) throw new LlmParseError(reqs[0]!.stage, `batch ${batch.id} did not finish within the wait limit`);
      await sleep(BATCH_POLL_MS);
      status = await client.messages.batches.retrieve(batch.id);
    }
    const byId = new Map(reqs.map((r) => [r.id, r]));
    for await (const result of await client.messages.batches.results(batch.id)) {
      const req = byId.get(result.custom_id);
      if (!req) continue;
      if (result.result.type !== "succeeded") {
        out.set(req.id, { ok: false, error: result.result.type === "errored" ? JSON.stringify(result.result.error) : result.result.type });
        continue;
      }
      const message = result.result.message;
      await log(date, req, usageOf(message), true);
      if (message.stop_reason === "refusal" || message.stop_reason === "max_tokens") {
        out.set(req.id, { ok: false, error: `stop_reason ${message.stop_reason}` });
        continue;
      }
      try {
        out.set(req.id, { ok: true, value: noControlDeep(formats.get(req.id)!.parse(textOf(message))) });
      } catch (err) {
        out.set(req.id, { ok: false, error: `output did not match the schema: ${err instanceof Error ? err.message : String(err)}` });
      }
    }
    for (const r of reqs) if (!out.has(r.id)) out.set(r.id, { ok: false, error: "no result returned for this request" });
    return out;
  }

  return { parse, parseMany };
}
