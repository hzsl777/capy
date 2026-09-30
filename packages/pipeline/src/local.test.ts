// Local stories from GDELT (decisions 54, 67 and 78) on a real Postgres engine, with GDELT's files built here: no network.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { ingestWindow, rollingWindow, toRunDate } from "@2dayai/core";
import { articles, eventArticles, events, loadMapView, localStories, sources, type Db } from "@2dayai/db";
import { gkgRow as row, gkgZip as zip } from "./fixtures/gdelt.js";
import { forEachLine, gdeltFileUrls, parseGkgRow, pickLocal, runLocal, type LocalCandidate, type TownCandidates } from "./stages/local.js";
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

// Towns on the city list: Trento and Bolzano (Trentino-Alto Adige), Nakuru (Kenya), and a point near Nakuru that is
// not on the list.
const TRENTO = { name: "Trento, Trentino-Alto Adige, Italy", lat: 46.0667, lon: 11.1167, id: "-126693" };
const NAKURU = { name: "Nakuru, Nakuru, Kenya", lat: -0.2833, lon: 36.0667, id: "-1300" };
const NJORO = { name: "Njoro, Nakuru, Kenya", lat: -0.3294, lon: 35.9444, id: "-1301" };
// Naivasha: a GeoNames town in the same region as Nakuru, 60 km away. Rovereto: a GeoNames town near Trento.
// Nakuru West: a name no list has, 2 km from Nakuru, so GDELT's own point is used, and it is Nakuru's own town.
const NAIVASHA = { name: "Naivasha, Nakuru, Kenya", lat: -0.7167, lon: 36.4333, id: "-1302" };
const ROVERETO = { name: "Rovereto, Trentino-Alto Adige, Italy", lat: 45.8897, lon: 11.0397, id: "-126700" };
// Columbus, Georgia shares its name with the larger Columbus, Ohio on the city list.
const COLUMBUS_GA = { type: "3", name: "Columbus, Georgia, United States", lat: 32.461, lon: -84.9877, id: "GA13" };
const NAKURU_WEST = { name: "Nakuru West, Nakuru, Kenya", lat: -0.2833, lon: 36.0487, id: "-1303" };

/** Per town, per day. */
const limits = (perTown: number, max = 80_000) => ({ perTown, max });

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
    // About 12 MB unzipped and, like real GDELT text, not endlessly repetitive, so it compresses the way news does.
    let seed = 1;
    const word = () => ["São", "Tomé", "é", "aqui", "Nakuru", "Trento", "река", "市长", "council", "budget"][(seed = (seed * 16807) % 2147483647) % 10];
    const lines = Array.from({ length: 4000 }, (_, i) => `${i}\t${Array.from({ length: 450 }, word).join(" ")}`);
    const got: string[] = [];
    const chunks = forEachLine(zipSync({ "big.csv": strToU8(lines.join("\n")) }), (l) => got.push(l));
    // Handed the whole zip at once, the unzipper returned the whole file as one chunk, and every string kept from
    // it kept the whole file in memory: the daily job ran out of memory on real GDELT files.
    expect(chunks).toBeGreaterThan(20);
    expect(got).toHaveLength(4000);
    expect(got.every((l, i) => l === lines[i])).toBe(true);
  });

  it("lists every quarter hour of the day's window, in English and translated", () => {
    const urls = gdeltFileUrls(ingestWindow(date));
    expect(urls).toHaveLength(96 * 2);
    expect(urls[0]).toBe("http://data.gdeltproject.org/gdeltv2/20260927000000.gkg.csv.zip");
    expect(urls[1]).toBe("http://data.gdeltproject.org/gdeltv2/20260927000000.translation.gkg.csv.zip");
    expect(urls.at(-1)).toBe("http://data.gdeltproject.org/gdeltv2/20260927234500.translation.gkg.csv.zip");
  });
});

