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
import { runExplain } from "./stages/explain.js";
import { runIngest, type FeedFetcher } from "./stages/ingest.js";
import { runSelect } from "./stages/select.js";
import { runTelegram } from "./stages/telegram.js";

export type DayDeps = { fetchFeed?: FeedFetcher; fetchPage?: PageFetcher; sourcesPath?: string; readersDir?: string; force?: boolean };

export async function runDay(db: Db, config: Config, llm: Llm, date: RunDate, deps: DayDeps = {}): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  out["ingest"] = await recorded(db, date, "ingest", () => runIngest(db, loadSources(deps.sourcesPath), date, deps.fetchFeed));
  out["enrich"] = await recorded(db, date, "enrich", () => runEnrich(db, date, deps.fetchPage));
  out["readers"] = await recorded(db, date, "readers", () => syncReaders(db, loadProfiles(deps.readersDir)));
  out["cluster"] = await recorded(db, date, "cluster", () => runCluster(db, config, llm, date, { force: deps.force ?? false }));
  out["clusterWorld"] = await recorded(db, date, "cluster-world", () => runClusterWorld(db, config, llm, date));
  out["explain"] = await recorded(db, date, "explain", () => runExplain(db, config, llm, date));
  out["select"] = await recorded(db, date, "select", () => runSelect(db, config, llm, date));
  out["telegram"] = await recorded(db, date, "telegram", () => runTelegram(db, config, llm, date));
  out["spendUsd"] = await spentToday(db, date);
  return out;
}
