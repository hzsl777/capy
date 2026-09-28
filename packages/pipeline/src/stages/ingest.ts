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

const looksLikeFeed = (text: string) => /<(rss|feed|rdf:RDF)[\s>]/i.test(text.slice(0, 4000));

/** Feed links a page declares for itself: <link rel="alternate" type="application/rss+xml" href="...">. */
export function feedLinksIn(html: string, pageUrl: string): string[] {
  const out: string[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const attr = (name: string) => new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i").exec(tag)?.[1];
    if (!/alternate/i.test(attr("rel") ?? "") || !/application\/(rss|atom)\+xml/i.test(attr("type") ?? "")) continue;
    const href = attr("href");
    if (!href) continue;
    try {
      out.push(new URL(href.replace(/&amp;/g, "&"), pageUrl).toString());
    } catch {
      // A malformed href is skipped, not guessed at.
    }
  }
  return [...new Set(out)];
}

/** Paths many sites serve a feed from, tried only when a page declares none. Each answer is checked. */
const COMMON_FEED_PATHS = ["/feed/", "/rss", "/rss.xml", "/feed.xml", "/index.xml"];

/**
 * The configured URL's feed. When it answers with a web page instead (a homepage in sources.yaml), the feed the
 * page links to, or one at a common path. Only a response that parses as RSS or Atom counts (decision 31).
 */
export async function fetchFeedDocument(url: string, fetchFeed: FeedFetcher): Promise<{ xml: string; feedUrl: string }> {
  const first = await fetchFeed(url);
  if (looksLikeFeed(first)) return { xml: first, feedUrl: url };
  const declared = feedLinksIn(first, url);
  const origin = new URL(url).origin;
  const candidates = declared.length ? declared.slice(0, 3) : COMMON_FEED_PATHS.map((p) => origin + p);
  for (const candidate of candidates) {
    try {
      const text = await fetchFeed(candidate);
      if (looksLikeFeed(text)) return { xml: text, feedUrl: candidate };
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error(declared.length ? `page links to ${declared.length} feed(s), none answered` : "not a feed, and the page links to none");
}

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

/** feedUrl is set when the feed was found through the configured page, so sources.yaml can be updated. */
export type IngestReport = { source: string; fetched: number; inserted: number; feedUrl?: string; error?: string };

/** Feeds fetched at once. Hundreds of outlets one after another could take an hour on a slow day. */
const INGEST_CONCURRENCY = 8;

async function inPool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]!);
    }),
  );
}

/** Stage 6.1. Idempotent per date: re-running upserts by URL and inserts nothing twice. */
export async function runIngest(db: Db, sources: Source[], date: RunDate, fetchFeed: FeedFetcher = defaultFetcher): Promise<IngestReport[]> {
  const reports = new Map<string, IngestReport>();
  await inPool(sources, INGEST_CONCURRENCY, async (source) => {
    const row = {
      name: source.name,
      url: source.url,
      topic: source.topic,
      tier: source.tier,
      desk: source.desk,
      placeName: source.place?.name ?? null,
      lat: source.place?.lat ?? null,
      lon: source.place?.lon ?? null,
      lang: source.lang,
    };
    await db.insert(sourcesTable).values({ id: source.id, ...row }).onConflictDoUpdate({ target: sourcesTable.id, set: row });
    try {
      const { xml, feedUrl } = await fetchFeedDocument(source.url, fetchFeed);
      const found = await articlesFromFeed(source, xml, date);
      let inserted = 0;
      for (const a of found) {
        const r = await db.insert(articles).values(a).onConflictDoNothing({ target: articles.url }).returning({ id: articles.id });
        inserted += r.length;
      }
      reports.set(source.id, { source: source.id, fetched: found.length, inserted, ...(feedUrl !== source.url ? { feedUrl } : {}) });
    } catch (err) {
      reports.set(source.id, { source: source.id, fetched: 0, inserted: 0, error: err instanceof Error ? err.message : String(err) });
    }
  });
  return sources.map((s) => reports.get(s.id)!);
}

/** `sources check`: fetch every feed and report, without a database. For Davis to run locally on the starter list. */
export async function checkSources(sources: Source[], date: RunDate, fetchFeed: FeedFetcher = defaultFetcher): Promise<IngestReport[]> {
  const reports = new Map<string, IngestReport>();
  await inPool(sources, INGEST_CONCURRENCY, async (source) => {
    try {
      const { xml, feedUrl } = await fetchFeedDocument(source.url, fetchFeed);
      const found = await articlesFromFeed(source, xml, date);
      reports.set(source.id, { source: source.id, fetched: found.length, inserted: 0, ...(feedUrl !== source.url ? { feedUrl } : {}) });
    } catch (err) {
      reports.set(source.id, { source: source.id, fetched: 0, inserted: 0, error: err instanceof Error ? err.message : String(err) });
    }
  });
  return sources.map((s) => reports.get(s.id)!);
}

export async function countArticlesForSource(db: Db, sourceId: string): Promise<number> {
  const rows = await db.select({ id: articles.id }).from(articles).where(eq(articles.sourceId, sourceId));
  return rows.length;
}
