import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { toRunDate } from "@2dayai/core";
import { configFor, keyFor, parseSetups, renderReport, runEval, takeSnapshot, type Snapshot } from "./eval.js";
import { worldAnswers, worldFeedFor, worldSourcesYaml } from "./fixtures/world.js";
import { FakeLlm } from "./llm/fake.js";
import { loadSources } from "./sources.js";
import { runEnrich } from "./stages/enrich.js";
import { runIngest } from "./stages/ingest.js";
import { createTestDb } from "./test/db.js";

const DATE = toRunDate("2026-09-27");

async function fixtureSnapshot(): Promise<Snapshot> {
  const { db, close } = await createTestDb();
  const dir = mkdtempSync(join(tmpdir(), "capy-eval-test-"));
  writeFileSync(join(dir, "sources.yaml"), worldSourcesYaml());
  await runIngest(db, loadSources(join(dir, "sources.yaml")), DATE, async (url) => worldFeedFor(url, DATE));
  await runEnrich(db, DATE, async () => "");
  const snap = await takeSnapshot(db, DATE);
  await close();
  // Through JSON, as the CLI saves and reloads it.
  return JSON.parse(JSON.stringify(snap)) as Snapshot;
}

describe("parseSetups", () => {
  it("reads provider defaults, explicit models, OpenRouter ids and a telegram model", () => {
    const s = parseSetups("deepseek; gemini:gemini-2.5-flash-lite; openrouter:deepseek/deepseek-chat-v3.1:free; deepseek:deepseek-chat,telegram=deepseek-reasoner");
    expect(s.map((x) => [x.provider, x.model, x.telegramModel])).toEqual([
      ["deepseek", "deepseek-chat", "deepseek-chat"],
      ["gemini", "gemini-2.5-flash-lite", "gemini-2.5-flash-lite"],
      ["openrouter", "deepseek/deepseek-chat-v3.1:free", "deepseek/deepseek-chat-v3.1:free"],
      ["deepseek", "deepseek-chat", "deepseek-reasoner"],
    ]);
  });
  it("rejects an unknown provider, a missing model and an unknown option", () => {
    expect(() => parseSetups("mystery:model")).toThrow(/Unknown provider/);
    expect(() => parseSetups("openrouter")).toThrow(/needs a model/);
    expect(() => parseSetups("deepseek:deepseek-chat,effort=high")).toThrow(/Unknown option/);
  });
});

describe("configFor", () => {
  it("uses each provider's own key so one run can compare providers", () => {
    const env = { DEEPSEEK_API_KEY: "d", GEMINI_API_KEY: "g", LLM_BASE_URL: "https://elsewhere.example/v1", LLM_PRICE_PER_MTOK: "9,9" };
    const [d, g] = parseSetups("deepseek; gemini").map((s) => configFor(s, env));
    expect([d!.llmApiKey, d!.llmBaseUrl, d!.priceOverride]).toEqual(["d", "https://api.deepseek.com", undefined]);
    expect([g!.llmApiKey, g!.llmBaseUrl]).toEqual(["g", "https://generativelanguage.googleapis.com/v1beta/openai"]);
    expect(keyFor("openrouter", env)).toBeUndefined();
  });
});

describe("runEval", () => {
  it("runs each setup on its own copy of the day and reports cost, checks and every score", async () => {
    const snap = await fixtureSnapshot();
    expect(snap.articles.length).toBeGreaterThan(10);
    const setups = parseSetups("deepseek; gemini");
    const results = await runEval(snap, setups, {
      freshDb: createTestDb,
      // The second setup cannot group articles, so its later stages are skipped and the report says why.
      llmFor: (setup) => new FakeLlm(setup.provider === "gemini" ? { ...worldAnswers(), "cluster-world": () => ({ events: "not a list" }) } : worldAnswers()),
      env: {},
    });

    const [good, broken] = results;
    expect(good!.word).toBe("Unease");
    expect(good!.band).toBe(-1);
    expect(good!.sentences.kept).toBeGreaterThan(0);
    expect(good!.scores[0]!.score).toBe(-1);
    expect(broken!.clusterWorld.ok).toBe(false);
    expect(broken!.telegram).toEqual({ ok: false, error: "skipped: explain failed" });

    const md = renderReport(snap, results);
    expect(md).toContain("| deepseek:deepseek-chat | $0.0000 |");
    expect(md).toContain("**cluster world failed:**");
    expect(md).toContain("Is the worst-scored event really the worst thing");
    expect(md).not.toMatch(/\u2014/);
  }, 60_000);
});
