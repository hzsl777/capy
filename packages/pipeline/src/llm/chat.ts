// OpenAI chat-completions format over fetch, for DeepSeek, Gemini, OpenRouter and any compatible host (decision 28).
// No SDK: the request is one POST. These APIs have JSON mode but not Anthropic's schema-constrained output, so the
// JSON Schema goes into the system prompt and Zod checks the answer. A bad answer fails at the boundary as before.
import { z } from "zod";
import type { RunDate } from "@2dayai/core";
import { llmCalls, type Db } from "@2dayai/db";
import type { Config } from "../config.js";
import { costUsd, type Usage } from "./pricing.js";
import { assertUnderCeiling } from "./spend.js";
import { LlmParseError, type Llm, type ParseOutcome, type ParseRequest } from "./types.js";
import { isJudgment, modelFor } from "./models.js";

/**
 * max_tokens per model. Always sent: DeepSeek otherwise stops at 8K without thinking, which a busy day's cluster
 * world answer can pass (every article id appears once). With thinking, reasoning tokens count against it too.
 */
const MAX_OUTPUT: Record<string, number> = {
  "deepseek-flash": 65536,
  "deepseek-v4-pro": 65536,
  "gpt-6-luna": 65536,
  "gpt-5.4-nano": 65536,
  "gpt-5.4-mini": 65536,
  "gemini-3.5-flash-lite": 65536,
  "gemini-3.8-flash": 65536,
  "openai/gpt-oss-120b": 32768,
  "mistral-small-2603": 65536,
};
const DEFAULT_MAX_OUTPUT = 16000;
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
/** No batch API here, so per-event calls run a few at a time instead of one after another. */
const CONCURRENCY = 4;
const RETRY_DELAYS_MS = [2_000, 8_000, 30_000];

type ChatResponse = {
  /** OpenAI echoes the tier that served the request. */
  service_tier?: string;
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    /** DeepSeek. */
    prompt_cache_hit_tokens?: number;
    /** OpenAI format, used by Gemini and OpenRouter. */
    prompt_tokens_details?: { cached_tokens?: number };
  };
};

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export function usageOf(r: ChatResponse): Usage {
  const prompt = r.usage?.prompt_tokens ?? 0;
  const cached = r.usage?.prompt_cache_hit_tokens ?? r.usage?.prompt_tokens_details?.cached_tokens ?? 0;
  return { input: prompt - cached, output: r.usage?.completion_tokens ?? 0, cacheRead: cached, cacheWrite: 0 };
}

export function systemWithSchema(system: string, schema: z.ZodType): string {
  const json = JSON.stringify(z.toJSONSchema(schema, { unrepresentable: "any" }));
  return `${system}\n\nReply with one JSON object and nothing else. It must match this JSON Schema:\n${json}`;
}

