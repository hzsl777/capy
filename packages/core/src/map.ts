// The contract between the database and the public map. The Worker builds it from the database with
// loadMapView; the site renders it. Type-only, so the site imports it without pulling in zod.
import type { WorldTopic } from "./world.js";

export type MapPlace = {
  /** Stable across runs, used for pins: "ll:<lat>,<lon>" of the publisher's place. */
  id: string;
  /** City or area where the publishers publish from. Shown in the panel, never on the map. */
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
  /** Index into MapFile.places: the publisher's place. */
  place: number;
  /** Set when the article's event was reported from two or more places. */
  story?: string;
  /** Event id with a verified explanation the reader can open (MapFile.events). */
  event?: number;
  /** The outlet's own short summary from its feed, at most 300 characters. Never article body text. */
  excerpt?: string;
  image?: string;
  embed?: boolean;
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
};

export function placeIdFor(lat: number, lon: number): string {
  return `ll:${lat.toFixed(2)},${lon.toFixed(2)}`;
}
