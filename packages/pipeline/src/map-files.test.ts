// What the daily run and the refresh check before a day's file replaces the site's latest.json, and which day they
// publish. No network: files in a temporary folder and a real Postgres engine in memory.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MapEvent, MapFile, MapItem } from "@2dayai/core";
import { events, latestFinishedMapDate, latestMapDate, runs, type Db } from "@2dayai/db";
import { checkMapFile, mapFileProblems, writeMapFiles } from "./map-files.js";
import { createTestDb } from "./test/db.js";

const place = { id: "p1", name: "Lima", lat: -12.05, lon: -77.04 };
const outlet: MapItem = { id: "a1", t: 1_790_000_000, title: "Port reopens", url: "https://a.example/1", domain: "a.example", publisher: "A", lang: "en", topics: ["other"], place: 0 };
const local: MapItem = { ...outlet, id: "g1", url: "https://b.example/1", domain: "b.example", publisher: "b.example", topics: [], via: "gdelt", reach: 1, importance: 1 };
const event: MapEvent = { id: 1, title: "Port reopens", topic: "other", places: [0], whatHappened: [], whyItMatters: [], whatChangesNext: [], sources: [] };
const day = (over: Partial<MapFile> = {}): MapFile => ({ version: 2, source: "live", generatedAt: 1_790_000_000, runDate: "2026-09-29", places: [place], items: [outlet], events: { "1": { ...event } }, telegram: null, ...over });

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "map-files-"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("the check before a day's file is published", () => {
  it("passes a day with outlet stories and its tiles on disk, with or without a word", () => {
    const out = join(dir, "ok.json");
    const { tiles } = writeMapFiles(day({ items: [outlet, local] }), out, "local/2026-09-29/");
    expect(tiles).toHaveLength(1);
    expect(checkMapFile(out)).toContain("1 listed tiles are not on disk, for example local/2026-09-29/20S_80W.json");
    expect(mapFileProblems(JSON.stringify(day()), [])).toEqual([]);
    const manifest = join(dir, "tiles.json");
    writeFileSync(manifest, JSON.stringify(tiles));
    expect(checkMapFile(out, manifest)).toEqual([]);
  });

  it("refuses a file that is not JSON or not a day's map", () => {
    expect(mapFileProblems("", [])).toEqual(["the file is not valid JSON"]);
    expect(mapFileProblems('{"version":2,"runDate":"2026-09-29"', [])).toEqual(["the file is not valid JSON"]);
    expect(mapFileProblems("null", [])[0]).toMatch(/not a day's map/);
    expect(mapFileProblems(JSON.stringify({ ...day(), version: 1 }), [])[0]).toMatch(/not a day's map/);
    expect(mapFileProblems(JSON.stringify({ ...day(), items: undefined }), [])[0]).toMatch(/not a day's map/);
  });

  it("refuses a day with no outlet stories, or with no explained event and no local story", () => {
    expect(mapFileProblems(JSON.stringify(day({ items: [], events: {} })), [])).toEqual(["no outlet stories", "no explained events and no local stories"]);
    expect(mapFileProblems(JSON.stringify(day({ items: [] })), [])).toEqual(["no outlet stories"]);
    expect(mapFileProblems(JSON.stringify(day({ events: {} })), [])).toEqual(["no explained events and no local stories"]);
    // Local stories in tiles are enough beside the outlets' stories when no event was explained.
    expect(mapFileProblems(JSON.stringify(day({ events: {}, local: { deg: 10, base: "local/x/", tiles: { "20S_80W": 3 } } })), [{ key: "local/x/20S_80W.json", file: join(dir, "ok.json") }])).toEqual([]);
  });

  it("refuses a story at a place the file does not have", () => {
    expect(mapFileProblems(JSON.stringify(day({ items: [{ ...outlet, place: 3 }] })), [])).toEqual(["a story points at a place the file does not have"]);
  });
});

describe("the day the refresh and the export publish", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  }, 60_000);
  afterAll(async () => {
    await close();
  });

  it("is the newest day whose telegram stage finished, not a day that failed part way", async () => {
    expect(await latestFinishedMapDate(db)).toBeNull();
    const ev = (runDate: string) => ({ runDate, title: "t", importance: 2, importanceReason: "r", promptVersion: "p", desk: "world", topic: "other" });
    await db.insert(events).values([ev("2026-09-28"), ev("2026-09-29")]);
    await db.insert(runs).values([
      { runDate: "2026-09-28", stage: "telegram", status: "ok" },
      { runDate: "2026-09-29", stage: "cluster-world", status: "ok" },
      { runDate: "2026-09-29", stage: "telegram", status: "failed" },
    ]);
    // The newest grouped day failed at the telegram: the day before stays up.
    expect(await latestMapDate(db)).toBe("2026-09-29");
    expect(await latestFinishedMapDate(db)).toBe("2026-09-28");
    await db.insert(runs).values({ runDate: "2026-09-29", stage: "telegram", status: "ok" });
    expect(await latestFinishedMapDate(db)).toBe("2026-09-29");
    // A telegram with no world events (a day the grouping never ran) is not a map.
    await db.insert(runs).values({ runDate: "2026-09-30", stage: "telegram", status: "ok" });
    expect(await latestFinishedMapDate(db)).toBe("2026-09-29");
  });
});
