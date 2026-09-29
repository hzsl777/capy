// Local stories from GDELT (decision 54) on a real Postgres engine, with GDELT's files built here: no network.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { toRunDate } from "@2dayai/core";
import { articles, eventArticles, events, loadMapView, localStories, sources, type Db } from "@2dayai/db";
import { forEachLine, gdeltFileUrls, parseGkgRow, runLocal } from "./stages/local.js";
import { runPrune } from "./stages/prune.js";
import { createTestDb } from "./test/db.js";

const date = toRunDate("2026-09-27");
let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
}, 60_000);
afterAll(async () => {
  await close();
});

type Town = { type?: string; name: string; lat: number; lon: number; id: string; offset?: number };
/** One GKG 2.1 row: 27 tab-separated columns, with only the ones the stage reads filled in. */
function row(o: { url: string; title?: string; when?: string; towns?: Town[]; lang?: string; collection?: string }): string {
  const c = Array.from({ length: 27 }, () => "");
  c[0] = `${o.when ?? "20260927030000"}-1`;
  c[1] = o.when ?? "20260927030000";
  c[2] = o.collection ?? "1";
  c[3] = new URL(o.url).hostname;
  c[4] = o.url;
  c[10] = (o.towns ?? []).map((t) => [t.type ?? "4", t.name, "XX", "XX00", "", t.lat, t.lon, t.id, t.offset ?? 100].join("#")).join(";");
  if (o.lang) c[25] = `srclc:${o.lang};eng:GT-ITA 1.0`;
  if (o.title !== undefined) c[26] = `<PAGE_LINKS></PAGE_LINKS><PAGE_TITLE>${o.title}</PAGE_TITLE>`;
  return c.join("\t");
}
const zip = (rows: string[]) => zipSync({ "x.gkg.csv": strToU8(rows.join("\n")) });

// Towns on the city list: Trento and Bolzano (Trentino-Alto Adige), Nakuru (Kenya), and a point near Nakuru that is
// not on the list.
const TRENTO = { name: "Trento, Trentino-Alto Adige, Italy", lat: 46.0667, lon: 11.1167, id: "-126693" };
const NAKURU = { name: "Nakuru, Nakuru, Kenya", lat: -0.2833, lon: 36.0667, id: "-1300" };
const NJORO = { name: "Njoro, Nakuru, Kenya", lat: -0.3294, lon: 35.9444, id: "-1301" };

describe("reading a GDELT row", () => {
  it("takes the title, the language and the town the article names most", () => {
    const a = parseGkgRow(row({ url: "https://www.ladige.it/a", title: "Il consiglio provinciale approva il bilancio &amp; il piano", lang: "ita", towns: [{ ...TRENTO, offset: 300 }, { ...NAKURU, offset: 10 }, { ...TRENTO, offset: 500 }] }), true)!;
    expect(a).toMatchObject({ domain: "www.ladige.it", title: "Il consiglio provinciale approva il bilancio & il piano", lang: "it", town: { name: "Trento" } });
    expect(a.publishedAt.toISOString()).toBe("2026-09-27T03:00:00.000Z");
  });

  it("skips rows with no title, a short title, no town, only a country or state, or not from the web", () => {
    expect(parseGkgRow(row({ url: "https://a.example/1", towns: [TRENTO] }), false)).toBeNull();
    expect(parseGkgRow(row({ url: "https://a.example/2", title: "Short", towns: [TRENTO] }), false)).toBeNull();
    expect(parseGkgRow(row({ url: "https://a.example/3", title: "A long enough headline about nothing" }), false)).toBeNull();
    expect(parseGkgRow(row({ url: "https://a.example/4", title: "A long enough headline about Italy", towns: [{ ...TRENTO, type: "1" }, { ...TRENTO, type: "5" }] }), false)).toBeNull();
    expect(parseGkgRow(row({ url: "https://a.example/5", title: "A long enough headline about Trento", towns: [TRENTO], collection: "2" }), false)).toBeNull();
  });

  it("reads a large file a chunk at a time without splitting a line or a letter", () => {
    // About 12 MB unzipped, so the stream hands it over in many chunks.
    const lines = Array.from({ length: 4000 }, (_, i) => `${i}\t${"São Tomé é aqui ".repeat(200)}`);
    const got: string[] = [];
    forEachLine(zipSync({ "big.csv": strToU8(lines.join("\n")) }), (l) => got.push(l));
    expect(got).toHaveLength(4000);
    expect(got.every((l, i) => l === lines[i])).toBe(true);
  });

  it("lists every quarter hour of the day's window, in English and translated", () => {
    const urls = gdeltFileUrls(date);
    expect(urls).toHaveLength(96 * 2);
    expect(urls[0]).toBe("http://data.gdeltproject.org/gdeltv2/20260926090000.gkg.csv.zip");
    expect(urls[1]).toBe("http://data.gdeltproject.org/gdeltv2/20260926090000.translation.gkg.csv.zip");
    expect(urls.at(-1)).toBe("http://data.gdeltproject.org/gdeltv2/20260927084500.translation.gkg.csv.zip");
  });
});

