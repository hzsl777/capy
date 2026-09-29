// Feeds usually carry a title and a lead. Citations need the text. This stage fetches the article page once,
// extracts the main text, and stores it. Failures leave the article with what the feed gave.
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { and, eq, gte, inArray, isNull, lt, type SQL } from "drizzle-orm";
import { ingestWindow, type RunDate } from "@2dayai/core";
import { articles, sources, type Db } from "@2dayai/db";
import { decodeBody, noControl } from "../text.js";

export const MIN_BODY_CHARS = 400;
export const MAX_BODY_CHARS = 30_000;

export type PageFetcher = (url: string) => Promise<string>;

export const defaultPageFetcher: PageFetcher = async (url) => {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; 2dayai/0.1; +https://github.com/hzsl777/capy)", Accept: "text/html" },
    signal: AbortSignal.timeout(20_000),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("html")) throw new Error(`not html: ${type}`);
  return decodeBody(new Uint8Array(await res.arrayBuffer()), type);
};

/** Pure: main text of an article page, or empty when the extractor finds nothing worth keeping. */
export function extractArticleText(html: string, url: string): string {
  const { document } = parseHTML(html);
  // Readability wants a real document; linkedom's is close enough for text extraction.
  const article = new Readability(document as unknown as ConstructorParameters<typeof Readability>[0], { charThreshold: 200 }).parse();
  const text = noControl(article?.textContent ?? "").replace(/\s+/g, " ").trim();
  void url;
  return text.length >= MIN_BODY_CHARS ? text.slice(0, MAX_BODY_CHARS) : "";
}

export type EnrichReport = { candidates: number; enriched: number; failed: number };

/**
 * Which articles to fetch. The daily run fetches only what a stage will read: briefing articles before the
 * briefing is grouped, and the articles of events about to be explained (decision 33). With no scope, every
 * article of the day, as the standalone `enrich` command always did.
 */
export type EnrichScope = { articleIds?: number[]; desk?: "briefing" | "world" };

export async function runEnrich(db: Db, date: RunDate, fetchPage: PageFetcher = defaultPageFetcher, concurrency = 4, scope: EnrichScope = {}): Promise<EnrichReport> {
  const { from, to } = ingestWindow(date);
  if (scope.articleIds && scope.articleIds.length === 0) return { candidates: 0, enriched: 0, failed: 0 };
  const where: SQL[] = [gte(articles.publishedAt, from), lt(articles.publishedAt, to), isNull(articles.enrichedAt)];
  if (scope.articleIds) where.push(inArray(articles.id, scope.articleIds));
  if (scope.desk) where.push(eq(sources.desk, scope.desk));
  const rows = await db
    .select({ id: articles.id, url: articles.url, body: articles.body })
    .from(articles)
    .innerJoin(sources, eq(sources.id, articles.sourceId))
    .where(and(...where));
  const candidates = rows.filter((r) => r.body.length < MIN_BODY_CHARS);
  let enriched = 0;
  let failed = 0;
  const queue = [...candidates];
  async function worker(): Promise<void> {
    for (let row = queue.shift(); row; row = queue.shift()) {
      try {
        const text = extractArticleText(await fetchPage(row.url), row.url);
        if (text) {
          await db.update(articles).set({ body: text, bodySource: "page", enrichedAt: new Date() }).where(eq(articles.id, row.id));
          enriched += 1;
        } else {
          await db.update(articles).set({ enrichedAt: new Date() }).where(eq(articles.id, row.id));
          failed += 1;
        }
      } catch {
        await db.update(articles).set({ enrichedAt: new Date() }).where(eq(articles.id, row.id));
        failed += 1;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return { candidates: candidates.length, enriched, failed };
}
