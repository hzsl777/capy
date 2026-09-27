// Entry point. `npm run stage -- <command> [--date YYYY-MM-DD]`. Each stage is re-runnable per date (spec decision 6).
import { parseArgs } from "node:util";
import { renderEditionText, todayRunDate, toRunDate, type VerifiedSentence } from "@2dayai/core";
import { editions, feedback, loadEditionView, readers } from "@2dayai/db";
import { createDb } from "@2dayai/db/node";
import { and, desc, eq, gte } from "drizzle-orm";
import { loadConfig, requireDatabaseUrl } from "./config.js";
import { runDay } from "./day.js";
import { createLlm } from "./llm/client.js";
import { spentToday } from "./llm/spend.js";
import { createResendSender } from "./mail.js";
import { loadProfiles, syncReaders } from "./profiles.js";
import { recorded } from "./runs.js";
import { loadSources } from "./sources.js";
import { runCluster } from "./stages/cluster.js";
import { runDeliver } from "./stages/deliver.js";
import { runEnrich } from "./stages/enrich.js";
import { runExplain } from "./stages/explain.js";
import { checkSources, runIngest, type IngestReport } from "./stages/ingest.js";
import { runSelect } from "./stages/select.js";
import { FEED_XML } from "./fixtures/day.js";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  show [--reader r01]    print a reader's edition for the date
  deliver [--dry-run]    send unsent editions whose delivery hour has arrived
  day [--fixture]        ingest, enrich, readers sync, cluster, explain, select (fixture: bundled feed, real model)
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