describe("local stories for towns no outlet reached", () => {
  const nakuru = (n: number, hour: string) => row({ url: `https://www.kenyans.co.ke/n${n}`, title: `Nakuru county assembly story number ${n}`, when: `20260927${hour}0000`, towns: [NAKURU] });
  const files = (translated: string[], english: string[]) => async (url: string) => {
    if (url.endsWith("20260927030000.translation.gkg.csv.zip")) return zip(translated);
    if (url.endsWith("20260927030000.gkg.csv.zip")) return zip(english);
    return null;
  };

  it("keeps each town's newest two, placed at the checked town, and skips repeats and other days", async () => {
    const english = [
      nakuru(1, "01"), nakuru(2, "05"), nakuru(3, "03"), nakuru(4, "02"),
      nakuru(3, "03"), // the same URL again
      row({ url: "https://other.example/copy", title: "Nakuru county assembly story number 2", when: "20260927040000", towns: [NAKURU] }), // same title
      row({ url: "https://www.kenyans.co.ke/njoro", title: "Njoro farmers open a new market this week", when: "20260927040000", towns: [NJORO] }),
      row({ url: "https://www.kenyans.co.ke/old", title: "An older Nakuru story from the day before", when: "20260925040000", towns: [NAKURU] }),
    ];
    const report = await runLocal(db, date, limits(2), files([row({ url: "https://www.ladige.it/a", title: "Il consiglio provinciale approva il bilancio", lang: "ita", towns: [TRENTO] })], english));
    expect(report).toMatchObject({ files: 192, filesMissing: 190, filesFailed: 0, regionsFilled: 2, stories: 4, towns: 3, townsTagged: 3, townsNearOutlet: 0 });
    const rows = await db.select().from(localStories);
    const kenya = rows.filter((r) => r.region.startsWith("KE/")).sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
    // Nakuru's two newest, at 05:00 and 03:00, and Njoro's one, a GeoNames town 15 km away.
    expect(kenya.map((r) => r.title)).toEqual(["Nakuru county assembly story number 2", "Njoro farmers open a new market this week", "Nakuru county assembly story number 3"]);
    expect(kenya[1]).toMatchObject({ placeName: "Njoro", domain: "kenyans.co.ke", lang: "en" });
    expect(rows.find((r) => r.region.startsWith("IT/"))).toMatchObject({ placeName: "Trento", lang: "it" });

    const map = await loadMapView(db, date);
    const item = map.items.find((i) => i.title.startsWith("Il consiglio"))!;
    expect(item).toMatchObject({ via: "gdelt", publisher: "ladige.it", importance: 1, reach: 1, topics: [] });
    expect(map.places[item.place]!.name).toBe("Trento");
    // Two towns 15 km apart are two places; the site merges nearby dots by zoom and names both.
    const njoroItem = map.items.find((i) => i.title.startsWith("Njoro"))!;
    const nakuruItem = map.items.find((i) => i.title === "Nakuru county assembly story number 2")!;
    expect(map.places[njoroItem.place]!.name).toBe("Njoro");
    expect(njoroItem.place).not.toBe(nakuruItem.place);
  });

  it("gives every town its newest story before any town gets a second, and reads a shared name as the nearest", async () => {
    const trento = (n: number, hour: string) => row({ url: `https://www.ladige.it/t${n}`, title: `Trento city council story number ${n}`, when: `20260927${hour}0000`, towns: [TRENTO] });
    const english = [
      trento(1, "07"), trento(2, "06"), trento(3, "05"), trento(4, "04"),
      row({ url: "https://www.ladige.it/r1", title: "Rovereto opens its new school this autumn", when: "20260927010000", towns: [ROVERETO] }),
      row({ url: "https://www.ledger-enquirer.com/a", title: "Columbus city council meets on the river walk", when: "20260927020000", towns: [COLUMBUS_GA] }),
    ];
    // Over the day's limit of three: each town's newest, Rovereto's although it is the oldest, before Trento's second.
    const capped = await runLocal(db, date, limits(2, 3), files([], english));
    expect(capped).toMatchObject({ stories: 3, towns: 3, overMax: 1 });
    expect((await db.select().from(localStories)).map((r) => r.title).sort()).toEqual(["Columbus city council meets on the river walk", "Rovereto opens its new school this autumn", "Trento city council story number 1"]);
    const report = await runLocal(db, date, limits(2), files([], english));
    expect(report).toMatchObject({ regionsFilled: 2, stories: 4, towns: 3, overMax: 0 });
    const rows = await db.select().from(localStories);
    const italy = rows.filter((r) => r.region.startsWith("IT/")).sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
    expect(italy.map((r) => r.title)).toEqual(["Trento city council story number 1", "Trento city council story number 2", "Rovereto opens its new school this autumn"]);
    expect(italy.find((r) => r.placeName === "Rovereto")).toBeDefined();
    // Columbus, Georgia stays in Georgia; the city list's larger Columbus is in Ohio.
    const columbus = rows.find((r) => r.placeName === "Columbus")!;
    expect(columbus.region).toBe("US/Georgia");
    expect(columbus.lat).toBeCloseTo(32.46, 1);
  });

  it("leaves out the town an outlet's story sits in, and replaces its own stories on a re-run", async () => {
    await db.insert(sources).values({ id: "nakuru-daily", name: "Nakuru Daily", url: "https://nd.example/rss", topic: "world", tier: "general", desk: "world", placeName: "Nakuru", lat: -0.2833, lon: 36.0667 });
    const [a] = await db.insert(articles).values({ sourceId: "nakuru-daily", url: "https://nd.example/1", title: "Water project opens", lead: "", publishedAt: new Date("2026-09-27T02:00:00Z") }).returning();
    const [e] = await db.insert(events).values({ runDate: date, title: "Water project opens", importance: 2, importanceReason: "x", promptVersion: "t", desk: "world", topic: "other" }).returning();
    await db.insert(eventArticles).values({ eventId: e!.id, articleId: a!.id });

    const west = row({ url: "https://www.kenyans.co.ke/west", title: "Nakuru West ward gets new street lights", when: "20260927060000", towns: [NAKURU_WEST] });
    const report = await runLocal(db, date, limits(2), files([], [nakuru(9, "06"), west, row({ url: "https://www.ladige.it/b", title: "Trento, riapre la biblioteca comunale dopo i lavori", towns: [TRENTO] })]));
    // Nakuru and a point 2 km from it are the outlet's town.
    expect(report).toMatchObject({ regionsFilled: 1, townsTagged: 3, townsNearOutlet: 2 });
    const rows = await db.select().from(localStories);
    expect(rows.map((r) => r.title)).toEqual(["Trento, riapre la biblioteca comunale dopo i lavori"]);
  });

  it("gives the towns around an outlet's town their own stories (decision 78)", async () => {
    const naivasha = (n: number, hour: string) => row({ url: `https://www.kenyans.co.ke/v${n}`, title: `Naivasha lake level story number ${n}`, when: `20260927${hour}0000`, towns: [NAIVASHA] });
    const english = [
      nakuru(10, "07"),
      row({ url: "https://www.kenyans.co.ke/njoro2", title: "Njoro college opens a new library wing", when: "20260927070000", towns: [NJORO] }),
      naivasha(1, "01"), naivasha(2, "03"), naivasha(3, "02"),
    ];
    const report = await runLocal(db, date, limits(2), files([], english));
    // Nakuru has the outlet's story. Njoro, 15 km away, and Naivasha, 60 km away, are towns of their own.
    expect(report).toMatchObject({ regionsFilled: 0, regionsAdded: 1, stories: 3, towns: 2 });
    const rows = await db.select().from(localStories);
    expect(rows.map((r) => r.title).sort()).toEqual(["Naivasha lake level story number 2", "Naivasha lake level story number 3", "Njoro college opens a new library wing"]);
    expect(rows[0]!.region).toBe("KE/Rift Valley");
  });

  it("keeps three days of local stories", async () => {
    const story = (runDate: string, n: number) => ({ runDate, url: `https://a.example/${n}`, title: "A local story of some length", domain: "a.example", publishedAt: new Date(`${runDate}T01:00:00Z`), placeName: "Trento", lat: 46.07, lon: 11.12, region: "IT/Trentino-Alto Adige" });
    await db.insert(localStories).values([story("2026-09-23", 1), story("2026-09-24", 2), story("2026-09-26", 3)]);
    expect((await runPrune(db, date, 30)).localStories).toBe(1);
    expect((await db.select().from(localStories)).map((r) => r.url).sort()).toContain("https://a.example/2");
    await db.delete(localStories);
  });

  it("refreshes the day's local stories from the last 24 hours, past the day's window (decision 80)", async () => {
    const afternoon = row({ url: "https://www.ladige.it/pm", title: "Trento, the afternoon council session ends early", when: "20260928131500", towns: [TRENTO] });
    const morning = row({ url: "https://www.ladige.it/am", title: "Trento, the morning market moves to the square", when: "20260927030000", towns: [TRENTO] });
    const refreshFiles = async (url: string) => (url.endsWith("20260928131500.gkg.csv.zip") ? zip([afternoon]) : url.endsWith("20260927030000.gkg.csv.zip") ? zip([morning]) : null);
    // The daily run reads the day's window, which closes at midnight: the next afternoon's story is not in it.
    await runLocal(db, date, limits(2), refreshFiles);
    expect((await db.select().from(localStories)).map((r) => r.title)).toEqual(["Trento, the morning market moves to the square"]);
    const before = await loadMapView(db, date, new Date("2026-09-28T14:07:00Z"));
    expect(before.generatedAt).toBe(Date.parse("2026-09-28T00:00:00Z") / 1000);

    // The refresh the next afternoon reads the 24 hours before its last quarter hour: the morning story is still in.
    const window = rollingWindow(new Date("2026-09-28T02:07:00Z"));
    expect(window).toEqual({ from: new Date("2026-09-27T02:00:00Z"), to: new Date("2026-09-28T02:00:00Z") });
    const later = rollingWindow(new Date("2026-09-28T14:07:00Z"));
    expect((await runLocal(db, date, limits(2), refreshFiles, undefined, window)).stories).toBe(1);
    // Twelve hours later the morning story has left the last 24 hours and the afternoon one has come in.
    const report = await runLocal(db, date, limits(2), refreshFiles, undefined, later);
    expect(report).toMatchObject({ files: 192, stories: 1 });
    expect((await db.select().from(localStories)).map((r) => r.title)).toEqual(["Trento, the afternoon council session ends early"]);
    // The file says it is as new as its newest story, never newer than now.
    const after = await loadMapView(db, date, new Date("2026-09-28T14:07:00Z"));
    expect(after.generatedAt).toBe(Date.parse("2026-09-28T13:15:00Z") / 1000);
    expect((await loadMapView(db, date, new Date("2026-09-28T12:00:00Z"))).generatedAt).toBe(Date.parse("2026-09-28T12:00:00Z") / 1000);
    await db.delete(localStories);
  });

  it("writes nothing when turned off, and fails loudly when GDELT cannot be reached at all", async () => {
    expect(await runLocal(db, date, limits(0), async () => zip([]))).toMatchObject({ stories: 0, skipped: expect.any(String) });
    expect(await db.select().from(localStories)).toHaveLength(0);
    await expect(runLocal(db, date, limits(2), async () => { throw new Error("fetch failed"); })).rejects.toThrow(/none of the 192 GDELT files/);
  });
});

