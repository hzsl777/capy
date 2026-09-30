// Read model for the public map (decision 25). One loader serves the Worker's /data endpoints and the
// pipeline's static export. A story sits where it happened when the grouping stage placed its event (decision 44),
// and at its publisher's city otherwise. Reach still counts publisher cities: it measures how widely a story was
// reported.
import { and, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { ingestWindow, LOCAL_TILE_DEG, placeIdFor, tileBounds, tileKey, toRunDate, WORLD_TOPICS, type MapEvent, type MapFile, type MapItem, type MapPlace, type MapSentence, type MapTile, type VerifiedSentence, type WorldTopic } from "@2dayai/core";
import * as t from "./schema.js";
import type { Db } from "./types.js";

type Stored = { whatHappened: VerifiedSentence[]; whyItMatters: VerifiedSentence[]; whatChangesNext: VerifiedSentence[] };

const EXCERPT_MAX = 300;
/** A story's city this close to a publisher's city is the same dot. */
const SAME_CITY_KM = 25;

function km(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const r = Math.PI / 180;
  const h = Math.sin(((bLat - aLat) * r) / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(((bLon - aLon) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}

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

/** Where a day's tiles are, relative to the folder its file is served from (decision 78). */
export const localBase = (runDate: string) => `local/${runDate}/`;

/**
 * The day's map. By default the whole day, local stories and all: what the pipeline counts and splits into the
 * site's file and tiles (splitLocal in core). With `local: "index"` the local stories stay in the database and the
 * file lists their tiles instead, as the Worker serves a day with no stored file (decision 78).
 */
export async function loadMapView(db: Db, runDate: string, now: Date = new Date(), opts: { local?: "inline" | "index" } = {}): Promise<MapFile> {
  const date = toRunDate(runDate);
  const { from, to } = ingestWindow(date);

  const rows = await db
    .select({ article: t.articles, source: t.sources })
    .from(t.articles)
    .innerJoin(t.sources, eq(t.sources.id, t.articles.sourceId))
    .where(and(eq(t.sources.desk, "world"), gte(t.articles.publishedAt, from), lt(t.articles.publishedAt, to)));

  // Pins: one per city. Publishers in the same city share a pin, and a story's city within SAME_CITY_KM of a
  // publisher's city shares that pin, so one city is one dot. A GDELT town shares a pin only with the same point:
  // towns a few kilometres apart are different places, and the site merges nearby dots by zoom, naming each
  // (decision 67). A grid of half-degree cells finds nearby pins, since a day can have several thousand.
  const places: MapPlace[] = [];
  const placeIndex = new Map<string, number>();
  const grid = new Map<string, number[]>();
  const cellOf = (lat: number, lon: number) => [Math.floor(lat * 2), Math.floor(lon * 2)] as const;
  const nearby = (lat: number, lon: number): number => {
    const [cy, cx] = cellOf(lat, lon);
    const cols = Math.min(360, Math.ceil(SAME_CITY_KM / (55 * Math.max(Math.cos((Math.min(89, Math.abs(lat)) * Math.PI) / 180), 0.02))));
    let best = -1;
    for (let y = cy - 1; y <= cy + 1; y++)
      for (let x = cx - cols; x <= cx + cols; x++)
        for (const i of grid.get(`${y},${((((x + 360) % 720) + 720) % 720) - 360}`) ?? []) {
          const p = places[i]!;
          if ((best < 0 || i < best) && km(p.lat, p.lon, lat, lon) <= SAME_CITY_KM) best = i;
        }
    return best;
  };
  const pin = (name: string, lat: number, lon: number, merge = true): number => {
    const id = placeIdFor(lat, lon);
    let idx = placeIndex.get(id) ?? (merge ? nearby(lat, lon) : -1);
    if (idx < 0) {
      idx = places.push({ id, name, lat, lon }) - 1;
      const [y, x] = cellOf(lat, lon);
      const key = `${y},${x}`;
      grid.set(key, [...(grid.get(key) ?? []), idx]);
    }
    placeIndex.set(id, idx);
    return idx;
  };
  const placeOf = (s: typeof t.sources.$inferSelect): number | null => (s.lat === null || s.lon === null || !s.placeName ? null : pin(s.placeName, s.lat, s.lon));

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
  const happenedAt = new Map(worldEvents.flatMap((e) => (e.placeName && e.lat !== null && e.lon !== null ? [[e.id, pin(e.placeName, e.lat, e.lon)] as const] : [])));
  const importanceOf = new Map(worldEvents.map((e) => [e.id, e.importance]));

  const items: MapItem[] = [];
  for (const { article, source } of rows) {
    const home = placeOf(source);
    if (home === null) continue;
    const eventId = eventOfArticle.get(article.id);
    // Once the day is grouped, the map shows only articles in a story: the grouping stage left out ads and other
    // non-news, and articles past an outlet's daily cap never reached it, so neither has a rank (decision 50).
    if (worldEvents.length > 0 && eventId === undefined) continue;
    const at = eventId !== undefined ? happenedAt.get(eventId) : undefined;
    const place = at ?? home;
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
    if (place !== home) item.from = places[home]!.name;
    if (eventId !== undefined) {
      const reach = eventPlaces.get(eventId)?.size ?? 1;
      item.reach = reach;
      item.importance = importanceOf.get(eventId) ?? 1;
      if (reach >= 2) item.story = `e${eventId}`;
    }
    if (eventId !== undefined && explained.has(eventId)) item.event = eventId;
    if (article.lead) item.excerpt = clip(article.lead, EXCERPT_MAX);
    items.push(item);
  }
  // Local stories from the GDELT index for towns no outlet reached (decisions 54, 67 and 78): the lowest rank, placed
  // by GDELT's checked city tag, published by the outlet's site.
  let local: MapFile["local"];
  if (opts.local === "index") local = { deg: LOCAL_TILE_DEG, base: localBase(date), tiles: await localTileCounts(db, date) };
  else for (const s of await db.select().from(t.localStories).where(eq(t.localStories.runDate, date)).orderBy(...LOCAL_ORDER)) items.push(localItem(s, pin(s.placeName, s.lat, s.lon, false)));
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

  // The day's file is as new as its window's end, or its newest local story once the refresh during the day has read
  // past that end (decision 80), and never newer than now.
  const newestLocal = (await db.select({ at: sql<Date | null>`max(${t.localStories.publishedAt})` }).from(t.localStories).where(eq(t.localStories.runDate, date)))[0]?.at;
  const upTo = Math.max(to.getTime(), newestLocal ? new Date(newestLocal).getTime() : 0);
  const file: MapFile = { version: 2, source: "live", generatedAt: Math.floor(Math.min(now.getTime(), upTo) / 1000), runDate: date, places, items, events, telegram };
  if (local) file.local = local;
  return file;
}

/** Newest first, then by id: the order the whole day and a single tile both read local stories in, so they agree. */
const LOCAL_ORDER = [desc(t.localStories.publishedAt), t.localStories.id] as const;

function localItem(s: typeof t.localStories.$inferSelect, place: number): MapItem {
  return {
    id: `g${s.id}`,
    t: Math.floor(s.publishedAt.getTime() / 1000),
    title: s.title,
    url: s.url,
    domain: s.domain,
    publisher: s.domain,
    lang: s.lang ?? "",
    topics: [],
    place,
    reach: 1,
    importance: 1,
    via: "gdelt",
  };
}

/** How many local stories each tile of a day has, counted in the database (decision 78). */
async function localTileCounts(db: Db, date: string): Promise<Record<string, number>> {
  const deg = LOCAL_TILE_DEG;
  const rows = await db
    .select({ south: sql<number>`least(floor(${t.localStories.lat} / ${deg}) * ${deg}, ${90 - deg})`, west: sql<number>`least(floor(${t.localStories.lon} / ${deg}) * ${deg}, ${180 - deg})`, n: sql<number>`count(*)` })
    .from(t.localStories)
    .where(eq(t.localStories.runDate, date))
    .groupBy(sql`1`, sql`2`);
  const out: Record<string, number> = {};
  for (const r of rows) {
    const key = tileKey(Number(r.south), Number(r.west), deg);
    out[key] = (out[key] ?? 0) + Number(r.n);
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
}

/**
 * One tile of a day's local stories from the database, or null when it has none: what the Worker serves when the
 * daily run stored no file for it (decision 78). The same places and stories splitLocal cuts from the whole day.
 */
export async function loadLocalTile(db: Db, runDate: string, key: string): Promise<MapTile | null> {
  const date = toRunDate(runDate);
  const cell = tileBounds(key);
  if (!cell) return null;
  const rows = (
    await db
      .select()
      .from(t.localStories)
      .where(and(eq(t.localStories.runDate, date), gte(t.localStories.lat, cell.south), lte(t.localStories.lat, cell.north), gte(t.localStories.lon, cell.west), lte(t.localStories.lon, cell.east)))
      .orderBy(...LOCAL_ORDER)
  ).filter((s) => tileKey(s.lat, s.lon) === key);
  if (rows.length === 0) return null;
  const places: MapPlace[] = [];
  const index = new Map<string, number>();
  const items = rows.map((s) => {
    const id = placeIdFor(s.lat, s.lon);
    let at = index.get(id);
    if (at === undefined) index.set(id, (at = places.push({ id, name: s.placeName, lat: s.lat, lon: s.lon }) - 1));
    const it = localItem(s, at);
    return [it.id, it.t, it.title, it.url, it.domain, it.lang, at] as MapTile["items"][number];
  });
  items.sort((a, b) => b[1] - a[1]);
  return { version: 2, runDate: date, key, places, items };
}
