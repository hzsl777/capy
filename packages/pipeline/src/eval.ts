// Model comparison for the world desk (decision 28). One snapshot of a day's world articles, every setup run
// through the real cluster world, explain and telegram stages on its own in-memory database, then cost and the
// code checks side by side. The report prints every score and reason so a person can judge the diagnosis itself.
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { ingestWindow, type RunDate } from "@2dayai/core";
import { articles, eventExplanations, events, llmCalls, sources, telegramItems, telegramScores, telegrams, type Db } from "@2dayai/db";
import { loadConfig, PROVIDERS, type Config, type Provider } from "./config.js";
import { createLlm } from "./llm/client.js";
import type { Llm } from "./llm/types.js";
import { runClusterWorld } from "./stages/cluster.js";
import { runExplain } from "./stages/explain.js";
import { runTelegram } from "./stages/telegram.js";

export type Setup = { label: string; provider: Provider; model: string; telegramModel: string };

/**
 * "deepseek; deepseek:deepseek-flash,telegram=deepseek-v4-pro; gemini". Setups split on ";".
 * The provider comes before the first ":", so OpenRouter ids like "qwen/qwen3.8-27b:free" survive.
 */
export function parseSetups(spec: string): Setup[] {
  return spec
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [head, ...opts] = s.split(",").map((p) => p.trim());
      const colon = head!.indexOf(":");
      const provider = (colon === -1 ? head! : head!.slice(0, colon)) as Provider;
      if (!(provider in PROVIDERS)) throw new Error(`Unknown provider "${provider}" in "${s}". Use one of: ${Object.keys(PROVIDERS).join(", ")}`);
      const model = (colon === -1 ? "" : head!.slice(colon + 1)) || PROVIDERS[provider].model;
      if (!model) throw new Error(`"${s}" needs a model, for example ${provider}:<model id>`);
      let telegramModel = model;
      for (const opt of opts) {
        const m = /^telegram=(.+)$/.exec(opt!);
        if (!m) throw new Error(`Unknown option "${opt}" in "${s}". The only option is telegram=<model>`);
        telegramModel = m[1]!;
      }
      const label = telegramModel === model ? `${provider}:${model}` : `${provider}:${model}, telegram ${telegramModel}`;
      return { label, provider, model, telegramModel };
    });
}

/** The API key for a provider: its own variable first, so one run can compare providers, then LLM_API_KEY. */
export function keyFor(provider: Provider, env: NodeJS.ProcessEnv): string | undefined {
  const own = {
    deepseek: "DEEPSEEK_API_KEY",
    openai: "OPENAI_API_KEY",
    gemini: "GEMINI_API_KEY",
    groq: "GROQ_API_KEY",
    mistral: "MISTRAL_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    "openai-compatible": "LLM_API_KEY",
  }[provider];
  return env[own] || env["LLM_API_KEY"] || undefined;
}

export function configFor(setup: Setup, env: NodeJS.ProcessEnv = process.env): Config {
  const e: NodeJS.ProcessEnv = { ...env, LLM_PROVIDER: setup.provider, MODEL: setup.model, MODEL_TELEGRAM: setup.telegramModel, LLM_BATCH: "false" };
  const key = keyFor(setup.provider, env);
  if (key) e["LLM_API_KEY"] = key;
  // A base URL override belongs to one provider. Keep it only for the provider that needs it.
  if (setup.provider !== "openai-compatible") delete e["LLM_BASE_URL"];
  // Rates in LLM_PRICE_PER_MTOK are for one model; applying them to every setup would misprice the rest.
  delete e["LLM_PRICE_PER_MTOK"];
  return loadConfig(e);
}

type SourceRow = typeof sources.$inferSelect;
type ArticleRow = typeof articles.$inferSelect;
export type Snapshot = { version: 1; runDate: RunDate; takenAt: string; sources: SourceRow[]; articles: ArticleRow[] };

/** The world desk's sources and the day's articles, exactly as the stages will read them. */
export async function takeSnapshot(db: Db, date: RunDate): Promise<Snapshot> {
  const { from, to } = ingestWindow(date);
  const world = await db.select().from(sources).where(eq(sources.desk, "world"));
  const rows = world.length
    ? await db
        .select()
        .from(articles)
        .where(and(inArray(articles.sourceId, world.map((s) => s.id)), gte(articles.publishedAt, from), lt(articles.publishedAt, to)))
    : [];
  return { version: 1, runDate: date, takenAt: new Date().toISOString(), sources: world, articles: rows };
}

