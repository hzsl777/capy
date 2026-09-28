// The whole day in order. Each stage is recorded and re-runnable on its own (spec decision 6).
import type { RunDate } from "@2dayai/core";
import type { Db } from "@2dayai/db";
import type { Config } from "./config.js";
import type { Llm } from "./llm/types.js";
import { spentToday } from "./llm/spend.js";
import { loadProfiles, syncReaders } from "./profiles.js";
import { recorded } from "./runs.js";
import { loadSources } from "./sources.js";
import { runCluster, runClusterWorld } from "./stages/cluster.js";
import { runEnrich, type PageFetcher } from "./stages/enrich.js";
import { explainArticleIds, runExplain } from "./stages/explain.js";
import { runIngest, type FeedFetcher } from "./stages/ingest.js";
import { runPrune } from "./stages/prune.js";
import { runSelect } from "./stages/select.js";
import { runTelegram } from "./stages/telegram.js";

export type DayDeps = { fetchFeed?: FeedFetcher; fetchPage?: PageFetcher; sourcesPath?: string; readersDir?: string; force?: boolean };

/** `out` fills as stages finish, so a caller still has the finished ones when a later stage throws. */
export async function runDay(db: Db, config: Config, llm: Llm, date: RunDate, deps: DayDeps = {}, out: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  out["ingest"] = await recorded(db, date, "ingest", () => runIngest(db, loadSources(deps.sourcesPath), date, deps.fetchFeed));
  const readers = await recorded(db, date, "readers", () => syncReaders(db, loadProfiles(deps.readersDir)));
  out["readers"] = readers;
  // 2DayAI's briefing exists for readers. With no reader profiles its grouping and explanations would be spend
  // for no one, so the map's world desk runs alone (decision 33).
  if (readers.length > 0) {
    out["enrichBriefing"] = await recorded(db, date, "enrich-briefing", () => runEnrich(db, date, deps.fetchPage, 4, { desk: "briefing" }));
    out["cluster"] = await recorded(db, date, "cluster", () => runCluster(db, config, llm, date, { force: deps.force ?? false }));
  } else {
    out["cluster"] = { skipped: "no reader profiles" };
  }
  out["clusterWorld"] = await recorded(db, date, "cluster-world", () => runClusterWorld(db, config, llm, date));
  // Pages are fetched only for the articles explain will quote, not every article of the day.
  out["enrich"] = await recorded(db, date, "enrich", async () => runEnrich(db, date, deps.fetchPage, 4, { articleIds: await explainArticleIds(db, config, date) }));
  out["explain"] = await recorded(db, date, "explain", () => runExplain(db, config, llm, date));
  out["select"] = await recorded(db, date, "select", () => runSelect(db, config, llm, date));
  out["telegram"] = await recorded(db, date, "telegram", () => runTelegram(db, config, llm, date));
  // Last, so a failed prune never costs the day its map.
  out["prune"] = await recorded(db, date, "prune", () => runPrune(db, date, config.worldRetentionDays));
  out["spendUsd"] = await spentToday(db, date);
  return out;
}
