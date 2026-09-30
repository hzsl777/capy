// The daily run's page on GitHub Actions (decision 36): the word, the counts, the spend and the feeds that need a
// person, readable in a minute without opening the logs.
import { MOOD_BAND_LABEL, type RunDate } from "@2dayai/core";
import type { Coverage } from "./coverage.js";
import type { WorldClusterReport } from "./stages/cluster.js";
import type { ExplainReport } from "./stages/explain.js";
import type { IngestReport } from "./stages/ingest.js";
import type { LocalReport } from "./stages/local.js";
import type { PruneReport } from "./stages/prune.js";
import type { SelectReport } from "./stages/select.js";
import type { TelegramReport } from "./stages/telegram.js";

/** Rows per feed table, so a bad network day doesn't write a page nobody reads. */
const MAX_ROWS = 40;

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ").slice(0, 160);

export function daySummary(date: RunDate, out: Record<string, unknown>, failure?: string): string {
  const ingest = (out["ingest"] as IngestReport[] | undefined) ?? [];
  const world = out["clusterWorld"] as WorldClusterReport | undefined;
  const explain = out["explain"] as ExplainReport | undefined;
  const select = out["select"] as SelectReport | undefined;
  const telegram = out["telegram"] as TelegramReport | undefined;
  const prune = out["prune"] as PruneReport | undefined;
  const spend = out["spendUsd"] as number | undefined;
  const coverage = out["coverage"] as Coverage | undefined;
  const local = out["local"] as (LocalReport & { error?: string }) | undefined;
  const lines = [`## GlobalGist, ${date}`, ""];

  if (failure) lines.push(`**The run failed.** ${cell(failure)}`, "", "The site keeps showing the last good day. Stages that finished are listed below.", "");
  if (telegram?.written) {
    const split = telegram.split ? `, runs disagreed on ${telegram.split} of ${telegram.candidates} events` : "";
    const aside = telegram.rejected ? `, ${telegram.rejected} run${telegram.rejected === 1 ? "" : "s"} set aside for breaking the rules` : "";
    lines.push(`Word: **${telegram.word}** (band ${telegram.band}, ${MOOD_BAND_LABEL[telegram.band!]}). Scored ${telegram.scoreRuns} times${split}${aside}.`);
  } else if (telegram) lines.push(`No word today: ${telegram.reason ?? "nothing to score"}.`);

  const ok = ingest.filter((r) => !r.error);
  const failed = ingest.filter((r) => r.error && !r.paused);
  const paused = ingest.filter((r) => r.paused);
  if (ingest.length) lines.push(`Feeds: ${ok.length} read, ${failed.length} failed, ${paused.length} paused. ${ok.reduce((n, r) => n + r.inserted, 0)} new articles.`);
  if (world) lines.push(`Stories: ${world.events} from ${world.articles} articles in ${world.batches} grouping calls, ${world.placed ?? 0} placed where they happened.`);
  if (local?.error) lines.push(`Local stories: none today. ${cell(local.error)}`);
  else if (local && !local.skipped) {
    const added = local.regionsAdded ? `, and ${local.regionsAdded} regions outlets reached` : "";
    const over = local.overMax ? `, ${local.overMax} more left out by GDELT_MAX` : "";
    const unreadable = local.filesFailed ? `, ${local.filesFailed} of ${local.files} files unreadable` : "";
    lines.push(`Local stories: ${local.stories} from GDELT in ${local.towns ?? local.stories} towns: ${local.regionsFilled} of ${local.regionsEmpty} regions no outlet reached${added}${over}${unreadable}.`);
  }
  if (coverage) lines.push(`Coverage: stories in ${coverage.countries} of ${coverage.countriesTotal} countries and territories, and ${coverage.regions} of ${coverage.regionsTotal} regions.`);
  if (explain) lines.push(`Explained: ${explain.usable} of ${explain.events}${explain.failed ? `, ${explain.failed} failed` : ""}.`);
  if (select && select.readers > 0) lines.push(`2DayAI: ${select.editions} editions and ${select.quiet} quiet days for ${select.readers} readers${select.failed ? `, ${select.failed} failed` : ""}.`);
  if (spend !== undefined) lines.push(`Model spend: $${spend.toFixed(3)}.`);
  if (prune) lines.push(`Cleanup: removed ${prune.events} events and ${prune.articles} articles from before ${prune.cutoff}.`);

  if (failed.length) {
    lines.push("", "### Feeds that failed", "", "A feed failing 7 days running is paused and retried on Sundays. Fix or replace it in config/sources.yaml.", "", "| Source | Days failing | Error |", "|---|---|---|");
    const worst = [...failed].sort((a, b) => (b.failedDays ?? 0) - (a.failedDays ?? 0));
    for (const r of worst.slice(0, MAX_ROWS)) lines.push(`| ${r.source} | ${r.failedDays ?? 1} | ${cell(r.error!)} |`);
    if (worst.length > MAX_ROWS) lines.push("", `And ${worst.length - MAX_ROWS} more; see the log.`);
  }
  if (coverage?.missing.length) lines.push("", "### Countries and territories with no story today", "", coverage.missing.join(", "));
  if (paused.length) lines.push("", "### Paused feeds", "", paused.map((r) => `${r.source} (${r.failedDays} days)`).join(", "));
  const found = ok.filter((r) => r.feedUrl);
  if (found.length) {
    lines.push("", "### Feeds found behind a homepage", "", "These are remembered, so nothing breaks. Putting the URL in config/sources.yaml saves one fetch a day.", "", "| Source | Feed |", "|---|---|");
    for (const r of found.slice(0, MAX_ROWS)) lines.push(`| ${r.source} | ${cell(r.feedUrl!)} |`);
    if (found.length > MAX_ROWS) lines.push("", `And ${found.length - MAX_ROWS} more; see the log.`);
  }
  return `${lines.join("\n")}\n`;
}
