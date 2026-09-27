import Parser from "rss-parser";
import { eq } from "drizzle-orm";
import { ArticleSchema, ingestWindow, type Article, type RunDate, type Source } from "@2dayai/core";
import { articles, sources as sourcesTable, type Db } from "@2dayai/db";

const parser = new Parser({ timeout: 20_000, headers: { "User-Agent": "2dayai/0.1 (+https://github.com/hzsl777/capy)" } });

export type FeedFetcher = (url: string) => Promise<string>;

export const defaultFetcher: FeedFetcher = async (url) => {
  const res = await fetch(url, { headers: { "User-Agent": "2dayai/0.1 (+https://github.com/hzsl777/capy)" }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.text();
};

function stripHtml(s: string | undefined): string {
  return (s ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

/** Pure: turns one feed document into articles inside the run date's window. No network, no database. */
export async function articlesFromFeed(source: Source, xml: string, date: RunDate): Promise<Article[]> {
  const feed = await parser.parseString(xml);
  const { from, to } = ingestWindow(date);
  const out: Article[] = [];
  for (const item of feed.items) {
    const link = item.link?.trim();
    const title = stripHtml(item.title);
    if (!link || !title) continue;
    const published = item.isoDate ? new Date(item.isoDate) : item.pubDate ? new Date(item.pubDate) : undefined;
    if (!published || Number.isNaN(published.getTime())) continue;
    if (published < from || published >= to) continue;
    const parsed = ArticleSchema.safeParse({
      sourceId: source.id,
      url: link,
      title,
      lead: stripHtml(item.contentSnippet ?? item.summary).slice(0, 600),
      body: stripHtml(item["content:encoded"] ?? item.content),
      publishedAt: published,
    });
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

export type IngestReport = { source: string; fetched: number; inserted: number; error?: string };

/** Stage 6.1. Idempotent per date: re-running upserts by URL and inserts nothing twice. */
export async function runIngest(db: Db, sources: Source[], date: RunDate, fetchFeed: FeedFetcher = defaultFetcher): Promise<IngestReport[]> {
  const reports: IngestReport[] = [];
  for (const source of sources) {
    await db.insert(sourcesTable).values(source).onConflictDoUpdate({ target: sourcesTable.id, set: { name: source.name, url: source.url, topic: source.topic, tier: source.tier } });
    try {
      const xml = await fetchFeed(source.url);
      const found = await articlesFromFeed(source, xml, date);
      let inserted = 0;
      for (const a of found) {
        const r = await db.insert(articles).values(a).onConflictDoNothing({ target: articles.url }).returning({ id: articles.id });
        inserted += r.length;
      }
      reports.push({ source: source.id, fetched: found.length, inserted });
    } catch (err) {
      reports.push({ source: source.id, fetched: 0, inserted: 0, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return reports;
}

/** `sources check`: fetch every feed and report, without a database. For Davis to run locally on the starter list. */
export async function checkSources(sources: Source[], date: RunDate, fetchFeed: FeedFetcher = defaultFetcher): Promise<IngestReport[]> {
  const reports: IngestReport[] = [];
  for (const source of sources) {
    try {
      const xml = await fetchFeed(source.url);
      const found = await articlesFromFeed(source, xml, date);
      reports.push({ source: source.id, fetched: found.length, inserted: 0 });
    } catch (err) {
      reports.push({ source: source.id, fetched: 0, inserted: 0, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return reports;
}

export async function countArticlesForSource(db: Db, sourceId: string): Promise<number> {
  const rows = await db.select({ id: articles.id }).from(articles).where(eq(articles.sourceId, sourceId));
  return rows.length;
}
