/**
 * Parser for GDELT Global Knowledge Graph 2.1 rows (tab separated, 27 columns).
 * Column reference: GDELT GKG 2.1 codebook. Only the columns the app needs are read.
 */
import { toBcp47 } from "./langs.ts";

const COL = {
  id: 0,
  date: 1,
  collection: 2,
  domain: 3,
  url: 4,
  themes: 7,
  locationsV1: 9,
  locationsV2: 10,
  persons: 11,
  orgs: 13,
  sharingImage: 18,
  translationInfo: 25,
  extras: 26,
} as const;

export interface GkgLocation {
  /** 1 country, 2 US state, 3 US city, 4 world city, 5 world state/province. */
  type: number;
  fullName: string;
  lat: number;
  lon: number;
  featureId: string;
  /** Character offset of the first mention; lower is closer to the dateline. */
  offset: number;
}

export interface GkgRecord {
  id: string;
  /** Unix seconds. */
  t: number;
  domain: string;
  url: string;
  title: string;
  lang: string;
  themes: string[];
  persons: string[];
  orgs: string[];
  locations: GkgLocation[];
  image?: string;
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ndash: "-", mdash: "-", hellip: "...", rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** GKG dates are YYYYMMDDHHMMSS in UTC. */
export function parseGkgDate(s: string): number {
  if (!/^\d{14}$/.test(s)) return NaN;
  return (
    Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14)) /
    1000
  );
}

function list(field: string | undefined): string[] {
  if (!field) return [];
  return field.split(";").filter(Boolean);
}

export function parseLocations(v2: string | undefined, v1: string | undefined): GkgLocation[] {
  const out: GkgLocation[] = [];
  if (v2) {
    for (const block of list(v2)) {
      const p = block.split("#");
      if (p.length < 9) continue;
      const lat = parseFloat(p[5]);
      const lon = parseFloat(p[6]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      out.push({ type: +p[0], fullName: p[1], lat, lon, featureId: p[7], offset: +p[8] || 0 });
    }
    if (out.length) return out;
  }
  for (const [i, block] of list(v1).entries()) {
    const p = block.split("#");
    if (p.length < 7) continue;
    const lat = parseFloat(p[4]);
    const lon = parseFloat(p[5]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push({ type: +p[0], fullName: p[1], lat, lon, featureId: p[6], offset: i });
  }
  return out;
}

export function parseGkgLine(line: string): GkgRecord | null {
  const c = line.split("\t");
  if (c.length < 27) return null;
  if (c[COL.collection] !== "1") return null; // 1 = web articles; skip other collections
  const url = c[COL.url];
  if (!/^https?:\/\//.test(url)) return null;
  const titleMatch = /<PAGE_TITLE>([\s\S]*?)<\/PAGE_TITLE>/.exec(c[COL.extras] ?? "");
  const title = titleMatch ? decodeEntities(titleMatch[1]).replace(/\s+/g, " ").trim() : "";
  if (!title) return null;
  const t = parseGkgDate(c[COL.date]);
  if (!Number.isFinite(t)) return null;
  const srclc = /srclc:([a-z]{2,3})/i.exec(c[COL.translationInfo] ?? "");
  const image = c[COL.sharingImage]?.trim();
  return {
    id: c[COL.id],
    t,
    domain: c[COL.domain].toLowerCase(),
    url,
    title,
    lang: srclc ? toBcp47(srclc[1]) : "en",
    themes: list(c[COL.themes]),
    persons: list(c[COL.persons]),
    orgs: list(c[COL.orgs]),
    locations: parseLocations(c[COL.locationsV2], c[COL.locationsV1]),
    image: image && /^https:\/\//.test(image) ? image : undefined,
  };
}