export async function restoreSnapshot(db: Db, snap: Snapshot): Promise<void> {
  const dated = (v: Date | string | null) => (v === null ? null : new Date(v));
  if (snap.sources.length) await db.insert(sources).values(snap.sources);
  for (let i = 0; i < snap.articles.length; i += 200) {
    await db.insert(articles).values(
      snap.articles.slice(i, i + 200).map((a) => ({ ...a, publishedAt: dated(a.publishedAt)!, fetchedAt: dated(a.fetchedAt)!, enrichedAt: dated(a.enrichedAt) })),
    );
  }
}

type StageOutcome = { ok: true; report: Record<string, unknown> } | { ok: false; error: string };

export type SetupResult = {
  setup: Setup;
  seconds: number;
  costUsd: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costByStage: Record<string, number>;
  clusterWorld: StageOutcome;
  explain: StageOutcome;
  telegram: StageOutcome;
  /** Explanation sentences that passed the citation check, of all the model wrote. */
  sentences: { kept: number; written: number };
  word: string | null;
  band: number | null;
  scores: { title: string; importance: number; score: number; because: string }[];
  lines: { title: string; line: string }[];
};

async function stage(fn: () => Promise<unknown>): Promise<StageOutcome> {
  try {
    return { ok: true, report: (await fn()) as Record<string, unknown> };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

type Sentences = Record<string, unknown[]>;

/** Runs one setup on a fresh database that already holds the snapshot. */
export async function evalSetup(db: Db, setup: Setup, config: Config, llm: Llm, date: RunDate): Promise<SetupResult> {
  const started = Date.now();
  const clusterWorld = await stage(() => runClusterWorld(db, config, llm, date));
  const explain = clusterWorld.ok ? await stage(() => runExplain(db, config, llm, date)) : { ok: false as const, error: "skipped: cluster world failed" };
  const telegram = explain.ok ? await stage(() => runTelegram(db, config, llm, date)) : { ok: false as const, error: "skipped: explain failed" };
  const seconds = (Date.now() - started) / 1000;

  const calls = await db.select().from(llmCalls).where(eq(llmCalls.runDate, date));
  const costByStage: Record<string, number> = {};
  for (const c of calls) costByStage[c.stage] = (costByStage[c.stage] ?? 0) + Number(c.costUsd);

  const explained = await db
    .select({ sentences: eventExplanations.sentences })
    .from(eventExplanations)
    .innerJoin(events, eq(events.id, eventExplanations.eventId))
    .where(and(eq(events.runDate, date), eq(events.desk, "world")));
  const kept = explained.reduce((n, r) => n + Object.values(r.sentences as Sentences).reduce((m, list) => m + (Array.isArray(list) ? list.length : 0), 0), 0);
  const dropped = explain.ok ? Number(explain.report["sentencesDropped"] ?? 0) : 0;

  const [tg] = await db.select().from(telegrams).where(eq(telegrams.runDate, date));
  const titles = new Map((await db.select({ id: events.id, title: events.title, importance: events.importance }).from(events).where(eq(events.runDate, date))).map((e) => [e.id, e]));
  const scores = tg
    ? (await db.select().from(telegramScores).where(eq(telegramScores.telegramId, tg.id)))
        .map((s) => ({ title: titles.get(s.eventId)?.title ?? `event ${s.eventId}`, importance: titles.get(s.eventId)?.importance ?? 0, score: s.score, because: s.because }))
        .sort((a, b) => a.score - b.score || b.importance - a.importance)
    : [];
  const lines = tg
    ? (await db.select().from(telegramItems).where(eq(telegramItems.telegramId, tg.id)))
        .sort((a, b) => a.rank - b.rank)
        .map((i) => ({ title: titles.get(i.eventId)?.title ?? `event ${i.eventId}`, line: i.line }))
    : [];

  return {
    setup,
    seconds,
    costUsd: calls.reduce((n, c) => n + Number(c.costUsd), 0),
    calls: calls.length,
    inputTokens: calls.reduce((n, c) => n + c.inputTokens + c.cacheReadTokens, 0),
    outputTokens: calls.reduce((n, c) => n + c.outputTokens, 0),
    costByStage,
    clusterWorld,
    explain,
    telegram,
    sentences: { kept, written: kept + dropped },
    word: tg?.word ?? null,
    band: tg?.band ?? null,
    scores,
    lines,
  };
}

export type SetupRunner = (setup: Setup) => Promise<SetupResult>;

/** Each setup gets its own database so no stage can see another setup's events. */
export async function runEval(snap: Snapshot, setups: Setup[], deps: { freshDb: () => Promise<{ db: Db; close: () => Promise<void> }>; llmFor?: (setup: Setup, config: Config, db: Db) => Llm; env?: NodeJS.ProcessEnv }): Promise<SetupResult[]> {
  const out: SetupResult[] = [];
  for (const setup of setups) {
    const { db, close } = await deps.freshDb();
    try {
      await restoreSnapshot(db, snap);
      const config = configFor(setup, deps.env);
      const llm = deps.llmFor ? deps.llmFor(setup, config, db) : createLlm(config, db);
      out.push(await evalSetup(db, setup, config, llm, snap.runDate));
    } finally {
      await close();
    }
  }
  return out;
}

const BAND = ["Grave", "Hard", "Mixed", "Hopeful", "Good"];
const bandName = (b: number | null) => (b === null ? "none" : `${BAND[b + 2]} (${b > 0 ? "+" : ""}${b})`);
const usd = (n: number) => `$${n < 0.01 ? n.toFixed(4) : n.toFixed(3)}`;
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

export function renderReport(snap: Snapshot, results: SetupResult[], opts: { fake?: boolean } = {}): string {
  const outlets = new Set(snap.articles.map((a) => a.sourceId)).size;
  const ref = results[0];
  const out: string[] = [
    `# Model eval, ${snap.runDate}`,
    "",
    `${snap.articles.length} world articles from ${outlets} outlets, snapshot taken ${snap.takenAt}. Every setup read the same articles.`,
    "",
    ...(opts.fake ? ["**Fake model.** Every setup answered from the fictional fixture's script, so costs are zero and results match. This shows the report's shape only.", ""] : []),
    "| Setup | Cost for the day | Per 30 days | Time | Events | Explained (usable) | Sentences kept | Score retry | Word retry | Band | Word | Same band as first |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const r of results) {
    const tg = r.telegram.ok ? r.telegram.report : null;
    const retried = (tg?.["retried"] ?? {}) as { score?: boolean; word?: boolean };
    const ex = r.explain.ok ? r.explain.report : null;
    const events = r.clusterWorld.ok ? String(r.clusterWorld.report["events"]) : "failed";
    const pct = r.sentences.written ? `${r.sentences.kept}/${r.sentences.written} (${Math.round((100 * r.sentences.kept) / r.sentences.written)}%)` : "0";
    out.push(
      `| ${cell(r.setup.label)} | ${usd(r.costUsd)} | ${usd(r.costUsd * 30)} | ${Math.round(r.seconds)} s | ${events} | ${ex ? `${ex["events"]} (${ex["usable"]})` : "failed"} | ${pct} | ${tg ? (retried.score ? "yes" : "no") : "-"} | ${tg ? (retried.word ? "yes" : "no") : "-"} | ${bandName(r.band)} | ${r.word ?? "none"} | ${r === ref ? "(first)" : r.band === ref?.band ? "yes" : "no"} |`,
    );
  }
  out.push(
    "",
    "The code checks catch answers that break the rules. They cannot tell whether the model read the day right. For that, read each setup below and ask:",
    "",
    "1. Is the worst-scored event really the worst thing that happened to people today?",
    "2. Does each score fit the sentence quoted as its reason?",
    "3. Did grouping merge separate stories or split one story into several events?",
    "4. Would you publish these lines under the word?",
  );
  for (const r of results) {
    out.push("", `## ${r.setup.label}`, "");
    out.push(`Cost by stage: ${Object.entries(r.costByStage).map(([s, c]) => `${s} ${usd(c)}`).join(", ") || "none"}. ${r.calls} calls, ${r.inputTokens.toLocaleString("en")} tokens in, ${r.outputTokens.toLocaleString("en")} out.`);
    for (const [name, o] of [["cluster world", r.clusterWorld], ["explain", r.explain], ["telegram", r.telegram]] as const) {
      if (!o.ok) out.push("", `**${name} failed:** ${o.error}`);
    }
    if (r.word) {
      out.push("", `**${r.word}**, ${bandName(r.band)}`, "");
      for (const l of r.lines) out.push(`- ${l.line} _(${l.title})_`);
    }
    if (r.scores.length) {
      out.push("", "| Score | Importance | Event | Because |", "|---|---|---|---|");
      for (const s of r.scores) out.push(`| ${s.score > 0 ? "+" : ""}${s.score} | ${s.importance} | ${cell(s.title)} | ${cell(s.because)} |`);
    }
  }
  return out.join("\n") + "\n";
}

