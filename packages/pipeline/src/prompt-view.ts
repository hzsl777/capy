// One model call laid out for the OpenAI Playground (docs/PROMPTS.md): the system message exactly as the client
// builds it, the settings that match what the pipeline sends, and a sample input from the fictional world day.
import {
  ClusterResultSchema,
  ExplanationSchema,
  SelectionSchema,
  TelegramScoresSchema,
  TelegramWordSchema,
  WorldClusterMergeSchema,
  WorldClusterResultSchema,
  type RunDate,
} from "@2dayai/core";
import type { z } from "zod";
import type { Config } from "./config.js";
import { runDay } from "./day.js";
import { systemWithSchema, thinkingParams } from "./llm/chat.js";
import { isJudgment, modelFor } from "./llm/models.js";
import { loadPrompt, type PromptName } from "./prompts.js";
import { CLUSTER_PROMPT_VERSION, CLUSTER_WORLD_MERGE_PROMPT_VERSION, CLUSTER_WORLD_PROMPT_VERSION } from "./stages/cluster.js";
import { EXPLAIN_PROMPT_VERSION } from "./stages/explain.js";
import { SELECT_PROMPT_VERSION } from "./stages/select.js";
import { TELEGRAM_SCORE_PROMPT_VERSION, TELEGRAM_WORD_PROMPT_VERSION } from "./stages/telegram.js";

/** Each prompt's live version and answer schema. The stage name of every call equals its prompt's name. */
export const PROMPT_CALLS: Record<PromptName, { version: number; schema: z.ZodType }> = {
  "cluster-world": { version: CLUSTER_WORLD_PROMPT_VERSION, schema: WorldClusterResultSchema },
  "cluster-world-merge": { version: CLUSTER_WORLD_MERGE_PROMPT_VERSION, schema: WorldClusterMergeSchema },
  explain: { version: EXPLAIN_PROMPT_VERSION, schema: ExplanationSchema },
  "telegram-score": { version: TELEGRAM_SCORE_PROMPT_VERSION, schema: TelegramScoresSchema },
  "telegram-word": { version: TELEGRAM_WORD_PROMPT_VERSION, schema: TelegramWordSchema },
  cluster: { version: CLUSTER_PROMPT_VERSION, schema: ClusterResultSchema },
  select: { version: SELECT_PROMPT_VERSION, schema: SelectionSchema },
};

export function isPromptName(name: string | undefined): name is PromptName {
  return name !== undefined && name in PROMPT_CALLS;
}

export type PlaygroundView = { label: string; model: string; reasoningEffort: string | undefined; system: string };

export function playgroundView(config: Config, name: PromptName): PlaygroundView {
  const call = PROMPT_CALLS[name];
  const prompt = loadPrompt(name, call.version);
  const think = config.thinking === "all" || (config.thinking === "telegram" && isJudgment(name));
  const effort = thinkingParams(config.provider, think)["reasoning_effort"];
  return { label: prompt.label, model: modelFor(config, name), reasoningEffort: typeof effort === "string" ? effort : undefined, system: systemWithSchema(prompt.system, call.schema) };
}

/**
 * The first user message each call sent on the fictional world day, run in memory through the real stages with
 * the scripted model. 2DayAI's cluster and select are missing: they need reader profiles the fixture doesn't have.
 */
export async function sampleInputs(config: Config, date: RunDate): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const c of await fictionalDay(config, date)) if (!out.has(c.stage)) out.set(c.stage, c.user);
  // The fixture's day fits one batch, so the merge call needs a second run in small batches.
  const merge = (await fictionalDay({ ...config, worldClusterBatch: 8 }, date)).find((c) => c.stage === "cluster-world-merge");
  if (merge) out.set(merge.stage, merge.user);
  return out;
}

async function fictionalDay(config: Config, date: RunDate): Promise<{ stage: string; user: string }[]> {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createTestDb } = await import("./test/db.js");
  const { FakeLlm } = await import("./llm/fake.js");
  const { worldAnswers, worldFeedFor, worldSourcesYaml } = await import("./fixtures/world.js");
  const { db, close } = await createTestDb();
  const dir = mkdtempSync(join(tmpdir(), "capy-prompt-"));
  writeFileSync(join(dir, "sources.yaml"), worldSourcesYaml());
  // The script joins nothing when asked to merge.
  const llm = new FakeLlm({ ...worldAnswers(), "cluster-world-merge": () => ({ groups: [] }) });
  await runDay(db, config, llm, date, { fetchFeed: async (url) => worldFeedFor(url, date), fetchPage: async () => "", sourcesPath: join(dir, "sources.yaml"), readersDir: dir });
  await close();
  return llm.calls;
}
