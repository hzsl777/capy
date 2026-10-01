// Entry point. `npm run stage -- <command> [--date YYYY-MM-DD]`. Each stage is re-runnable per date (spec decision 6).
import { parseArgs } from "node:util";
import { placeIdFor, renderEditionText, lastFullRunDate, rollingWindow, toRunDate, WORLD_TOPICS, type MapFile, type VerifiedSentence, type WorldTopic } from "@2dayai/core";
import { editions, feedback, latestFinishedMapDate, latestMapDate, loadEditionView, loadMapView, localBase, readers } from "@2dayai/db";
import { createDb } from "@2dayai/db/node";
import { and, desc, eq, gte } from "drizzle-orm";
import { loadConfig, requireDatabaseUrl } from "./config.js";
import { mapCovers, runDay } from "./day.js";
import { keyFor, parseSetups, renderReport, runEval, takeSnapshot, type Snapshot } from "./eval.js";
import { createLlm } from "./llm/client.js";
import { spentToday } from "./llm/spend.js";
import { createResendSender } from "./mail.js";
import { loadProfiles, syncReaders } from "./profiles.js";
import { recorded } from "./runs.js";
import { loadSources } from "./sources.js";
import { runCluster, runClusterWorld } from "./stages/cluster.js";
import { runDeliver } from "./stages/deliver.js";
import { runEnrich } from "./stages/enrich.js";
import { runExplain } from "./stages/explain.js";
import { checkSources, runIngest, type IngestReport } from "./stages/ingest.js";
import { runSelect } from "./stages/select.js";
import { runTelegram } from "./stages/telegram.js";
import { runLocal } from "./stages/local.js";
import { daySummary } from "./summary.js";
import { checkMapFile, writeMapFiles } from "./map-files.js";
import { FEED_XML } from "./fixtures/day.js";
import { appendFileSync, existsSync, readFileSync, writeFileSync, mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    date: { type: "string" },
    sources: { type: "string", default: "config/sources.yaml" },
    readers: { type: "string", default: "config/readers" },
    reader: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    fixture: { type: "boolean", default: false },
    force: { type: "boolean", default: false },
    "if-missing": { type: "boolean", default: false },
    out: { type: "string" },
    manifest: { type: "string" },
    in: { type: "string" },
    setups: { type: "string" },
    snapshot: { type: "string" },
    fake: { type: "boolean", default: false },
  },
});

// `prompt <name>` takes an argument; every other command is its words.
const command = positionals[0] === "prompt" ? "prompt" : positionals.join(" ");
// Without --date, the last day that has ended: the daily run builds it just after midnight UTC (decision 81).
const date = values.date ? toRunDate(values.date) : lastFullRunDate();
const config = loadConfig();

function printReports(reports: IngestReport[]): void {
  for (const r of reports) {
    const status = r.error
      ? `FAIL ${r.error}`
      : `ok fetched=${r.fetched} inserted=${r.inserted}${r.feedTitle ? ` title="${r.feedTitle}"` : ""}${r.headlines ? ` headlines="${r.headlines.join(" | ")}"` : ""}${r.feedUrl ? ` feed found at ${r.feedUrl} (put it in sources.yaml)` : ""}${r.declared ? ` page links to ${r.declared.join(" ")}` : ""}`;
    console.log(`${r.source.padEnd(28)} ${status}`);
  }
  const failed = reports.filter((r) => r.error).length;
  console.log(`\n${reports.length - failed} of ${reports.length} sources fetched for ${date}.`);
}

function db() {
  return createDb(requireDatabaseUrl(config));
}

