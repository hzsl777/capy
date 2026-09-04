// Stage 6.3. One request per event, batched. Every sentence is checked against the cited article text and dropped
// when the excerpt is not there. This is the hallucination control and it is not optional.
import { eq, inArray } from "drizzle-orm";
import { ExplanationSchema, verifyExplanation, type RunDate } from "@2dayai/core";
import { loadPrompt } from "../prompts.js";
import { articles, citations, eventArticles, eventExplanations, events, sources, type Db } from "@2dayai/db";
import type { Config } from "../config.js";
import type { Llm, ParseRequest } from "../llm/types.js";

export const EXPLAIN_PROMPT_VERSION = 1;
const ARTICLE_CHARS = 9000;
const TOTAL_CHARS = 45000;

export type ExplainReport = { events: number; usable: number; unusable: number; failed: number; sentencesDropped: number };

type ArticleRow = { id: number; title: string; url: string; publisher: string; publishedAt: Date; text: string };

export function explainUserContent(event: { title: string }, rows: ArticleRow[]): string {
  let budget = TOTAL_CHARS;
  const parts = rows.map((a) => {
    const text = a.text.slice(0, Math.min(ARTICLE_CHARS, Math.max(0, budget)));
    budget -= text.length;
    return `[article ${a.id}] ${a.title}\npublisher: ${a.publisher}, published ${a.publishedAt.toISOString().slice(0, 10)}\nurl: ${a.url}\n\n${text}`;
  });
  return `Event: ${event.title}\n\nSource articles, each starting with its id in brackets. Cite by that id and quote passages verbatim.\n\n${parts.join("\n\n----\n\n")}`;
}

export async function runExplain(db: Db, config: Config, llm: Llm, date: RunDate): Promise<ExplainReport> {
  const evs = await db.select().from(events).where(eq(events.runDate, date));
  if (evs.length === 0) return { events: 0, usable: 0, unusable: 0, failed: 0, sentencesDropped: 0 };
  const ids = evs.map((e) => e.id);
  await db.delete(eventExplanations).where(inArray(eventExplanations.eventId, ids));
  await db.delete(citations).where(inArray(citations.eventId, ids));

  const links = await db
    .select({ eventId: eventArticles.eventId, id: articles.id, title: articles.title, url: articles.url, publisher: sources.name, publishedAt: articles.publishedAt, lead: articles.lead, body: articles.body })
    .from(eventArticles)
    .innerJoin(articles, eq(articles.id, eventArticles.articleId))
    .innerJoin(sources, eq(sources.id, articles.sourceId))
    .where(inArray(eventArticles.eventId, ids));

  const prompt = loadPrompt("explain", EXPLAIN_PROMPT_VERSION);
  const perEvent = new Map<number, ArticleRow[]>();
  for (const l of links) {
    const text = [l.title, l.lead, l.body].filter(Boolean).join("\n\n");
    const list = perEvent.get(l.eventId) ?? [];
    list.push({ id: l.id, title: l.title, url: l.url, publisher: l.publisher, publishedAt: l.publishedAt, text });
    perEvent.set(l.eventId, list);
  }

  const reqs: ParseRequest<typeof ExplanationSchema>[] = evs.map((ev) => ({
    id: `event-${ev.id}`,
    stage: "explain",
    prompt,
    schema: ExplanationSchema,
    user: explainUserContent(ev, perEvent.get(ev.id) ?? []),
    effort: config.effort.explain,
  }));
  const results = await llm.parseMany(reqs, date);

  let usable = 0;
  let unusable = 0;
  let failed = 0;
  let sentencesDropped = 0;
  for (const ev of evs) {
    const r = results.get(`event-${ev.id}`);
    if (!r || !r.ok) {
      failed += 1;
      await db.insert(eventExplanations).values({ eventId: ev.id, sentences: { whatHappened: [], whyItMatters: [], whatChangesNext: [], error: r?.error ?? "missing" }, usable: false, survivors: 0, dropped: 0, promptVersion: prompt.label });
      continue;
    }
    const texts = (perEvent.get(ev.id) ?? []).map((a) => ({ id: a.id, text: a.text }));
    const verified = verifyExplanation(r.value, texts);
    sentencesDropped += verified.dropped;
    if (verified.usable) usable += 1;
    else unusable += 1;
    await db.insert(eventExplanations).values({
      eventId: ev.id,
      sentences: { whatHappened: verified.whatHappened, whyItMatters: verified.whyItMatters, whatChangesNext: verified.whatChangesNext },
      usable: verified.usable,
      survivors: verified.survivors,
      dropped: verified.dropped,
      promptVersion: prompt.label,
    });
    // Audit trail: every citation the model offered, verified or not.
    const all = [...r.value.whatHappened, ...r.value.whyItMatters, ...r.value.whatChangesNext];
    const allowed = new Set(texts.map((t) => t.id));
    const rows = all.flatMap((s) =>
      s.citations
        .filter((c) => allowed.has(c.articleId))
        .map((c) => ({ eventId: ev.id, articleId: c.articleId, excerpt: c.excerpt, verified: verified.whatHappened.concat(verified.whyItMatters, verified.whatChangesNext).some((v) => v.text === s.text) })),
    );
    if (rows.length) await db.insert(citations).values(rows);
  }
  return { events: evs.length, usable, unusable, failed, sentencesDropped };
}
