import Parser from "rss-parser";
import { and, eq, inArray, like } from "drizzle-orm";
import { ArticleSchema, ingestWindow, type Article, type RunDate, type Source } from "@2dayai/core";
import { articles, sources as sourcesTable, type Db } from "@2dayai/db";
import { decodeBody, noControl } from "../text.js";

// Parses text only; fetching is the fetcher's job.
const parser = new Parser();

export type FeedFetcher = (url: string) => Promise<string>;

/**
 * How the fetcher names itself. Many sites refuse a bare bot name with 403 but serve the usual crawler form, which
 * still says who is asking (decision 53).
 */
export const USER_AGENT = "Mozilla/5.0 (compatible; GlobalGist/1.0; +https://github.com/hzsl777/capy)";

/** An error response from the server, as opposed to a network failure or a timeout. */
export class HttpError extends Error {}

export const defaultFetcher: FeedFetcher = async (url) => {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, text/html;q=0.8, */*;q=0.5" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new HttpError(`${res.status} ${res.statusText}`);
  return decodeBody(new Uint8Array(await res.arrayBuffer()), res.headers.get("content-type"));
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

/**
 * Paths many sites serve a feed from, tried when a page declares none or the configured address answers with an
 * error (decision 53). WordPress, Arc, Blogger and the public radio CMS among them. Each answer is checked.
 */
export const COMMON_FEED_PATHS = ["/feed/", "/rss", "/rss.xml", "/feed.xml", "/index.xml", "/index.rss", "/rss/", "/atom.xml", "/?feed=rss2", "/feeds/posts/default", "/arc/outboundfeeds/rss/", "/rss/news"];

/** Said when an address with a path finds no feed of its own, so the failure explains why nothing else was tried. */
const SECTION_NOTE = "an address with a path gets no feed from the site's root (decision 81)";

/**
 * The configured URL's feed. When it answers with a web page instead (a homepage in sources.yaml), the feed the
 * page links to, or one at a common path. Only a response that parses as RSS or Atom counts (decision 31).
 * Common paths are tried only for a site's root address. An address with a path is a section or an edition, and the
 * site's own feed would pin another section's or edition's news at this outlet's place, so it fails instead: it is
 * asked once more after an error, and nothing else is (decision 81). declared lists the feeds the page links to, for `sources check` to show.
 */
export async function fetchFeedDocument(url: string, fetchFeed: FeedFetcher): Promise<{ xml: string; feedUrl: string; declared?: string[] }> {
  const { origin, pathname, search } = new URL(url);
  const atRoot = pathname === "/" && !search;
  const common = atRoot ? COMMON_FEED_PATHS.map((p) => origin + p).filter((c) => c !== url) : [];
  let first: string;
  try {
    first = await fetchFeed(url);
  } catch (err) {
    // A server that answers with an error may still serve a feed at a usual path. One that is down or times out
    // is not asked again.
    if (!(err instanceof HttpError)) throw err;
    for (const candidate of common) {
      try {
        const text = await fetchFeed(candidate);
        if (looksLikeFeed(text)) return { xml: text, feedUrl: candidate };
      } catch {
        // Try the next path.
      }
    }
    // Some servers refuse the first request and answer the next, so a section's address is asked once more, unless
    // the server asked for fewer requests.
    if (atRoot) throw err;
    if (err.message.startsWith("429")) throw new HttpError(`${err.message}; ${SECTION_NOTE}`);
    try {
      first = await fetchFeed(url);
    } catch (again) {
      throw again instanceof HttpError ? new HttpError(`${again.message}; ${SECTION_NOTE}`) : again;
    }
  }
  if (looksLikeFeed(first)) return { xml: first, feedUrl: url };
  const declared = feedLinksIn(first, url);
  const candidates = declared.length ? declared.slice(0, 3) : common;
  for (const candidate of candidates) {
    try {
      const text = await fetchFeed(candidate);
      if (looksLikeFeed(text)) return { xml: text, feedUrl: candidate, declared };
    } catch {
      // Try the next candidate.
    }
  }
  if (declared.length) throw new Error(`page links to ${declared.length} feed(s), none answered: ${declared.slice(0, 3).join(" ")}`);
  throw new Error(atRoot ? "not a feed, and the page links to none" : `not a feed, and the page links to none; ${SECTION_NOTE}`);
}

/** Feed text as plain text. Some feeds give a field as an object ({ _: text, $: attributes }) instead of a string. */
export function stripHtml(field: unknown): string {
  const s = typeof field === "string" ? field : typeof (field as { _?: unknown } | null)?._ === "string" ? (field as { _: string })._ : "";
  return noControl(s).replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
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

/**
 * feedUrl is set when the feed was found through the configured page, so sources.yaml can be updated.
 * failedDays is the failure streak including today. paused is set for a source skipped today because it keeps failing.
 */
/**
 * Set by `sources check` only. feedTitle is the feed's own name and headlines its first three, to confirm a new
 * outlet's address is really its and in its language. declared lists every feed a page links to when the feed was
 * found through the page, so a section's own feed can be picked when the page links to the whole site's first.
 */
export type IngestReport = { source: string; fetched: number; inserted: number; feedUrl?: string; feedTitle?: string; headlines?: string[]; declared?: string[]; error?: string; failedDays?: number; paused?: boolean };

/** Feeds fetched at once. Hundreds of outlets one after another could take an hour on a slow day. */
const INGEST_CONCURRENCY = 8;
/** After this many failed days in a row a source is tried once a week, on Sundays (decision 36). */
export const PAUSE_AFTER_FAILED_DAYS = 7;

async function inPool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]!);
    }),
  );
}

