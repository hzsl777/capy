// Feeds usually carry a title and a lead. Citations need the text. This stage fetches the article page once,
// extracts the main text, and stores it. Failures leave the article with what the feed gave.
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { and, eq, gte, isNull, lt } from "drizzle-orm";
import { ingestWindow, type RunDate } from "@2dayai/core";
import { articles, type Db } from "@2dayai/db";

export const MIN_BODY_CHARS = 400;
export const MAX_BODY_CHARS = 30_000;

export type PageFetcher = (url: string) => Promise<string>;

export const defaultPageFetcher: PageFetcher = async (url) => {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; 2dayai/0.1; +https://github.com/hzsl777/2dayai)", Accept: "text/html" },
    signal: AbortSignal.timeout(20_000),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("html")) throw new Error(`not html: ${type}`);
  return res.text();
};

/** Pure: main text of an article page, or empty when the extractor finds nothing worth keeping. */
export function extractArticleText(html: string, url: string): string {
  const { document } = parseHTML(html);
  // Readability wants a real document; linkedom's is close enough for text extraction.
  const article = new Readability(document as unknown as ConstructorParameters<typeof Readability>[0], { charThreshold: 200 }).parse();
  const text = (article?.textContent ?? "").replace(/\s+/g, " ").trim();
  void url;
  return text.length >= MIN_BODY_CHARS ? text.slice(0, MAX_BODY_CHARS) : "";
}

export type EnrichReport = { candidates: number; enriched: number; failed: number };

export async function runEnrich(db: Db, date: RunDate, fetchPage: PageFetcher = defaultPageFetcher, concurrency = 4): Promise<EnrichReport> {
  const { from, to } = ingestWindow(date);
  const rows = await db
    .select({ id: articles.id, url: articles.url, body: articles.body })
    .from(articles)
    .where(and(gte(articles.publishedAt, from), lt(articles.publishedAt, to), isNull(articles.enrichedAt)));
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