const HELP = `Commands:
  sources check          fetch every feed and report, no database
  ingest                 feeds into the database
  enrich                 fetch article pages for the day's articles
  readers sync           config/readers/*.yaml into the database
  cluster [--force]      group the day's articles into events (model); refuses after editions were sent unless forced
  explain                explain each event with verified citations (model, batched)
  select                 one edition per reader with the headline (model, batched)
  cluster world          group the world desk's articles into events with a topic (model)
  telegram               score the day's world events three times, keep the middle, pick the one-word mood (model)
  local                  GDELT local stories from the towns no outlet reached (no model, decisions 54, 67 and 78)
  refresh                the latest map's local stories again, from the last 24 hours of GDELT (no model, decision 80)
  map export [--out f]   the public map's data for the date (default: latest): the day's file, and its tiles of local
                         stories in local/<date>/ beside it; --manifest f lists the tiles for wrangler r2 bulk put
  map check --in f       refuses (exit 1) a day's file not fit to be the site's latest; --manifest f checks its tiles
  coverage               towns, countries and regions with a story on the date (default: latest), and the countries
                         and territories with none
  map headlines --in f   real headlines gathered by hand or search (JSON) into a demo map file, no model, no database
  demo [--out f]         the fictional world fixture through the real stages, in memory, into the map's sample data
  eval [--setups s]      compare models on one day's world articles: cost, the code checks, every score (decision 28)
                         --snapshot f reuses a saved day; --fixture uses the fictional day; --fake skips the model
  show [--reader r01]    print a reader's edition for the date
  deliver [--dry-run]    send unsent editions whose delivery hour has arrived
  day [--fixture]        ingest, enrich, readers sync, cluster, cluster world, explain, select, telegram
                         --if-missing skips when the date's map already exists
  spend                  model spend for the date
  llm check              one tiny call per configured model: key, model ids, flex tier (costs a fraction of a cent)
  prompt <name>          one call's system message, settings and a sample input, to paste into the OpenAI Playground
                         names: cluster-world, cluster-world-merge, explain, telegram-score, telegram-word, cluster, select
  feedback [--reader r01] reader feedback from the last 14 days, newest first
Options: --date YYYY-MM-DD  --sources path  --readers dir`;

