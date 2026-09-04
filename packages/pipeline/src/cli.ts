// Entry point. `npm run stage -- <command> [--date YYYY-MM-DD]`. Each stage is re-runnable per date (spec decision 6).
import { parseArgs } from "node:util";
import { renderEditionText, todayRunDate, toRunDate, type VerifiedSentence } from "@2dayai/core";
import { editions, loadEditionView, readers } from "@2dayai/db";
import { createDb } from "@2dayai/db/node";
import { and, eq } from "drizzle-orm";
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

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    date: { type: "string" },
    sources: { type: "string", default: "config/sources.yaml" },
    readers: { type: "string", default: "config/readers" },
    reader: { type: "string" },
    "dry-run": { type: "boolean", default: false },
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
  cluster                group the day's articles into events (model)
  explain                explain each event with verified citations (model, batched)
  select                 one edition per reader with the headline (model, batched)
  show [--reader r01]    print a reader's edition for the date
  deliver [--dry-run]    send unsent editions whose delivery hour has arrived
  day                    ingest, enrich, readers sync, cluster, explain, select
  spend                  model spend for the date
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
    console.log(await recorded(d, date, "cluster", () => runCluster(d, config, createLlm(config, d), date)));
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
    const out = await runDay(d, config, createLlm(config, d), date);
    console.log(JSON.stringify(out, null, 2));
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
