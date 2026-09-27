/**
 * The data contract between the ingest pipeline and the web app.
 * The pipeline writes one `NewsFile` to public/data/latest.json.
 * Change this file first, then both sides. See AGENTS.md "Data contract".
 */

export const TOPICS = [
  "politics",
  "economy",
  "conflict",
  "environment",
  "health",
  "science",
  "justice",
  "culture",
  "sport",
] as const;
export type Topic = (typeof TOPICS)[number];

export interface Place {
  /** Stable across runs: "g:<gdelt feature id>" or "ll:<lat>,<lon>". Used for pins. */
  id: string;
  /** Short place name (city or area), never a country. Shown in the panel, never on the map. */
  name: string;
  lat: number;
  lon: number;
}

export interface Item {
  id: string;
  /** Unix seconds when first seen. */
  t: number;
  title: string;
  url: string;
  /** Outlet hostname, e.g. "example.com". */
  domain: string;
  /** BCP 47 language of `title` (e.g. "en", "fr"), or "und" if unknown. */
  lang: string;
  topics: Topic[];
  /** Index into NewsFile.places. */
  place: number;
  /** Story cluster id when other places covered the same story. */
  story?: string;
  /** Lead image URL published by the outlet (og:image or GDELT sharing image). */
  image?: string;
  /** The outlet's own short description (og:description), max ~300 chars. Never article body text. */
  excerpt?: string;
  /** True when the outlet's headers allow the page to be shown in an iframe. */
  embed?: boolean;
}

export interface NewsFile {
  version: 1;
  /** "gdelt" for live data, "sample" for the placeholder fixture. */
  source: "gdelt" | "sample" | "mixed";
  /** Unix seconds. Time filters are relative to this, not the viewer's clock. */
  generatedAt: number;
  places: Place[];
  items: Item[];
}