switch (command) {
  case "sources check": {
    printReports(await checkSources(loadSources(values.sources), date));
    break;
  }
  case "ingest": {
    const d = db();
    printReports(await recorded(d, date, "ingest", () => runIngest(d, loadSources(values.sources), date)));
    break;
  }
  case "enrich": {
    const d = db();
    console.log(await recorded(d, date, "enrich", () => runEnrich(d, date)));
    break;
  }
  case "readers sync": {
    const d = db();
    console.log(await syncReaders(d, loadProfiles(values.readers)));
    break;
  }
  case "cluster": {
    const d = db();
    console.log(await recorded(d, date, "cluster", () => runCluster(d, config, createLlm(config, d), date, { force: values.force })));
    break;
  }
  case "explain": {
    const d = db();
    console.log(await recorded(d, date, "explain", () => runExplain(d, config, createLlm(config, d), date)));
    break;
  }
  case "select": {
    const d = db();
    console.log(await recorded(d, date, "select", () => runSelect(d, config, createLlm(config, d), date)));
    break;
  }
  case "cluster world": {
    const d = db();
    console.log(await recorded(d, date, "cluster-world", () => runClusterWorld(d, config, createLlm(config, d), date, loadSources(values.sources))));
    break;
  }
  case "telegram": {
    const d = db();
    console.log(await recorded(d, date, "telegram", () => runTelegram(d, config, createLlm(config, d), date)));
    break;
  }
  case "local": {
    const d = db();
    console.log(await recorded(d, date, "local", () => runLocal(d, date, config.local)));
    break;
  }
  case "refresh": {
    // During the day, between daily runs: the latest map keeps its outlets' stories and its word, and its local
    // stories become the last 24 hours' (decision 80). The latest finished day: a daily run that failed part way
    // leaves the day before up.
    const d = db();
    const day = await latestFinishedMapDate(d);
    if (!day) {
      console.log("No world-desk run yet; nothing to refresh.");
      break;
    }
    const latest = toRunDate(day);
    console.log(await recorded(d, latest, "refresh", () => runLocal(d, latest, config.local, undefined, undefined, rollingWindow())));
    break;
  }
  case "map headlines": {
    // A preview from real headlines when the feeds can't be reached: publisher pins from sources.yaml, headlines
    // as given, no summaries, no events, no word. The banner says what is missing.
    if (!values.in) throw new Error("--in <headlines.json> is required");
    type Headline = { sourceId: string; title: string; url: string; topic?: string };
    const input = JSON.parse(readFileSync(values.in, "utf8")) as { collectedAt: string; items: Headline[] };
    const world = new Map(loadSources(values.sources).filter((s) => s.desk === "world" && s.place).map((s) => [s.id, s]));
    const collected = Math.floor(new Date(input.collectedAt).getTime() / 1000);
    const places: MapFile["places"] = [];
    const placeIndex = new Map<string, number>();
    const rank = new Map<string, number>();
    const seen = new Set<string>();
    const items: MapFile["items"] = [];
    for (const h of input.items) {
      const src = world.get(h.sourceId);
      if (!src?.place || seen.has(h.url)) continue;
      seen.add(h.url);
      const id = placeIdFor(src.place.lat, src.place.lon);
      if (!placeIndex.has(id)) placeIndex.set(id, places.push({ id, name: src.place.name, lat: src.place.lat, lon: src.place.lon }) - 1);
      const r = rank.get(src.id) ?? 0;
      rank.set(src.id, r + 1);
      const named = ({ climate: "environment", society: "other" } as Record<string, string>)[h.topic ?? ""] ?? h.topic ?? "";
      const topic = (WORLD_TOPICS as readonly string[]).includes(named) ? (named as WorldTopic) : "other";
      items.push({
        id: `demo-${items.length}`,
        // Search results carry no reliable publish time: two hours before collection, in result order.
        t: collected - 2 * 3600 - r * 60,
        title: h.title,
        url: h.url,
        domain: new URL(h.url).hostname.replace(/^www\./, ""),
        publisher: src.name,
        lang: src.lang,
        topics: [topic],
        place: placeIndex.get(id)!,
      });
    }
    const when = new Date(collected * 1000).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
    const file: MapFile = {
      version: 2,
      source: "demo",
      note: `Demo: real headlines from a web search on ${when}. Times are approximate and there is no word yet.`,
      generatedAt: collected,
      runDate: input.collectedAt.slice(0, 10),
      places,
      items: items.sort((a, b) => b.t - a.t),
      events: {},
      telegram: null,
    };
    const out = values.out ?? "packages/map/public/data/latest.json";
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(file));
    console.log(`${out}: ${items.length} headlines from ${new Set(items.map((i) => i.publisher)).size} outlets at ${places.length} places`);
    break;
  }
  case "map export": {
    const d = db();
    const day = values.date ?? (await latestFinishedMapDate(d));
    if (!day) {
      console.error("No world-desk run yet; nothing to export.");
      process.exit(1);
    }
    const out = values.out ?? "packages/map/public/data/latest.json";
    mkdirSync(dirname(out), { recursive: true });
    // The day's file and, beside it, its local stories in tiles (decision 78).
    const { main, bytes, tiles } = writeMapFiles(await loadMapView(d, day), out, localBase(day));
    if (values.manifest) writeFileSync(values.manifest, JSON.stringify(tiles));
    const kb = (n: number) => `${Math.round(n / 1024)} KB`;
    console.log(`${out}: ${main.items.length} items, ${main.places.length} places, ${Object.keys(main.events).length} explained events, telegram ${main.telegram ? `"${main.telegram.word}"` : "none"}, ${kb(bytes.main)}`);
    console.log(`${tiles.length} tiles of local stories in ${join(dirname(out), localBase(day))}: ${Object.values(main.local?.tiles ?? {}).reduce((a, b) => a + b, 0)} stories, ${kb(bytes.tiles)}, the largest ${kb(bytes.largestTile)}`);
    break;
  }
  case "map check": {
    // Before the site's copy is replaced: a broken file fails the run and the file already stored stays up.
    if (!values.in) throw new Error("--in <map.json> is required");
    const problems = checkMapFile(values.in, values.manifest);
    if (problems.length) {
      console.error(`${values.in} is not fit to publish: ${problems.join("; ")}.`);
      process.exit(1);
    }
    console.log(`${values.in} passes the checks before publishing.`);
    break;
  }
  case "coverage": {
    const d = db();
    const day = values.date ?? (await latestMapDate(d));
    if (!day) {
      console.error("No world-desk run yet; nothing to count.");
      process.exit(1);
    }
    const { coverageOf, coverageReport } = await import("./coverage.js");
    const { Gazetteer } = await import("./places.js");
    console.log(coverageReport(day, coverageOf(await loadMapView(d, day), Gazetteer.loadWithTowns())));
    break;
  }
  case "demo": {
    // Everything real except the model and the network: PGlite, the migrations, every stage, every validator,
    // the read model. The model answers from the fictional world fixture's script.
    const { createTestDb } = await import("./test/db.js");
    const { FakeLlm } = await import("./llm/fake.js");
    const { worldAnswers, worldFeedFor, worldSourcesYaml } = await import("./fixtures/world.js");
    const { worldGdeltFor } = await import("./fixtures/gdelt.js");
    const { db: memory, close } = await createTestDb();
    const dir = mkdtempSync(join(tmpdir(), "capy-demo-"));
    writeFileSync(join(dir, "sources.yaml"), worldSourcesYaml());
    const report = await runDay(memory, config, new FakeLlm(worldAnswers()), date, {
      fetchFeed: async (url) => worldFeedFor(url, date),
      fetchPage: async () => "",
      // The fictional day's GDELT file: invented local sites about real towns.
      fetchGdelt: async (url) => worldGdeltFor(url, date),
      sourcesPath: join(dir, "sources.yaml"),
      readersDir: dir,
    });
    const full = { ...(await loadMapView(memory, date)), source: "sample" as const };
    await close();
    const out = values.out ?? "packages/map/public/data/sample.json";
    mkdirSync(dirname(out), { recursive: true });
    // The sample's tiles sit in local/sample/, so regenerating it on another day leaves no stale folder behind.
    const { main, tiles } = writeMapFiles(full, out, "local/sample/");
    console.log(JSON.stringify({ clusterWorld: report["clusterWorld"], explain: report["explain"], telegram: report["telegram"], local: report["local"] }));
    console.log(`${out}: ${main.items.length} items, ${main.places.length} places, telegram ${main.telegram ? `"${main.telegram.word}"` : "none"}, and ${tiles.length} tiles of local stories`);
    break;
  }
  case "eval": {
    const { createTestDb } = await import("./test/db.js");
    const snapPath = values.snapshot ?? `.eval/snapshot-${date}.json`;
    let snap: Snapshot;
    if (existsSync(snapPath)) {
      snap = JSON.parse(readFileSync(snapPath, "utf8")) as Snapshot;
      console.log(`Using ${snapPath}: ${snap.articles.length} articles from ${snap.runDate}.`);
    } else {
      if (values.fixture) {
        const { worldFeedFor, worldSourcesYaml } = await import("./fixtures/world.js");
        const { db: memory, close } = await createTestDb();
        const dir = mkdtempSync(join(tmpdir(), "capy-eval-"));
        writeFileSync(join(dir, "sources.yaml"), worldSourcesYaml());
        await runIngest(memory, loadSources(join(dir, "sources.yaml")), date, async (url) => worldFeedFor(url, date));
        await runEnrich(memory, date, async () => "");
        snap = await takeSnapshot(memory, date);
        await close();
      } else if (config.databaseUrl) {
        snap = await takeSnapshot(db(), date);
      } else {
        // No database: fetch the world feeds now, into memory. Free, but needs the network.
        const { db: memory, close } = await createTestDb();
        printReports(await runIngest(memory, loadSources(values.sources).filter((s) => s.desk === "world"), date));
        await runEnrich(memory, date);
        snap = await takeSnapshot(memory, date);
        await close();
      }
      if (snap.articles.length === 0) throw new Error(`No world articles for ${date}. Try another --date, or --fixture.`);
      mkdirSync(dirname(snapPath), { recursive: true });
      writeFileSync(snapPath, JSON.stringify(snap));
      console.log(`Saved ${snapPath}: ${snap.articles.length} articles. Later runs reuse it, so every setup reads the same day.`);
    }
    const all = parseSetups(
      values.setups ??
        "openai:gpt-5.4-mini; openai; openai:gpt-6-luna,telegram=gpt-5.4-mini; mistral; deepseek",
    );
    const setups = values.fake ? all : all.filter((s) => keyFor(s.provider, process.env));
    for (const s of all) if (!setups.includes(s)) console.log(`Skipping ${s.label}: no API key (set ${s.provider.toUpperCase().replace(/-/g, "_")}_API_KEY or LLM_API_KEY).`);
    if (setups.length === 0) throw new Error("No setup has an API key. Add one, or pass --fake to see the report on the fictional script.");
    let llmFor;
    if (values.fake) {
      const { FakeLlm } = await import("./llm/fake.js");
      const { worldAnswers } = await import("./fixtures/world.js");
      llmFor = () => new FakeLlm(worldAnswers());
    }
    const results = await runEval(snap, setups, { freshDb: createTestDb, ...(llmFor ? { llmFor } : {}) });
    const out = values.out ?? `.eval/report-${snap.runDate}.md`;
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, renderReport(snap, results, { fake: values.fake }));
    writeFileSync(out.replace(/\.md$/, "") + ".json", JSON.stringify(results, null, 2));
    for (const r of results) console.log(`${r.setup.label.padEnd(52)} $${r.costUsd.toFixed(4)}  ${r.word ?? "no word"}`);
    console.log(`Report: ${out}`);
    break;
  }
  case "show": {
    const d = db();
    const readerId = values.reader ?? "r01";
    const row = (
      await d
        .select({ token: readers.token })
        .from(readers)
        .innerJoin(editions, and(eq(editions.readerId, readers.id), eq(editions.runDate, date)))
        .where(eq(readers.id, readerId))
    )[0];
    const view = row ? await loadEditionView(d, { readerToken: row.token, runDate: date }) : null;
    if (!view) {
      console.log(`No edition for ${readerId} on ${date}.`);
      break;
    }
    console.log(renderEditionText(view, { baseUrl: config.webBaseUrl }));
    for (const it of view.items) {
      console.log(`\n== ${it.title} (importance ${it.importance}) ==`);
      const parts: [string, VerifiedSentence[]][] = [["What happened", it.explanation.whatHappened], ["Why it matters", it.explanation.whyItMatters], ["What changes next", it.explanation.whatChangesNext]];
      for (const [label, list] of parts) {
        if (list.length) console.log(`${label}: ${list.map((s) => s.text).join(" ")}`);
      }
      console.log(`For you: ${it.stakeParagraph}`);
      console.log(`Sources: ${it.sources.map((s) => `${s.publisher} <${s.url}>`).join("; ")}`);
    }
    break;
  }
  case "deliver": {
    const d = db();
    // Email links point at WEB_BASE_URL and come from MAIL_FROM. The defaults are placeholders, and a real send
    // with them would reach readers with dead links or bounce, so refuse (decision 35).
    if (!values["dry-run"]) {
      const placeholders = [config.webBaseUrl === "https://globalgist.workers.dev" && "WEB_BASE_URL", /\.example>?$/.test(config.mailFrom) && "MAIL_FROM"].filter(Boolean);
      if (placeholders.length) throw new Error(`Set the repository variable(s) ${placeholders.join(" and ")} before delivering (docs/RUNBOOK.md, "Turn on 2DayAI").`);
    }
    const sender = values["dry-run"]
      ? async (msg: { to: string; subject: string }) => {
          console.log(`[dry-run] would send to ${msg.to}: ${msg.subject}`);
          return { id: "dry-run" };
        }
      : createResendSender(config.resendApiKey ?? (() => { throw new Error("RESEND_API_KEY is required to deliver"); })());
    console.log(await recorded(d, date, "deliver", () => runDeliver(d, config, date, sender)));
    break;
  }
  case "day": {
    const d = db();
    // After a deploy the daily workflow runs with --if-missing, so the first day appears on its own and later
    // deploys don't pay for a second run of a day that already exists, or of one a later map has replaced.
    if (values["if-missing"] && mapCovers(await latestFinishedMapDate(d), date)) {
      console.log(`The map for ${date}, or a later one, already exists. Nothing to do.`);
      break;
    }
    // --fixture: the bundled three-article day instead of live feeds, so the real model can be exercised offline.
    let deps = {};
    if (values.fixture) {
      const dir = mkdtempSync(join(tmpdir(), "2dayai-fixture-"));
      writeFileSync(join(dir, "sources.yaml"), "sources:\n  - { id: fixture-wire, name: Fixture wire, url: https://fixture.test/feed.xml, topic: tax, tier: primary }\n");
      deps = { fetchFeed: async () => FEED_XML, fetchPage: async () => "", fetchGdelt: async () => null, sourcesPath: join(dir, "sources.yaml"), readersDir: values.readers, force: values.force };
      console.log("Running against the fixture feed (three articles, two events). Fixture dates are September 3, 2026, so pass --date 2026-09-04.");
    }
    const out: Record<string, unknown> = {};
    // On GitHub Actions the run's page gets a short summary, also when a stage fails (decision 36).
    const summary = process.env["GITHUB_STEP_SUMMARY"];
    try {
      await runDay(d, config, createLlm(config, d), date, { ...deps, force: values.force }, out);
      // How much of the world the day reached, for the summary (decision 46). Places are put in regions the way the
      // local stage puts them, by the nearest listed city or town (decision 67).
      const { coverageOf } = await import("./coverage.js");
      const { Gazetteer } = await import("./places.js");
      out["coverage"] = coverageOf(await loadMapView(d, date), Gazetteer.loadWithTowns());
    } catch (err) {
      if (summary) appendFileSync(summary, daySummary(date, out, err instanceof Error ? err.message : String(err)));
      throw err;
    }
    if (summary) appendFileSync(summary, daySummary(date, out));
    // The feed list goes last: it is long, and the stage results above it are what a reader of the log wants.
    const { ingest, ...stages } = out;
    console.log(JSON.stringify({ ...stages, ingest }, null, 2));
    break;
  }
  case "feedback": {
    const d = db();
    const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const where = values.reader ? and(gte(feedback.createdAt, since), eq(feedback.readerId, values.reader)) : gte(feedback.createdAt, since);
    const rows = await d.select().from(feedback).where(where).orderBy(desc(feedback.createdAt));
    if (rows.length === 0) console.log("No feedback in the last 14 days.");
    for (const r of rows) console.log(`${r.createdAt.toISOString().slice(0, 16)}  ${r.readerId}  ${r.kind.padEnd(7)}  ${r.eventTitle}`);
    break;
  }
  case "prompt": {
    // No key, no database: the prompt file, the schema and the settings, plus the fictional day run in memory.
    const { isPromptName, playgroundView, PROMPT_CALLS, sampleInputs } = await import("./prompt-view.js");
    const name = positionals[1];
    if (!isPromptName(name)) throw new Error(`Name a prompt: ${Object.keys(PROMPT_CALLS).join(", ")}`);
    const view = playgroundView(config, name);
    const sample = (await sampleInputs(config, date)).get(name);
    console.log(`OpenAI Playground settings for ${view.label} (docs/PROMPTS.md, "Try a prompt in the Playground"):
  Model              ${view.model}
  Text format        JSON object
  Reasoning effort   ${view.reasoningEffort ?? "(not sent for this provider)"}
  Verbosity, Summary leave as they are
  Store logs         your choice; the pipeline doesn't store
  Hosted tools       all off

===== Prompt box (the system message) =====
${view.system}

===== User message: ${sample ? "a sample from the fictional world day" : "none: this call needs reader profiles, so write one by hand"} =====
${sample ?? ""}`);
    break;
  }
  case "llm check": {
    // Calls go through the real client into an in-memory database, so nothing lands in the real spend log.
    const { createTestDb } = await import("./test/db.js");
    const { z } = await import("zod");
    const { llmCalls } = await import("@2dayai/db");
    const { db: memory, close } = await createTestDb();
    const llm = createLlm(config, memory);
    const schema = z.object({ ok: z.boolean() });
    const prompt = { name: "explain", version: 0, label: "llm-check", system: 'Answer in JSON as {"ok": true}.' } as const;
    let failed = 0;
    // One call per distinct model: "explain" uses MODEL, "telegram-check" uses MODEL_TELEGRAM.
    for (const stage of [...new Map([[config.model, "explain"], [config.telegramModel, "telegram-check"]]).values()]) {
      const started = Date.now();
      try {
        await llm.parse({ stage, prompt, schema, user: "Reply ok.", effort: "low" }, date);
        const [call] = (await memory.select().from(llmCalls)).slice(-1);
        console.log(`ok    ${call?.model} in ${Date.now() - started} ms, ${call?.batch ? "flex (half price)" : "standard price"}, $${Number(call?.costUsd ?? 0).toFixed(6)}`);
      } catch (err) {
        failed++;
        console.log(`FAIL  ${stage === "explain" ? config.model : config.telegramModel}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    await close();
    if (failed) process.exit(1);
    break;
  }
  case "spend": {
    console.log(`${(await spentToday(db(), date)).toFixed(4)} USD on ${date} (ceiling ${config.dailySpendCeilingUsd.toFixed(2)})`);
    break;
  }
  default:
    console.error(command ? `Unknown command: "${command}".\n${HELP}` : HELP);
    process.exit(2);
}
// Exiting at once dropped piped output past 64 KiB, which cut the day's results off the Actions log. Wait for it.
await new Promise<void>((resolve) => process.stdout.write("", () => resolve()));
process.exit(0);
