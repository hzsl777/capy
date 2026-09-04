// Entry point. `npm run stage -- <command> [--date YYYY-MM-DD]`. Each stage is re-runnable per date (spec decision 6).
import { parseArgs } from "node:util";
import { todayRunDate, toRunDate } from "@2dayai/core";
import { createDb } from "@2dayai/db";
import { loadConfig, requireDatabaseUrl } from "./config.js";
import { loadSources } from "./sources.js";
import { checkSources, runIngest, type IngestReport } from "./stages/ingest.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { date: { type: "string" }, sources: { type: "string", default: "config/sources.yaml" } },
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

switch (command) {
  case "sources check": {
    printReports(await checkSources(loadSources(values.sources), date));
    break;
  }
  case "ingest": {
    const db = createDb(requireDatabaseUrl(config));
    printReports(await runIngest(db, loadSources(values.sources), date));
    process.exit(0);
  }
  case "day": {
    // Milestone 0 runs ingest only. Cluster, explain, select, and deliver join here at milestones 1 to 3.
    const db = createDb(requireDatabaseUrl(config));
    printReports(await runIngest(db, loadSources(values.sources), date));
    process.exit(0);
  }
  default:
    console.error(`Unknown command: "${command}". Commands: sources check | ingest | day. Options: --date YYYY-MM-DD --sources path`);
    process.exit(2);
}
