// Read model for the public map (decision 25). One loader serves the Worker's /data endpoints and the
// pipeline's static export. Publishers are the pins; nothing is geocoded.
import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { ingestWindow, placeIdFor, toRunDate, WORLD_TOPICS, type MapEvent, type MapFile, type MapItem, type MapPlace, type MapSentence, type VerifiedSentence, type WorldTopic } from "@2dayai/core";
import * as t from "./schema.js";
import type { Db } from "./types.js";

type Stored = { whatHappened: VerifiedSentence[]; whyItMatters: VerifiedSentence[]; whatChangesNext: VerifiedSentence[] };

const EXCERPT_MAX = 300;

function clip(s: string, max: number): string {
  const text = s.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.4 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, "")}...`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isBand(n: number): n is -2 | -1 | 0 | 1 | 2 {
  return Number.isInteger(n) && n >= -2 && n <= 2;
}

function asTopic(v: string | null): WorldTopic {
  return (WORLD_TOPICS as readonly string[]).includes(v ?? "") ? (v as WorldTopic) : "other";
}

/** The newest run date with world events, or null when the world desk has never run. */
export async function latestMapDate(db: Db): Promise<string | null> {
  const row = (await db.select({ d: t.events.runDate }).from(t.events).where(eq(t.events.desk, "world")).orderBy(desc(t.events.runDate)).limit(1))[0];
  return row?.d ?? null;
}

export async function loadMapView(db: Db, runDate: string, now: Date = new Date()): Promise<MapFile> {
  const date = toRunDate(runDate);
  const { from, to } = ingestWindow(date);

  const rows = await db
    .select({ article: t.articles, source: t.sources })
    .from(t.articles)
    .innerJoin(t.sources, eq(t.sources.id, t.articles.sourceId))
    .where(and(eq(t.sources.desk, "world"), gte(t.articles.publishedAt, from), lt(t.articles.publishedAt, to)));

  // Pins: one per publisher place. Publishers in the same city share a pin.
  const places: MapPlace[] = [];
  const placeIndex = new Map<string, number>();
  const placeOf = (s: typeof t.sources.$inferSelect): number | null => {
    if (s.lat === null || s.lon === null || !s.placeName) return null;
    const id = placeIdFor(s.lat, s.lon);
    let idx = placeIndex.get(id);
    if (idx === undefined) {
      idx = places.push({ id, name: s.placeName, lat: s.lat, lon: s.lon }) - 1;
      placeIndex.set(id, idx);
    }
    return idx;
  };

  const worldEvents = await db.select().from(t.events).where(and(eq(t.events.runDate, date), eq(t.events.desk, "world")));
  const eventIds = worldEvents.map((e) => e.id);
  const links = eventIds.length ? await db.select().from(t.eventArticles).where(inArray(t.eventArticles.eventId, eventIds)) : [];
  const eventOfArticle = new Map(links.map((l) => [l.articleId, l.eventId]));
  const explanations = eventIds.length ? await db.select().from(t.eventExplanations).where(and(inArray(t.eventExplanations.eventId, eventIds), eq(t.eventExplanations.usable, true))) : [];
  const explained = new Map(explanations.map((x) => [x.eventId, x.sentences as Stored]));

  const byArticle = new Map(rows.map((r) => [r.article.id, r]));
  const eventPlaces = new Map<number, Set<number>>();
  for (const l of links) {
    const r = byArticle.get(l.articleId);
    const p = r ? placeOf(r.source) : null;
    if (p === null) continue;
    const set = eventPlaces.get(l.eventId) ?? new Set<number>();
    set.add(p);
    eventPlaces.set(l.eventId, set);
  }
  const topicOf = new Map(worldEvents.map((e) => [e.id, asTopic(e.topic)]));

  const items: MapItem[] = [];
  for (const { article, source } of rows) {
    const place = placeOf(source);
    if (place === null) continue;
    const eventId = eventOfArticle.get(article.id);
    const item: MapItem = {
      id: `a${article.id}`,
      t: Math.floor(article.publishedAt.getTime() / 1000),
      title: article.title,
      url: article.url,
      domain: hostOf(article.url),
      publisher: source.name,
      lang: source.lang,
      topics: eventId !== undefined ? [topicOf.get(eventId) ?? "other"] : [],
      place,
    };
    if (eventId !== undefined && (eventPlaces.get(eventId)?.size ?? 0) >= 2) item.story = `e${eventId}`;
    if (eventId !== undefined && explained.has(eventId)) item.event = eventId;
    if (article.lead) item.excerpt = clip(article.lead, EXCERPT_MAX);
    items.push(item);
  }
  items.sort((a, b) => b.t - a.t);

  // Level 2 and 3 for every explained world event: sentences, and the sources with the passages they quote.
  const events: Record<string, MapEvent> = {};
  for (const ev of worldEvents) {
    const s = explained.get(ev.id);
    if (!s) continue;
    const sources: MapEvent["sources"] = [];
    const sourceIndex = new Map<number, number>();
    const toMap = (list: VerifiedSentence[]): MapSentence[] =>
      list.map((sentence) => ({
        text: sentence.text,
        cites: sentence.citations.flatMap((c) => {
          const r = byArticle.get(c.articleId);
          if (!r) return [];
          let idx = sourceIndex.get(c.articleId);
          if (idx === undefined) {
            idx = sources.push({ title: r.article.title, url: r.article.url, publisher: r.source.name, publishedAt: Math.floor(r.article.publishedAt.getTime() / 1000), excerpts: [] }) - 1;
            sourceIndex.set(c.articleId, idx);
          }
          const src = sources[idx]!;
          if (!src.excerpts.includes(c.excerpt)) src.excerpts.push(c.excerpt);
          return [idx];
        }),
      }));
    events[String(ev.id)] = {
      id: ev.id,
      title: ev.title,
      topic: asTopic(ev.topic),
      places: [...(eventPlaces.get(ev.id) ?? [])],
      whatHappened: toMap(s.whatHappened),
      whyItMatters: toMap(s.whyItMatters),
      whatChangesNext: toMap(s.whatChangesNext),
      sources,
    };
  }

  const tg = (await db.select().from(t.telegrams).where(and(eq(t.telegrams.runDate, date), eq(t.telegrams.scope, "world"))))[0];
  let telegram: MapFile["telegram"] = null;
  if (tg) {
    const tItems = (await db.select().from(t.telegramItems).where(eq(t.telegramItems.telegramId, tg.id))).sort((a, b) => a.rank - b.rank);
    const tScores = await db.select().from(t.telegramScores).where(eq(t.telegramScores.telegramId, tg.id));
    const kept = tItems.filter((i) => events[String(i.eventId)]);
    // A telegram whose events were re-clustered away is stale; show nothing rather than a word without its evidence.
    if (kept.length > 0 && isBand(tg.band)) {
      telegram = {
        word: tg.word,
        band: tg.band,
        runDate: date,
        items: kept.map((i) => ({ eventId: i.eventId, line: i.line })),
        scores: tScores
          .filter((sc) => events[String(sc.eventId)])
          .sort((a, b) => a.score - b.score)
          .map((sc) => ({ eventId: sc.eventId, score: sc.score, because: sc.because })),
      };
    }
  }

  return { version: 2, source: "live", generatedAt: Math.floor(Math.min(now.getTime(), to.getTime()) / 1000), runDate: date, places, items, events, telegram };
}
