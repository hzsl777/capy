// The contract between the database and the public map. The Worker builds it from the database with
// loadMapView; the site renders it. Type-only, so the site imports it without pulling in zod.
import type { WorldTopic } from "./world.js";

export type MapPlace = {
  /** Stable across runs, used for pins: "ll:<lat>,<lon>" of the city. */
  id: string;
  /**
   * The city: where stories happened (decision 44), or where outlets publish from for stories that name no city.
   * Shown in the panel, never on the map.
   */
  name: string;
  lat: number;
  lon: number;
};

export type MapItem = {
  id: string;
  /** Unix seconds, publication time. */
  t: number;
  /** Headline as the outlet published it. */
  title: string;
  url: string;
  domain: string;
  publisher: string;
  lang: string;
  topics: WorldTopic[];
  /** Index into MapFile.places: where the story happened, or the publisher's city when the story names none. */
  place: number;
  /** The publisher's city, set when the story is placed where it happened and that is somewhere else. */
  from?: string;
  /**
   * Set when the story happened in another country than its outlet's and names no city to place it, so it shows at
   * the outlet's city (decision 107). The site lists it apart from that city's news, and it never sets the city's
   * mark or zoom level. Which country is never sent.
   */
  abroad?: true;
  /** Set when the article's event was reported from two or more places. */
  story?: string;
  /**
   * How many publisher cities reported this article's event, and the grouping model's 1 to 5 importance for it. Both
   * decide only the zoom level at which the article's place appears (decision 30), never order or dot size.
   */
  reach?: number;
  importance?: number;
  /** Event id with a verified explanation the reader can open (MapFile.events). */
  event?: number;
  /** The outlet's own short summary from its feed, at most 300 characters. Never article body text. */
  excerpt?: string;
  image?: string;
  embed?: boolean;
  /**
   * Set on a local story found through the GDELT index for a town no outlet reached (decisions 54, 67 and 78). It is
   * placed by GDELT's city tag, checked against the city list and GeoNames' towns, its publisher is the outlet's
   * site, and it shows only at the closest zoom. The day's file leaves these out and lists its tiles (MapFile.local).
   */
  via?: "gdelt";
};

export type MapSource = {
  title: string;
  url: string;
  publisher: string;
  /** Unix seconds. */
  publishedAt: number;
  /** The verbatim passages the explanation quotes from this article. */
  excerpts: string[];
};

export type MapSentence = {
  text: string;
  /** Indexes into MapEvent.sources, shown as numbered marks. */
  cites: number[];
};

/** Level 2 and 3 for one event: sentences checked against the sources, and the sources with their quoted passages. */
export type MapEvent = {
  id: number;
  title: string;
  topic: WorldTopic;
  /** Indexes into MapFile.places of the publishers that reported it. */
  places: number[];
  whatHappened: MapSentence[];
  whyItMatters: MapSentence[];
  whatChangesNext: MapSentence[];
  sources: MapSource[];
};

/** Level 0 and 1: the word, where the day sits on the scale and why, and the events that shaped it. */
export type MapTelegram = {
  word: string;
  /** -2 (grave) to 2 (good), computed from the event scores by dayBand in core. */
  band: -2 | -1 | 0 | 1 | 2;
  runDate: string;
  items: { eventId: number; line: string }[];
  /** Every explained event's score, with the verified sentence given as the reason. Worst first. */
  scores: { eventId: number; score: number; because: string }[];
};

/** An earlier day's word, its date (YYYY-MM-DD) and its step on the scale. */
export type MapRecentWord = { date: string; word: string; band: -2 | -1 | 0 | 1 | 2 };

export type MapFile = {
  version: 2;
  /**
   * "live" from the database. "sample" is the fictional day. "demo" is real headlines gathered without the
   * pipeline, for a preview. The site shows a banner for both, with `note` as the demo's text.
   */
  source: "live" | "sample" | "demo";
  note?: string;
  /** Unix seconds. Time filters are relative to this, not the viewer's clock. */
  generatedAt: number;
  runDate: string;
  places: MapPlace[];
  items: MapItem[];
  events: Record<string, MapEvent>;
  /** Null when no telegram was written for the date (no explained world events, or the stage failed). */
  telegram: MapTelegram | null;
  /**
   * The words before the one shown (decision 112): the 7 newest days with a word before `telegram.runDate`, or before
   * `runDate` when there is no word, newest first. Days with no word are left out. Only each day's date, word and band
   * are sent; its events stay in that day's own file. Absent in files made before it was added.
   */
  recent?: MapRecentWord[];
  /**
   * Where the day's GDELT local stories are, when they are kept out of this file (decision 78). Absent when the file
   * holds them itself, as the pipeline's own full view does.
   */
  local?: MapLocalIndex;
};

/**
 * The day's local stories are split into tiles by a fixed grid of longitude and latitude, so the day's file stays
 * small however many towns have news (decision 78). The site loads the tiles in view once it is zoomed in to where
 * local stories show.
 */
