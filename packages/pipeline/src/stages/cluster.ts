// Stage 6.2. One model call groups the day's articles into events. Idempotent per date: existing events for the date
// are deleted first, and the cascade removes everything derived from them.
import { and, desc, eq, gte, isNotNull, lt } from "drizzle-orm";
import { ClusterResultSchema, ingestWindow, WorldClusterResultSchema, type RunDate } from "@2dayai/core";
import { loadPrompt } from "../prompts.js";
import { articles, editions, eventArticles, events, sources, telegrams, type Db } from "@2dayai/db";
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
    .where(and(eq(sources.desk, "briefing"), gte(articles.publishedAt, from), lt(articles.publishedAt, to)));

  await db.delete(events).where(and(eq(events.runDate, date), eq(events.desk, "briefing")));
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

/* The world desk (decision 25): same job, its own prompt, and a topic per event for the map's filters. */

export const CLUSTER_WORLD_PROMPT_VERSION = 1;
/** Newest articles kept per world source per day, so one prolific feed cannot crowd the call. */
export const WORLD_ARTICLES_PER_SOURCE = 25;
const WORLD_CHARS_FOR_CLUSTERING = 400;

export type WorldClusterReport = ClusterReport & { byTopic: Record<string, number> };

export function worldClusterUserContent(rows: { id: number; source: string; place: string; title: string; lead: string }[]): string {
  const lines = rows.map((r) => `[${r.id}] ${r.title}\nsource: ${r.source}, publishing from ${r.place}\n${r.lead.slice(0, WORLD_CHARS_FOR_CLUSTERING)}`);
  return `World articles for today, ${rows.length} in total. Each starts with its id in brackets.\n\n${lines.join("\n\n")}`;
}

export async function runClusterWorld(db: Db, config: Config, llm: Llm, date: RunDate): Promise<WorldClusterReport> {
  const { from, to } = ingestWindow(date);
  const all = await db
    .select({ id: articles.id, sourceId: sources.id, source: sources.name, place: sources.placeName, title: articles.title, lead: articles.lead })
    .from(articles)
    .innerJoin(sources, eq(sources.id, articles.sourceId))
    .where(and(eq(sources.desk, "world"), gte(articles.publishedAt, from), lt(articles.publishedAt, to)))
    .orderBy(desc(articles.publishedAt));
  const perSource = new Map<string, number>();
  const rows = all
    .filter((r) => {
      const n = (perSource.get(r.sourceId) ?? 0) + 1;
      perSource.set(r.sourceId, n);
      return n <= WORLD_ARTICLES_PER_SOURCE;
    })
    .map((r) => ({ id: r.id, source: r.source, place: r.place ?? "unknown", title: r.title, lead: r.lead }));

  // The telegram is written from these events; re-clustering makes any old telegram for the date stale.
  await db.delete(telegrams).where(eq(telegrams.runDate, date));
  await db.delete(events).where(and(eq(events.runDate, date), eq(events.desk, "world")));
  const empty = { articles: 0, events: 0, skipped: 0, unknownIds: 0, unassigned: 0, byTopic: {} };
  if (rows.length === 0) return empty;

  const prompt = loadPrompt("cluster-world", CLUSTER_WORLD_PROMPT_VERSION);
  const result = await llm.parse({ stage: "cluster-world", prompt, schema: WorldClusterResultSchema, user: worldClusterUserContent(rows), effort: config.effort.cluster }, date);

  const known = new Set(rows.map((r) => r.id));
  const assigned = new Set<number>();
  const byTopic: Record<string, number> = {};
  let unknownIds = 0;
  let written = 0;
  for (const ev of result.events) {
    const ids = ev.articleIds.filter((id) => {
      if (!known.has(id)) {
        unknownIds += 1;
        return false;
      }
      return !assigned.has(id);
    });
    if (ids.length === 0) continue;
    ids.forEach((id) => assigned.add(id));
    const [row] = await db
      .insert(events)
      .values({ runDate: date, title: ev.title, importance: ev.importance, importanceReason: ev.importanceReason, promptVersion: prompt.label, desk: "world", topic: ev.topic })
      .returning({ id: events.id });
    await db.insert(eventArticles).values(ids.map((articleId) => ({ eventId: row!.id, articleId })));
    byTopic[ev.topic] = (byTopic[ev.topic] ?? 0) + 1;
    written += 1;
  }
  const skipped = result.skipped.filter((s) => known.has(s.articleId)).length;
  const unassigned = rows.filter((r) => !assigned.has(r.id) && !result.skipped.some((s) => s.articleId === r.id)).length;
  return { articles: rows.length, events: written, skipped, unknownIds, unassigned, byTopic };
}
