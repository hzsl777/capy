/**
 * Reads GDELT 2.0 Global Knowledge Graph files. GDELT publishes a new file every
 * 15 minutes for English sources and a "translingual" file for sources in about
 * 65 other languages. Free, no key. Docs: https://blog.gdeltproject.org/gdelt-2-0-our-global-world-in-realtime/
 */
import { unzipSync } from "fflate";
import { parseGkgLine, type GkgRecord } from "./gkg.ts";

export type Feed = "en" | "translation";

const LAST_UPDATE: Record<Feed, string> = {
  en: "http://data.gdeltproject.org/gdeltv2/lastupdate.txt",
  translation: "http://data.gdeltproject.org/gdeltv2/lastupdate-translation.txt",
};

const STEP = 15 * 60;

/** "20260927031500" <-> unix seconds */
export function stampToUnix(s: string): number {
  return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12)) / 1000;
}
export function unixToStamp(t: number): string {
  return new Date(t * 1000).toISOString().replace(/[-:T]/g, "").slice(0, 12) + "00";
}

export function fileUrl(feed: Feed, stamp: string): string {
  const kind = feed === "en" ? "gkg" : "translation.gkg";
  return `http://data.gdeltproject.org/gdeltv2/${stamp}.${kind}.csv.zip`;
}

/**
 * The 15-minute stamps to fetch: everything after `last`, up to `latest`,
 * keeping only the newest `max` so a cold start doesn't download a day of files.
 */
export function stampsToFetch(last: string | undefined, latest: string, max: number): string[] {
  const end = stampToUnix(latest);
  const start = last ? stampToUnix(last) + STEP : end - (max - 1) * STEP;
  const out: string[] = [];
  for (let t = start; t <= end; t += STEP) out.push(unixToStamp(t));
  return out.slice(-max);
}

export async function latestStamp(feed: Feed): Promise<string> {
  const res = await fetch(LAST_UPDATE[feed], { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`lastupdate ${feed}: HTTP ${res.status}`);
  const m = /(\d{14})\.(?:translation\.)?gkg\.csv\.zip/.exec(await res.text());
  if (!m) throw new Error(`lastupdate ${feed}: no gkg file listed`);
  return m[1];
}

export function parseGkgZip(zip: Uint8Array): GkgRecord[] {
  const files = unzipSync(zip);
  const out: GkgRecord[] = [];
  for (const data of Object.values(files)) {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(data);
    for (const line of text.split("\n")) {
      if (!line) continue;
      const rec = parseGkgLine(line.replace(/\r$/, ""));
      if (rec) out.push(rec);
    }
  }
  return out;
}

export async function fetchGkg(feed: Feed, stamp: string): Promise<GkgRecord[]> {
  const res = await fetch(fileUrl(feed, stamp), { signal: AbortSignal.timeout(120_000) });
  if (res.status === 404) return []; // GDELT occasionally skips a slot
  if (!res.ok) throw new Error(`${feed} ${stamp}: HTTP ${res.status}`);
  return parseGkgZip(new Uint8Array(await res.arrayBuffer()));
}
