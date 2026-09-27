// Stage 6.2. One model call groups the day's articles into events. Idempotent per date: existing events for the date
// are deleted first, and the cascade removes everything derived from them.
import { and, eq, gte, isNotNull, lt } from "drizzle-orm";
import { ClusterResultSchema, ingestWindow, type RunDate } from "@2dayai/core";
import { loadPrompt } from "../prompts.js";
import { articles, editions, eventArticles, events, sources, type Db } from "@2dayai/db";
import type { Config } from "../config.js";
import type { Llm } from "../llm/types.js";

export const CLUSTER_PROMPT_VERSION = 1;
const BODY_CHARS_FOR_CLUSTERING = 900;

export type ClusterReport = { articles: number; events: number; skipped: number; unknownIds: number; unassigned: number };

export function clusterUserContent(rows: { id: number; source: string; tier: string; title: string; lead: string; body: string }[]): string {
  const lines = rows.map((r) => {
    const text = (r.body || r.lead).slice(0, BODY_CHARS_FOR_CLUSTERING);
    return `[${r.id}] ${r.title}\nsource: ${r.source} (${r.tier})\n${text}`;
  });
  return `Articles for today, ${rows.length} in total. Each starts with its id in brackets.\n\n${lines.join("\n\n")}`;
}

export async function runCluster(db: Db, config: Config, llm: Llm, date: RunDate, opts: { force?: boolean } = {}): Promise<ClusterReport> {
  // Re-clustering deletes the date's events, and with them the items of any edition already in a reader's inbox.
  const sent = await db.select({ id: editions.id }).from(editions).where(and(eq(editions.runDate, date), isNotNull(editions.sentAt)));
  if (sent.length > 0 && !opts.force) throw new Error(`cluster: ${sent.length} edition(s) for ${date} were already sent; pass --force to re-cluster anyway and break their links`);
  const { from, to } = ingestWindow(date);
  const rows = await db
    .select({ id: articles.id, source: sources.name, tier: sources.tier, title: articles.title, lead: articles.lead, body: articles.body })
    .from(articles)
    .innerJoin(sources, eq(sources.id, articles.sourceId))
    .where(and(gte(articles.publishedAt, from), lt(articles.publishedAt, to)));

  await db.delete(events).where(eq(events.runDate, date));
  if (rows.length === 0) return { articles: 0, events: 0, skipped: 0, unknownIds: 0, unassigned: 0 };

  const prompt = loadPrompt("cluster", CLUSTER_PROMPT_VERSION);
  const result = await llm.parse({ stage: "cluster", prompt, schema: ClusterResultSchema, user: clusterUserContent(rows), effort: config.effort.cluster }, date);

  const known = new Set(rows.map((r) => r.id));
  const assigned = new Set<number>();
  let unknownIds = 0;
  let written = 0;
  for (const ev of result.events) {
    const ids = ev.articleIds.filter((id) => {
      if (!known.has(id)) {
        unknownIds += 1;
        return false;
      }
      if (assigned.has(id)) return false;
      return true;
    });
    if (ids.length === 0) continue;
    ids.forEach((id) => assigned.add(id));
    const [row] = await db
      .insert(events)
      .values({ runDate: date, title: ev.title, importance: ev.importance, importanceReason: ev.importanceReason, promptVersion: prompt.label })
      .returning({ id: events.id });
    await db.insert(eventArticles).values(ids.map((articleId) => ({ eventId: row!.id, articleId })));
    written += 1;
  }
  const skipped = result.skipped.filter((s) => known.has(s.articleId)).length;
  const unassigned = rows.filter((r) => !assigned.has(r.id) && !result.skipped.some((s) => s.articleId === r.id)).length;
  return { articles: rows.length, events: written, skipped, unknownIds, unassigned };
}