export function createChatLlm(
  config: Config,
  db: Db,
  fetchImpl: Fetch = (url, init) => fetch(url, init),
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Llm {
  if (!config.llmApiKey) throw new Error(`LLM_API_KEY is required for model stages (LLM_PROVIDER=${config.provider})`);
  const url = `${config.llmBaseUrl}/chat/completions`;
  // Once flex is refused, the rest of the run asks for the default tier straight away (decision 36).
  let tier = config.serviceTier;

  async function post(body: unknown, stage: string): Promise<ChatResponse> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${config.llmApiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.ok) return (await res.json()) as ChatResponse;
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= RETRY_DELAYS_MS.length) {
        throw new LlmParseError(stage, `HTTP ${res.status} from ${config.provider}: ${(await res.text()).slice(0, 300)}`);
      }
      const after = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(after) && after > 0 ? after * 1000 : RETRY_DELAYS_MS[attempt]!);
    }
  }

  async function parse<T extends z.ZodType>(req: Omit<ParseRequest<T>, "id">, date: RunDate): Promise<z.infer<T>> {
    await assertUnderCeiling(db, date, config.dailySpendCeilingUsd);
    const model = modelFor(config, req.stage);
    const think = config.thinking === "all" || (config.thinking === "telegram" && isJudgment(req.stage));
    const body = {
      model,
      ...thinkingParams(config.provider, think),
      // OpenAI's reasoning models reject max_tokens and take max_completion_tokens instead.
      [config.provider === "openai" ? "max_completion_tokens" : "max_tokens"]: MAX_OUTPUT[model] ?? DEFAULT_MAX_OUTPUT,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemWithSchema(req.prompt.system, req.schema) },
        { role: "user", content: req.user },
      ],
    };
    let response: ChatResponse;
    try {
      response = await post(tier ? { ...body, service_tier: tier } : body, req.stage);
    } catch (err) {
      // Flex has no guaranteed capacity and not every model offers it. The day must not fail for a discount.
      const refused = err instanceof LlmParseError && /HTTP (429|400)/.test(err.message);
      if (!tier || !refused) throw err;
      tier = undefined;
      response = await post(body, req.stage);
    }
    const usage = usageOf(response);
    const discounted = response.service_tier === "flex";
    await db.insert(llmCalls).values({
      runDate: date,
      stage: req.stage,
      model,
      promptVersion: req.prompt.label,
      // Recorded as batch: both are the half-price tier.
      batch: discounted,
      inputTokens: usage.input,
      outputTokens: usage.output,
      cacheReadTokens: usage.cacheRead,
      cacheWriteTokens: 0,
      costUsd: costUsd(model, usage, discounted, config.priceOverride).toFixed(6),
    });
    const choice = response.choices?.[0];
    if (choice?.finish_reason === "length") throw new LlmParseError(req.stage, "output hit max_tokens");
    if (choice?.finish_reason === "content_filter") throw new LlmParseError(req.stage, "refusal: content filter");
    const text = choice?.message?.content?.trim() ?? "";
    if (!text) throw new LlmParseError(req.stage, "empty output");
    let raw: unknown;
    try {
      raw = JSON.parse(stripFence(text));
    } catch {
      throw new LlmParseError(req.stage, "output was not JSON");
    }
    const parsed = req.schema.safeParse(raw);
    if (!parsed.success) throw new LlmParseError(req.stage, `output did not match the schema: ${parsed.error.message.slice(0, 500)}`);
    return parsed.data;
  }

  async function parseMany<T extends z.ZodType>(reqs: ParseRequest<T>[], date: RunDate): Promise<Map<string, ParseOutcome<z.infer<T>>>> {
    const out = new Map<string, ParseOutcome<z.infer<T>>>();
    let next = 0;
    async function worker(): Promise<void> {
      while (next < reqs.length) {
        const req = reqs[next++]!;
        try {
          out.set(req.id, { ok: true, value: await parse(req, date) });
        } catch (err) {
          out.set(req.id, { ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, reqs.length) }, worker));
    return out;
  }

  return { parse, parseMany };
}

/**
 * DeepSeek, Gemini 3 and OpenAI's GPT-5 line reason by default, and bill thinking as output. Gemini's OpenAI
 * endpoint rejects some levels on some models, so "low" rather than "none" when off. Other providers get
 * nothing, so their own defaults apply, until a switch is confirmed for them.
 */
export function thinkingParams(provider: Config["provider"], think: boolean): Record<string, unknown> {
  if (provider === "deepseek") return think ? { reasoning_effort: "high" } : { thinking: { type: "disabled" } };
  if (provider === "gemini") return { reasoning_effort: think ? "high" : "low" };
  // GPT-5.x reasons at "medium" by default; "low" is accepted by every GPT-5 model.
  if (provider === "openai") return { reasoning_effort: think ? "high" : "low" };
  return {};
}

/** Some models wrap JSON in a Markdown fence even in JSON mode. */
function stripFence(text: string): string {
  const m = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(text);
  return m ? m[1]! : text;
}
