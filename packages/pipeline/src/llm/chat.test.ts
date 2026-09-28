import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ClusterResultSchema,
  ExplanationSchema,
  SelectionSchema,
  TelegramScoresSchema,
  TelegramWordSchema,
  WorldClusterMergeSchema,
  WorldClusterResultSchema,
  toRunDate,
} from "@2dayai/core";
import { llmCalls, type Db } from "@2dayai/db";
import { loadConfig } from "../config.js";
import { loadPrompt } from "../prompts.js";
import { createTestDb } from "../test/db.js";
import { createChatLlm, systemWithSchema, type Fetch } from "./chat.js";

const DATE = toRunDate("2026-09-27");
const Schema = z.object({ word: z.string() });

function reply(content: string, finish = "stop", usage: object = { prompt_tokens: 1000, completion_tokens: 100, prompt_cache_hit_tokens: 400 }): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: finish }], usage }), { status: 200 });
}

describe("the OpenAI-format client", () => {
  let db: Db;
  let close: () => Promise<void>;
  let sent: { url: string; body: { model: string; messages: { role: string; content: string }[]; response_format: unknown } }[];
  beforeEach(async () => {
    ({ db, close } = await createTestDb());
    sent = [];
  });
  afterEach(() => close());

  function llm(responses: Response[], env: Record<string, string> = {}) {
    const fetchImpl: Fetch = async (url, init) => {
      sent.push({ url, body: JSON.parse(String(init.body)) });
      const next = responses.shift();
      if (!next) throw new Error("no scripted response left");
      return next;
    };
    const config = loadConfig({ LLM_PROVIDER: "deepseek", LLM_API_KEY: "test-key", ...env });
    return createChatLlm(config, db, fetchImpl, async () => {});
  }

  const req = (stage: string) => ({ stage, prompt: loadPrompt("telegram-word", 1), schema: Schema, user: "the day", effort: "high" as const });

  it("asks for JSON with the schema in the system prompt and logs DeepSeek's cache hits", async () => {
    const out = await llm([reply('{"word":"Unease"}')]).parse(req("cluster-world"), DATE);
    expect(out).toEqual({ word: "Unease" });
    expect(sent[0]!.url).toBe("https://api.deepseek.com/chat/completions");
    expect(sent[0]!.body.model).toBe("deepseek-flash");
    // Bulk stages run without thinking by default; DeepSeek needs the explicit switch.
    expect((sent[0]!.body as unknown as { thinking: unknown }).thinking).toEqual({ type: "disabled" });
    expect(sent[0]!.body.response_format).toEqual({ type: "json_object" });
    expect(sent[0]!.body.messages[0]!.content).toContain('"word"');
    const [call] = await db.select().from(llmCalls);
    expect(call).toMatchObject({ model: "deepseek-flash", inputTokens: 600, cacheReadTokens: 400, outputTokens: 100 });
    // 600 * 0.30 + 400 * 0.006 + 100 * 1.20 per million, stored to six places.
    expect(Number(call!.costUsd)).toBeCloseTo(0.000302, 6);
  });

  it("sends the telegram calls to MODEL_TELEGRAM and everything else to MODEL", async () => {
    const client = llm([reply('{"word":"a"}'), reply('{"word":"b"}')], { MODEL_TELEGRAM: "deepseek-v4-pro" });
    await client.parse(req("explain"), DATE);
    await client.parse(req("telegram-score"), DATE);
    expect(sent.map((s) => s.body.model)).toEqual(["deepseek-flash", "deepseek-v4-pro"]);
    expect((sent[1]!.body as unknown as { reasoning_effort: unknown }).reasoning_effort).toBe("high");
  });

  it("defaults to OpenAI's nano for bulk and mini for the word, with max_completion_tokens", async () => {
    const client = llm([reply('{"word":"a"}'), reply('{"word":"b"}')], { LLM_PROVIDER: "openai" });
    await client.parse(req("cluster-world"), DATE);
    await client.parse(req("telegram-word"), DATE);
    expect(sent[0]!.url).toBe("https://api.openai.com/v1/chat/completions");
    const bodies = sent.map((s) => s.body as unknown as Record<string, unknown>);
    expect(bodies.map((b) => [b["model"], b["reasoning_effort"]])).toEqual([
      ["gpt-5.4-nano", "low"],
      ["gpt-5.4-mini", "high"],
    ]);
    expect(bodies[0]!["max_completion_tokens"]).toBeGreaterThan(8192);
    expect(bodies[0]!["max_tokens"]).toBeUndefined();
  });

  it("waits and retries on a rate limit", async () => {
    const out = await llm([new Response("slow down", { status: 429 }), reply('{"word":"Hope"}')]).parse(req("explain"), DATE);
    expect(out).toEqual({ word: "Hope" });
    expect(sent).toHaveLength(2);
  });

  it("fails at the boundary on text that is not JSON, a wrong shape, or a cut-off answer", async () => {
    await expect(llm([reply("Sure! Here is the word: Hope")]).parse(req("explain"), DATE)).rejects.toThrow(/not JSON/);
    await expect(llm([reply('{"words":["Hope"]}')]).parse(req("explain"), DATE)).rejects.toThrow(/did not match the schema/);
    await expect(llm([reply('{"word":"Ho', "length")]).parse(req("explain"), DATE)).rejects.toThrow(/max_tokens/);
  });

  it("accepts JSON wrapped in a Markdown fence", async () => {
    expect(await llm([reply('```json\n{"word":"Relief"}\n```')]).parse(req("explain"), DATE)).toEqual({ word: "Relief" });
  });

  it("reports each failed request in parseMany without losing the others", async () => {
    const out = await llm([reply('{"word":"a"}'), new Response("bad", { status: 400 }), reply('{"word":"c"}')]).parseMany(
      ["1", "2", "3"].map((id) => ({ id, ...req("explain") })),
      DATE,
    );
    expect([...out.values()].filter((o) => o.ok)).toHaveLength(2);
    expect([...out.values()].find((o) => !o.ok)).toMatchObject({ error: expect.stringMatching(/HTTP 400/) });
  });

  it("can describe every stage's schema as JSON Schema", () => {
    for (const schema of [ClusterResultSchema, WorldClusterResultSchema, WorldClusterMergeSchema, ExplanationSchema, SelectionSchema, TelegramScoresSchema, TelegramWordSchema]) {
      expect(systemWithSchema("prompt", schema)).toMatch(/"type":"object"/);
    }
  });

  it("refuses to start without a key", () => {
    expect(() => createChatLlm(loadConfig({ LLM_PROVIDER: "deepseek" }), db)).toThrow(/LLM_API_KEY/);
  });
});
