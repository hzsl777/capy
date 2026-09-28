// Entry point. `npm run stage -- <command> [--date YYYY-MM-DD]`. Each stage is re-runnable per date (spec decision 6).
import { parseArgs } from "node:util";
import { placeIdFor, renderEditionText, todayRunDate, toRunDate, WORLD_TOPICS, type MapFile, type VerifiedSentence, type WorldTopic } from "@2dayai/core";
import { editions, feedback, latestMapDate, loadEditionView, loadMapView, readers } from "@2dayai/db";
import { createDb } from "@2dayai/db/node";
import { and, desc, eq, gte } from "drizzle-orm";
import { loadConfig, requireDatabaseUrl } from "./config.js";
import { runDay } from "./day.js";
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
import { FEED_XML } from "./fixtures/day.js";
import { existsSync, readFileSync, writeFileSync, mkdtempSync, mkdirSync } from "node:fs";
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
    out: { type: "string" },
    in: { type: "string" },
    setups: { type: "string" },
    snapshot: { type: "string" },
    fake: { type: "boolean", default: false },
  },
});

const command = positionals.join(" ");
const date = values.date ? toRunDate(values.date) : todayRunDate();
const config = loadConfig();

function printReports(reports: IngestReport[]): void {
  for (const r of reports) {
    const status = r.error ? `FAIL ${r.error}` : `ok fetched=${r.fetched} inserted=${r.inserted}`;
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
  telegram               score the day's world events and pick the one-word mood (model, two calls)
  map export [--out f]   the public map's data for the date (default: latest) as JSON
  map headlines --in f   real headlines gathered by hand or search (JSON) into a demo map file, no model, no database
  demo [--out f]         the fictional world fixture through the real stages, in memory, into the map's sample data
  eval [--setups s]      compare models on one day's world articles: cost, the code checks, every score (decision 28)
                         --snapshot f reuses a saved day; --fixture uses the fictional day; --fake skips the model
  show [--reader r01]    print a reader's edition for the date
  deliver [--dry-run]    send unsent editions whose delivery hour has arrived
  day [--fixture]        ingest, enrich, readers sync, cluster, cluster world, explain, select, telegram
  spend                  model spend for the date
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
    console.log(await recorded(d, date, "cluster-world", () => runClusterWorld(d, config, createLlm(config, d), date)));
    break;
  }
  case "telegram": {
    const d = db();
    console.log(await recorded(d, date, "telegram", () => runTelegram(d, config, createLlm(config, d), date)));
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
      note: `Demo: real headlines found by web search on ${when}, not through the daily pipeline. Times are when they were collected. There are no summaries, explanations or word yet.`,
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
    const day = values.date ?? (await latestMapDate(d));
    if (!day) {
      console.error("No world-desk run yet; nothing to export.");
      process.exit(1);
    }
    const map = await loadMapView(d, day);
    const out = values.out ?? "packages/map/public/data/latest.json";
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(map));
    console.log(`${out}: ${map.items.length} items, ${map.places.length} places, ${Object.keys(map.events).length} explained events, telegram ${map.telegram ? `"${map.telegram.word}"` : "none"}`);
    break;
  }
  case "demo": {
    // Everything real except the model and the network: PGlite, the migrations, every stage, every validator,
    // the read model. The model answers from the fictional world fixture's script.
    const { createTestDb } = await import("./test/db.js");
    const { FakeLlm } = await import("./llm/fake.js");
    const { worldAnswers, worldFeedFor, worldSourcesYaml } = await import("./fixtures/world.js");
    const { db: memory, close } = await createTestDb();
    const dir = mkdtempSync(join(tmpdir(), "capy-demo-"));
    writeFileSync(join(dir, "sources.yaml"), worldSourcesYaml());
    const report = await runDay(memory, config, new FakeLlm(worldAnswers()), date, {
      fetchFeed: async (url) => worldFeedFor(url, date),
      fetchPage: async () => "",
      sourcesPath: join(dir, "sources.yaml"),
      readersDir: dir,
    });
    const map = { ...(await loadMapView(memory, date)), source: "sample" as const };
    await close();
    const out = values.out ?? "packages/map/public/data/sample.json";
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(map));
    console.log(JSON.stringify({ clusterWorld: report["clusterWorld"], explain: report["explain"], telegram: report["telegram"] }));
    console.log(`${out}: ${map.items.length} items, ${map.places.length} places, telegram ${map.telegram ? `"${map.telegram.word}"` : "none"}`);
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
    // --fixture: the bundled three-article day instead of live feeds, so the real model can be exercised offline.
    let deps = {};
    if (values.fixture) {
      const dir = mkdtempSync(join(tmpdir(), "2dayai-fixture-"));
      writeFileSync(join(dir, "sources.yaml"), "sources:\n  - { id: fixture-wire, name: Fixture wire, url: https://fixture.test/feed.xml, topic: tax, tier: primary }\n");
      deps = { fetchFeed: async () => FEED_XML, fetchPage: async () => "", sourcesPath: join(dir, "sources.yaml"), readersDir: values.readers, force: values.force };
      console.log("Running against the fixture feed (three articles, two events). Fixture dates are September 3, 2026, so pass --date 2026-09-04.");
    }
    const out = await runDay(d, config, createLlm(config, d), date, { ...deps, force: values.force });
    console.log(JSON.stringify(out, null, 2));
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
  case "spend": {
    console.log(`${(await spentToday(db(), date)).toFixed(4)} USD on ${date} (ceiling ${config.dailySpendCeilingUsd.toFixed(2)})`);
    break;
  }
  default:
    console.error(command ? `Unknown command: "${command}".\n${HELP}` : HELP);
    process.exit(2);
}
process.exit(0);
