// Keeps the database inside Neon's free 0.5 GB with no one watching it (decision 34). The map shows recent days
// only, and article text is needed only on the day explain quotes it. 2DayAI's briefing history is not touched.
import { and, eq, inArray, lt, ne, notExists, sql } from "drizzle-orm";
import { ingestWindow, type RunDate } from "@2dayai/core";
import { articles, citations, eventArticles, events, sources, telegrams, type Db } from "@2dayai/db";

/** Article text is dropped after this many days. It is most of the stored bytes. */
export const BODY_DAYS = 2;

export type PruneReport = { cutoff: string; telegrams: number; events: number; articles: number; bodiesCleared: number };

function daysBefore(date: RunDate, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export async function runPrune(db: Db, date: RunDate, retentionDays: number): Promise<PruneReport> {
  const cutoff = daysBefore(date, retentionDays);
  const cutoffTime = ingestWindow(cutoff as RunDate).from;
  const worldSources = db.select({ id: sources.id }).from(sources).where(eq(sources.desk, "world"));

  // Telegrams first; their items and scores cascade. Then world events, whose links, explanations and
  // citations cascade.
  const t = await db.delete(telegrams).where(lt(telegrams.runDate, cutoff)).returning({ id: telegrams.id });
  const e = await db
    .delete(events)
    .where(and(eq(events.desk, "world"), lt(events.runDate, cutoff)))
    .returning({ id: events.id });
  // World articles older than the cutoff that nothing still points to.
  const a = await db
    .delete(articles)
    .where(
      and(
        inArray(articles.sourceId, worldSources),
        lt(articles.publishedAt, cutoffTime),
        notExists(db.select({ x: sql`1` }).from(eventArticles).where(eq(eventArticles.articleId, articles.id))),
        notExists(db.select({ x: sql`1` }).from(citations).where(eq(citations.articleId, articles.id))),
      ),
    )
    .returning({ id: articles.id });
  // Recent world articles keep their headline and summary but lose the fetched page text.
  const b = await db
    .update(articles)
    .set({ body: "" })
    .where(and(inArray(articles.sourceId, worldSources), lt(articles.publishedAt, ingestWindow(daysBefore(date, BODY_DAYS) as RunDate).from), ne(articles.body, "")))
    .returning({ id: articles.id });
  return { cutoff, telegrams: t.length, events: e.length, articles: a.length, bodiesCleared: b.length };
}
