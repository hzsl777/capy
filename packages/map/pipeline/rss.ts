/**
 * Optional hand-picked outlets (pipeline/sources.json). Each source is pinned to
 * its home city, so its stories show up there. Add sources with the
 * `add-news-source` skill, which covers verification and balance.
 */
import { XMLParser } from "fast-xml-parser";
import type { PoolItem } from "./pool.ts";
import { decodeEntities } from "./gkg.ts";
import { classify } from "./topics.ts";
import { placeId } from "./place.ts";
import { shortHash } from "./cluster.ts";
import { USER_AGENT } from "./enrich.ts";

export interface Source {
  name: string;
  feed: string;
  lang: string;
  place: { name: string; lat: number; lon: number };
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@" });

const text = (v: unknown): string =>
  typeof v === "string" ? v : typeof v === "object" && v && "#text" in v ? String((v as { "#text": unknown })["#text"]) : "";

export function parseFeed(xml: string, src: Source, now: number): PoolItem[] {
  const doc = parser.parse(xml);
  const rssItems = doc?.rss?.channel?.item ?? [];
  const atomItems = doc?.feed?.entry ?? [];
  const entries = [...(Array.isArray(rssItems) ? rssItems : [rssItems]), ...(Array.isArray(atomItems) ? atomItems : [atomItems])];
  const place = {
    id: placeId(undefined, src.place.lat, src.place.lon),
    name: src.place.name,
    lat: src.place.lat,
    lon: src.place.lon,
  };
  const out: PoolItem[] = [];
  for (const e of entries) {
    if (!e) continue;
    const title = decodeEntities(text(e.title)).replace(/\s+/g, " ").trim();
    let link = typeof e.link === "string" ? e.link : "";
    if (!link && e.link) {
      const links = Array.isArray(e.link) ? e.link : [e.link];
      link = links.find((l: Record<string, string>) => !l["@rel"] || l["@rel"] === "alternate")?.["@href"] ?? "";
    }
    if (!title || !/^https?:\/\//.test(link)) continue;
    const when = Date.parse(text(e.pubDate) || text(e.published) || text(e.updated));
    const t = Number.isFinite(when) ? Math.min(now, Math.floor(when / 1000)) : now;
    let domain = "";
    try {
      domain = new URL(link).hostname.replace(/^www\./, "");
    } catch {
      continue;
    }
    out.push({
      id: "r" + shortHash(link),
      t,
      title,
      url: link,
      domain,
      lang: src.lang,
      topics: classify([], link),
      place,
      entities: [],
    });
  }
  return out;
}

export async function fetchSources(sources: Source[], now: number): Promise<PoolItem[]> {
  const results = await Promise.allSettled(
    sources.map(async (src) => {
      const res = await fetch(src.feed, {
        headers: { "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`${src.name}: HTTP ${res.status}`);
      return parseFeed(await res.text(), src, now);
    }),
  );
  const out: PoolItem[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") out.push(...r.value);
    else console.warn(`[rss] ${r.reason}`);
  }
  return out;
}
