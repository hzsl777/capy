/**
 * Pipeline entry point: `npm run ingest`.
 *
 *   GDELT GKG (+ optional RSS) -> pick one place per article -> topics
 *   -> 24h rolling pool -> balance -> story groups -> reader metadata
 *   -> public/data/latest.json
 *
 * State between runs lives in $CAPY_STATE_DIR (default .cache/ingest). CI keeps
 * it with actions/cache. Flags:
 *   --fixture <file.csv>  parse a local GKG CSV instead of downloading (no network)
 *   --no-enrich           skip fetching preview metadata
 *   --out <file>          output path (default public/data/latest.json)
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import type { Item, NewsFile, Place } from "../src/types.ts";
import { parseGkgLine, type GkgRecord } from "./gkg.ts";
import { choosePlace } from "./place.ts";
import { classify } from "./topics.ts";
import { balance } from "./balance.ts";
import { cluster } from "./cluster.ts";
import { enrich, type Meta } from "./enrich.ts";
import { fetchGkg, latestStamp, stampsToFetch, type Feed } from "./gdelt.ts";
import { fetchSources, type Source } from "./rss.ts";
import type { PoolItem } from "./pool.ts";

const WINDOW = 24 * 3600;
const POOL_PER_PLACE = 80;
const COLD_START_FILES = Number(process.env.CAPY_COLD_START_FILES ?? 16); // 4 hours
const ENRICH_LIMIT = Number(process.env.CAPY_ENRICH_LIMIT ?? 600);

interface State {
  last: Partial<Record<Feed, string>>;
}

const stateDir = process.env.CAPY_STATE_DIR ?? ".cache/ingest";

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function toPoolItem(r: GkgRecord): PoolItem | null {
  const place = choosePlace(r.locations);
  if (!place) return null;
  return {
    id: r.id,
    t: r.t,
    title: r.title,
    url: r.url,
    domain: r.domain.replace(/^www\./, ""),
    lang: r.lang,
    topics: classify(r.themes, r.url),
    place,
    entities: [...r.persons, ...r.orgs].map((e) => e.toLowerCase()).slice(0, 30),
    image: r.image,
  };
}

/** Keeps the pool bounded: newest POOL_PER_PLACE items per place inside the window. */
function prune(pool: PoolItem[], now: number): PoolItem[] {
  const byUrl = new Map<string, PoolItem>();
  for (const it of pool) {
    if (now - it.t > WINDOW) continue;
    const prev = byUrl.get(it.url);
    if (!prev || it.t < prev.t) byUrl.set(it.url, it);
  }
  const perPlace = new Map<string, number>();
  return [...byUrl.values()]
    .sort((a, b) => b.t - a.t)
    .filter((it) => {
      const n = (perPlace.get(it.place.id) ?? 0) + 1;
      perPlace.set(it.place.id, n);
      return n <= POOL_PER_PLACE;
    });
}

export function toNewsFile(items: PoolItem[], meta: Map<string, Meta>, now: number, source: NewsFile["source"]): NewsFile {
  const places: Place[] = [];
  const placeIndex = new Map<string, number>();
  const out: Item[] = [];
  for (const it of items) {
    let idx = placeIndex.get(it.place.id);
    if (idx === undefined) {
      idx = places.push(it.place) - 1;
      placeIndex.set(it.place.id, idx);
    }
    const m = meta.get(it.url);
    const item: Item = {
      id: it.id,
      t: it.t,
      title: it.title,
      url: it.url,
      domain: it.domain,
      lang: it.lang,
      topics: it.topics,
      place: idx,
    };
    if (it.story) item.story = it.story;
    const image = m?.image ?? it.image;
    if (image) item.image = image;
    if (m?.excerpt) item.excerpt = m.excerpt;
    if (m?.embed) item.embed = true;
    out.push(item);
  }
  return { version: 1, source, generatedAt: now, places, items: out };
}

async function main() {
  const { values: args } = parseArgs({
    options: {
      fixture: { type: "string" },
      "no-enrich": { type: "boolean", default: false },
      out: { type: "string", default: "public/data/latest.json" },
    },
  });
  await mkdir(stateDir, { recursive: true });
  const statePath = join(stateDir, "state.json");
  const poolPath = join(stateDir, "pool.json");
  const metaPath = join(stateDir, "meta.json");
  const state = await readJson<State>(statePath, { last: {} });
  let pool = await readJson<PoolItem[]>(poolPath, []);
  const meta = new Map(Object.entries(await readJson<Record<string, Meta>>(metaPath, {})));
  let now = Math.floor(Date.now() / 1000);

  const fresh: PoolItem[] = [];
  if (args.fixture) {
    const text = await readFile(args.fixture, "utf8");
    for (const line of text.split("\n")) {
      const rec = line && parseGkgLine(line);
      const it = rec && toPoolItem(rec);
      if (it) fresh.push(it);
    }
    // Fixtures are old; anchor "now" to them so the 24h window keeps them.
    if (fresh.length) now = Math.max(...fresh.map((f) => f.t));
  } else {
    for (const feed of ["en", "translation"] as Feed[]) {
      try {
        const latest = await latestStamp(feed);
        const stamps = stampsToFetch(state.last[feed], latest, COLD_START_FILES);
        for (const stamp of stamps) {
          const recs = await fetchGkg(feed, stamp);
          let kept = 0;
          for (const r of recs) {
            const it = toPoolItem(r);
            if (it) {
              fresh.push(it);
              kept++;
            }
          }
          console.log(`[gdelt] ${feed} ${stamp}: ${recs.length} records, ${kept} placed`);
          state.last[feed] = stamp;
        }
      } catch (e) {
        console.warn(`[gdelt] ${feed}: ${(e as Error).message}`);
      }
    }
  }

  const sources = await readJson<Source[]>("pipeline/sources.json", []);
  const rss = !args.fixture && sources.length ? await fetchSources(sources, now) : [];
  if (sources.length) console.log(`[rss] ${rss.length} items from ${sources.length} sources`);

  pool = prune([...pool, ...fresh, ...rss], now);
  const shown = balance(pool);
  cluster(shown);

  if (!args["no-enrich"] && !args.fixture) {
    const n = await enrich(
      shown.map((s) => s.url),
      meta,
      { limit: ENRICH_LIMIT, concurrency: 16, timeoutMs: 8000 },
    );
    console.log(`[enrich] fetched ${n} previews`);
  }
  for (const [url, m] of meta) if (now - m.at > WINDOW * 2) meta.delete(url);

  const file = toNewsFile(shown, meta, now, rss.length ? "mixed" : "gdelt");
  await mkdir(dirname(args.out!), { recursive: true });
  await writeFile(args.out!, JSON.stringify(file));
  await writeFile(statePath, JSON.stringify(state));
  await writeFile(poolPath, JSON.stringify(pool));
  await writeFile(metaPath, JSON.stringify(Object.fromEntries(meta)));
  console.log(
    `[out] ${file.items.length} items across ${file.places.length} places, ` +
      `${new Set(file.items.map((i) => i.story).filter(Boolean)).size} multi-place stories -> ${args.out}`,
  );
  if (!file.items.length && !args.fixture) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
