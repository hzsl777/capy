// Read models shared by the pipeline (email) and the Worker (pages). One loader, three presentations.
import { and, eq, inArray } from "drizzle-orm";
import type { EditionItemView, EditionView, LeftOutView, VerifiedSentence } from "@2dayai/core";
import { RejectReason } from "@2dayai/core";
import * as t from "./schema.js";
import type { Db } from "./types.js";

type StoredSentences = { whatHappened: VerifiedSentence[]; whyItMatters: VerifiedSentence[]; whatChangesNext: VerifiedSentence[] };

export async function loadEditionView(db: Db, where: { readerToken: string; runDate: string } | { editionId: number }): Promise<EditionView | null> {
  const edition =
    "editionId" in where
      ? (await db.select().from(t.editions).where(eq(t.editions.id, where.editionId)))[0]
      : (
          await db
            .select({ e: t.editions })
            .from(t.editions)
            .innerJoin(t.readers, eq(t.readers.id, t.editions.readerId))
            .where(and(eq(t.readers.token, where.readerToken), eq(t.editions.runDate, where.runDate)))
        )[0]?.e;
  if (!edition) return null;
  const reader = (await db.select().from(t.readers).where(eq(t.readers.id, edition.readerId)))[0];
  if (!reader) return null;

  const items = await db
    .select({ item: t.editionItems, event: t.events })
    .from(t.editionItems)
    .innerJoin(t.events, eq(t.events.id, t.editionItems.eventId))
    .where(eq(t.editionItems.editionId, edition.id));
  items.sort((a, b) => a.item.rank - b.item.rank);

  const selectedIds = items.filter((r) => r.item.selected).map((r) => r.event.id);
  const explanations = selectedIds.length ? await db.select().from(t.eventExplanations).where(inArray(t.eventExplanations.eventId, selectedIds)) : [];
  const links = selectedIds.length
    ? await db
        .select({ eventId: t.eventArticles.eventId, article: t.articles, source: t.sources })
        .from(t.eventArticles)
        .innerJoin(t.articles, eq(t.articles.id, t.eventArticles.articleId))
        .innerJoin(t.sources, eq(t.sources.id, t.articles.sourceId))
        .where(inArray(t.eventArticles.eventId, selectedIds))
    : [];

  const views: EditionItemView[] = [];
  const leftOut: LeftOutView[] = [];
  for (const r of items) {
    if (!r.item.selected) {
      const reason = RejectReason.safeParse(r.item.reasonCode);
      leftOut.push({ eventId: r.event.id, title: r.event.title, reason: reason.success ? reason.data : "low-confidence" });
      continue;
    }
    const ex = explanations.find((e) => e.eventId === r.event.id);
    const sentences = (ex?.sentences as StoredSentences | undefined) ?? { whatHappened: [], whyItMatters: [], whatChangesNext: [] };
    const cited = new Set([...sentences.whatHappened, ...sentences.whyItMatters, ...sentences.whatChangesNext].flatMap((s) => s.citations.map((c) => c.articleId)));
    const sources = links
      .filter((l) => l.eventId === r.event.id && cited.has(l.article.id))
      .map((l) => ({ articleId: l.article.id, title: l.article.title, url: l.article.url, publisher: l.source.name, publishedAt: l.article.publishedAt }));
    views.push({
      eventId: r.event.id,
      title: r.event.title,
      importance: r.event.importance,
      line: r.item.line ?? r.event.title,
      stakeParagraph: r.item.stakeParagraph ?? "",
      outsideInterests: r.item.outsideInterests,
      explanation: sentences,
      sources,
    });
  }
  return {
    editionId: edition.id,
    readerId: reader.id,
    readerToken: reader.token,
    runDate: edition.runDate,
    headline: edition.headline,
    quietDay: edition.quietDay,
    items: views,
    leftOut,
  };
}

/** The event must belong to this reader's edition for this date; anything else is a 404, not a write. */
export async function findEditionEvent(db: Db, args: { readerToken: string; runDate: string; eventId: number }): Promise<{ readerId: string; eventId: number; title: string } | null> {
  const row = (
    await db
      .select({ readerId: t.readers.id, eventId: t.events.id, title: t.events.title })
      .from(t.editionItems)
      .innerJoin(t.editions, eq(t.editions.id, t.editionItems.editionId))
      .innerJoin(t.readers, eq(t.readers.id, t.editions.readerId))
      .innerJoin(t.events, eq(t.events.id, t.editionItems.eventId))
      .where(and(eq(t.readers.token, args.readerToken), eq(t.editions.runDate, args.runDate), eq(t.editionItems.eventId, args.eventId)))
  )[0];
  return row ?? null;
}

export async function recordFeedback(db: Db, args: { readerToken: string; runDate: string; eventId: number; kind: string }): Promise<{ title: string } | null> {
  const found = await findEditionEvent(db, args);
  if (!found) return null;
  await db.insert(t.feedback).values({ readerId: found.readerId, eventId: found.eventId, eventTitle: found.title, runDate: args.runDate, kind: args.kind });
  return { title: found.title };
}