describe("local stories for regions no outlet reached", () => {
  const nakuru = (n: number, hour: string) => row({ url: `https://www.kenyans.co.ke/n${n}`, title: `Nakuru county assembly story number ${n}`, when: `20260927${hour}0000`, towns: [NAKURU] });
  const files = (translated: string[], english: string[]) => async (url: string) => {
    if (url.endsWith("20260927030000.translation.gkg.csv.zip")) return zip(translated);
    if (url.endsWith("20260927030000.gkg.csv.zip")) return zip(english);
    return null;
  };

  it("keeps the newest few per region, placed at the checked town, and skips repeats and other days", async () => {
    const english = [
      nakuru(1, "01"), nakuru(2, "05"), nakuru(3, "03"), nakuru(4, "02"),
      nakuru(3, "03"), // the same URL again
      row({ url: "https://other.example/copy", title: "Nakuru county assembly story number 2", when: "20260927040000", towns: [NAKURU] }), // same title
      row({ url: "https://www.kenyans.co.ke/njoro", title: "Njoro farmers open a new market this week", when: "20260927040000", towns: [NJORO] }),
      row({ url: "https://www.kenyans.co.ke/old", title: "An older Nakuru story from the day before", when: "20260925040000", towns: [NAKURU] }),
    ];
    const report = await runLocal(db, date, 3, files([row({ url: "https://www.ladige.it/a", title: "Il consiglio provinciale approva il bilancio", lang: "ita", towns: [TRENTO] })], english));
    expect(report).toMatchObject({ files: 192, filesMissing: 190, filesFailed: 0, regionsFilled: 2, stories: 4 });
    const rows = await db.select().from(localStories);
    const kenya = rows.filter((r) => r.region.startsWith("KE/")).sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
    // Newest three: 05:00, 04:00 (Njoro, an unlisted town near Nakuru, at its own point) and 03:00.
    expect(kenya.map((r) => r.title)).toEqual(["Nakuru county assembly story number 2", "Njoro farmers open a new market this week", "Nakuru county assembly story number 3"]);
    expect(kenya[1]).toMatchObject({ placeName: "Njoro", domain: "kenyans.co.ke", lang: "en" });
    expect(rows.find((r) => r.region.startsWith("IT/"))).toMatchObject({ placeName: "Trento", lang: "it" });

    const map = await loadMapView(db, date);
    const item = map.items.find((i) => i.title.startsWith("Il consiglio"))!;
    expect(item).toMatchObject({ via: "gdelt", publisher: "ladige.it", importance: 1, reach: 1, topics: [] });
    expect(map.places[item.place]!.name).toBe("Trento");
  });

  it("leaves out a region an outlet's story already reached, and replaces its own stories on a re-run", async () => {
    await db.insert(sources).values({ id: "nakuru-daily", name: "Nakuru Daily", url: "https://nd.example/rss", topic: "world", tier: "general", desk: "world", placeName: "Nakuru", lat: -0.2833, lon: 36.0667 });
    const [a] = await db.insert(articles).values({ sourceId: "nakuru-daily", url: "https://nd.example/1", title: "Water project opens", lead: "", publishedAt: new Date("2026-09-27T02:00:00Z") }).returning();
    const [e] = await db.insert(events).values({ runDate: date, title: "Water project opens", importance: 2, importanceReason: "x", promptVersion: "t", desk: "world", topic: "other" }).returning();
    await db.insert(eventArticles).values({ eventId: e!.id, articleId: a!.id });

    const report = await runLocal(db, date, 3, files([], [nakuru(9, "06"), row({ url: "https://www.ladige.it/b", title: "Trento, riapre la biblioteca comunale dopo i lavori", towns: [TRENTO] })]));
    expect(report.regionsFilled).toBe(1);
    const rows = await db.select().from(localStories);
    expect(rows.map((r) => r.title)).toEqual(["Trento, riapre la biblioteca comunale dopo i lavori"]);
  });

  it("keeps three days of local stories", async () => {
    const story = (runDate: string, n: number) => ({ runDate, url: `https://a.example/${n}`, title: "A local story of some length", domain: "a.example", publishedAt: new Date(`${runDate}T01:00:00Z`), placeName: "Trento", lat: 46.07, lon: 11.12, region: "IT/Trentino-Alto Adige" });
    await db.insert(localStories).values([story("2026-09-23", 1), story("2026-09-24", 2), story("2026-09-26", 3)]);
    expect((await runPrune(db, date, 30)).localStories).toBe(1);
    expect((await db.select().from(localStories)).map((r) => r.url).sort()).toContain("https://a.example/2");
    await db.delete(localStories);
  });

  it("writes nothing when turned off, and fails loudly when GDELT cannot be reached at all", async () => {
    expect(await runLocal(db, date, 0, async () => zip([]))).toMatchObject({ stories: 0, skipped: expect.any(String) });
    expect(await db.select().from(localStories)).toHaveLength(0);
    await expect(runLocal(db, date, 3, async () => { throw new Error("fetch failed"); })).rejects.toThrow(/none of the 192 GDELT files/);
  });
});