/**
 * Stage 6.1. Idempotent per date: re-running upserts by URL and inserts nothing twice. Keeps each source's
 * health (decision 36): a feed found behind a homepage is remembered, so later days fetch it directly, and a
 * source failing PAUSE_AFTER_FAILED_DAYS days running is only retried on Sundays.
 */
export async function runIngest(db: Db, sources: Source[], date: RunDate, fetchFeed: FeedFetcher = defaultFetcher): Promise<IngestReport[]> {
  const health = new Map(
    (await db.select({ id: sourcesTable.id, feedUrl: sourcesTable.feedUrl, feedFrom: sourcesTable.feedFrom, failStreak: sourcesTable.failStreak, lastFailOn: sourcesTable.lastFailOn }).from(sourcesTable)).map((h) => [h.id, h]),
  );
  const sunday = new Date(`${date}T12:00:00Z`).getUTCDay() === 0;
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
    const h = health.get(source.id);
    const streak = h?.failStreak ?? 0;
    if (streak >= PAUSE_AFTER_FAILED_DAYS && !sunday) {
      reports.set(source.id, { source: source.id, fetched: 0, inserted: 0, paused: true, failedDays: streak, error: `paused after ${streak} failed days; retried on Sundays` });
      return;
    }
    // A remembered feed counts only while the configured URL is the one it was found behind.
    const remembered = h?.feedUrl && h.feedFrom === source.url ? h.feedUrl : null;
    try {
      let doc: { xml: string; feedUrl: string };
      try {
        doc = await fetchFeedDocument(remembered ?? source.url, fetchFeed);
      } catch (err) {
        if (!remembered) throw err;
        doc = await fetchFeedDocument(source.url, fetchFeed);
      }
      const found = await articlesFromFeed(source, doc.xml, date);
      let inserted = 0;
      // Articles stored with broken characters, from before feeds were read in their own encoding (decision 52),
      // take the clean text once the feed reads cleanly. One lookup per feed.
      const clean = found.filter((a) => !a.title.includes("\uFFFD"));
      const broken = clean.length
        ? new Set((await db.select({ url: articles.url }).from(articles).where(and(inArray(articles.url, clean.map((a) => a.url)), like(articles.title, "%\uFFFD%")))).map((r) => r.url))
        : new Set<string>();
      for (const a of found) {
        if (broken.has(a.url)) {
          await db.update(articles).set({ title: a.title, lead: a.lead, body: a.body }).where(eq(articles.url, a.url));
          continue;
        }
        const r = await db.insert(articles).values(a).onConflictDoNothing({ target: articles.url }).returning({ id: articles.id });
        inserted += r.length;
      }
      const discovered = doc.feedUrl !== source.url;
      await db
        .update(sourcesTable)
        .set({ failStreak: 0, lastFailOn: null, lastOkAt: new Date(), feedUrl: discovered ? doc.feedUrl : null, feedFrom: discovered ? source.url : null })
        .where(eq(sourcesTable.id, source.id));
      reports.set(source.id, { source: source.id, fetched: found.length, inserted, ...(discovered ? { feedUrl: doc.feedUrl } : {}) });
    } catch (err) {
      // One failed day counts once, however many times the day is run.
      const failedDays = h?.lastFailOn === date ? streak : streak + 1;
      if (failedDays !== streak) await db.update(sourcesTable).set({ failStreak: failedDays, lastFailOn: date }).where(eq(sourcesTable.id, source.id));
      reports.set(source.id, { source: source.id, fetched: 0, inserted: 0, failedDays, error: err instanceof Error ? err.message : String(err) });
    }
  });
  return sources.map((s) => reports.get(s.id)!);
}

/** `sources check`: fetch every feed and report, without a database. For Davis to run locally on the starter list. */
export async function checkSources(sources: Source[], date: RunDate, fetchFeed: FeedFetcher = defaultFetcher): Promise<IngestReport[]> {
  const reports = new Map<string, IngestReport>();
  await inPool(sources, INGEST_CONCURRENCY, async (source) => {
    try {
      const { xml, feedUrl, declared } = await fetchFeedDocument(source.url, fetchFeed);
      const found = await articlesFromFeed(source, xml, date);
      const feed = await parser.parseString(xml);
      const feedTitle = stripHtml(feed.title).slice(0, 120);
      const headlines = feed.items.slice(0, 3).map((i) => stripHtml(i.title).slice(0, 100)).filter(Boolean);
      reports.set(source.id, {
        source: source.id,
        fetched: found.length,
        inserted: 0,
        ...(feedUrl !== source.url ? { feedUrl } : {}),
        ...(feedTitle ? { feedTitle } : {}),
        ...(headlines.length ? { headlines } : {}),
        ...(declared && declared.length > 1 ? { declared } : {}),
      });
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