export type MapLocalIndex = {
  /** The grid's cell in degrees. A tile holds the places with lat in [south, south + deg) and lon in [west, west + deg). */
  deg: number;
  /** Where the tiles are, relative to the folder the day's file is served from: `${base}${key}.json`. */
  base: string;
  /** Every tile with a story, by key (tileKey: "40N_80W"), and how many stories it has. */
  tiles: Record<string, number>;
};

/** One tile's places and stories. A story's `place` indexes the tile's own places; the site joins them by id. */
export type MapTile = {
  version: 2;
  runDate: string;
  key: string;
  places: MapPlace[];
  /** Every story here is a GDELT local story (via "gdelt", importance 1, reach 1, no topic). Newest first. */
  items: MapTileItem[];
};

/** A local story in a tile, as a row: its id, unix seconds, headline, URL, the outlet's site, language, place. */
export type MapTileItem = [id: string, t: number, title: string, url: string, domain: string, lang: string, place: number];

/** The grid the daily run cuts tiles on (decision 78): 10 degrees, about 1,100 km north to south. */
export const LOCAL_TILE_DEG = 10;

/**
 * The key of the tile holding a point: the cell's south-west corner in whole degrees, "40N_80W" for the cell from
 * 40 to 50 degrees north and 80 to 70 degrees west. Letters rather than signs, so no file name starts with a dash.
 */
export function tileKey(lat: number, lon: number, deg = LOCAL_TILE_DEG): string {
  const south = Math.max(-90, Math.min(90 - deg, Math.floor(lat / deg) * deg));
  const west = Math.max(-180, Math.min(180 - deg, Math.floor(lon / deg) * deg));
  return `${Math.abs(south)}${south < 0 ? "S" : "N"}_${Math.abs(west)}${west < 0 ? "W" : "E"}`;
}

/** A tile key's cell, or null for anything that isn't a cell of the grid. */
export function tileBounds(key: string, deg = LOCAL_TILE_DEG): { south: number; west: number; north: number; east: number } | null {
  const m = /^(\d{1,2})([NS])_(\d{1,3})([EW])$/.exec(key);
  if (!m) return null;
  const south = Number(m[1]) * (m[2] === "S" ? -1 : 1);
  const west = Number(m[3]) * (m[4] === "W" ? -1 : 1);
  if (south % deg !== 0 || west % deg !== 0 || south < -90 || south > 90 - deg || west < -180 || west > 180 - deg) return null;
  // One spelling per cell: 0 is north and east.
  if ((south === 0 && m[2] === "S") || (west === 0 && m[4] === "W")) return null;
  return { south, west, north: south + deg, east: west + deg };
}

/**
 * Splits a full day (loadMapView) into the file the site opens and its tiles of local stories (decision 78). The
 * file keeps the outlets' stories, the events, the word and an index of the tiles; places only local stories use
 * go to their tiles. Places keep their ids, so a tile's place that the file already has is the same place.
 */
export function splitLocal(full: MapFile, base: string, deg = LOCAL_TILE_DEG): { main: MapFile; tiles: Map<string, MapTile> } {
  // The places the file still needs, in their order, so the file is the one the database gives with only an index.
  const used = new Set<number>();
  for (const it of full.items) if (it.via !== "gdelt") used.add(it.place);
  for (const ev of Object.values(full.events)) for (const p of ev.places) used.add(p);
  const places: MapPlace[] = [];
  const remap = new Map<number, number>();
  full.places.forEach((p, i) => {
    if (used.has(i)) remap.set(i, places.push(p) - 1);
  });
  const keep = (i: number): number => remap.get(i)!;
  const items: MapItem[] = [];
  const tiles = new Map<string, MapTile & { index: Map<number, number> }>();
  for (const it of full.items) {
    if (it.via !== "gdelt") {
      items.push({ ...it, place: keep(it.place) });
      continue;
    }
    const p = full.places[it.place]!;
    const key = tileKey(p.lat, p.lon, deg);
    let tile = tiles.get(key);
    if (!tile) tiles.set(key, (tile = { version: 2, runDate: full.runDate, key, places: [], items: [], index: new Map() }));
    let at = tile.index.get(it.place);
    if (at === undefined) tile.index.set(it.place, (at = tile.places.push(p) - 1));
    tile.items.push([it.id, it.t, it.title, it.url, it.domain, it.lang, at]);
  }
  const events: Record<string, MapEvent> = {};
  for (const [id, ev] of Object.entries(full.events)) events[id] = { ...ev, places: ev.places.map(keep) };
  const out = new Map<string, MapTile>();
  for (const key of [...tiles.keys()].sort()) {
    const { index: _, ...tile } = tiles.get(key)!;
    tile.items.sort((a, b) => b[1] - a[1]);
    out.set(key, tile);
  }
  const main: MapFile = { ...full, places, items, events, local: { deg, base, tiles: Object.fromEntries([...out].map(([k, t]) => [k, t.items.length])) } };
  return { main, tiles: out };
}

export function placeIdFor(lat: number, lon: number): string {
  return `ll:${lat.toFixed(2)},${lon.toFixed(2)}`;
}