describe("choosing the day's local stories (decision 78)", () => {
  const at = (t: number, town: string): LocalCandidate => ({ url: `https://a.example/${town}/${t}`, domain: "a.example", title: `${town} ${t}`, lang: "en", publishedAt: new Date(t * 1000), at: { name: town, lat: 0, lon: 0 } });
  const towns = (): Map<string, TownCandidates> =>
    new Map([
      ["a1", { region: "AA/Empty", reached: false, stories: [at(10, "a1"), at(5, "a1"), at(4, "a1")] }],
      ["a2", { region: "AA/Empty", reached: false, stories: [at(8, "a2")] }],
      ["b1", { region: "BB/Reached", reached: true, stories: [at(9, "b1"), at(7, "b1")] }],
    ]);

  it("keeps each town's limit, and every town's newest before any town's second", () => {
    const all = pickLocal(towns(), limits(2));
    expect(all.picked.map((p) => p.title)).toEqual(["a1 10", "a2 8", "b1 9", "a1 5", "b1 7"]);
    expect(all.overMax).toBe(0);
    // Over the day's limit, every town keeps its first: towns in a region no outlet reached first, then the newest.
    const capped = pickLocal(towns(), limits(2, 3));
    expect(capped.picked.map((p) => p.title)).toEqual(["a1 10", "a2 8", "b1 9"]);
    expect(capped.overMax).toBe(2);
    expect(pickLocal(towns(), limits(1)).picked).toHaveLength(3);
  });
});
