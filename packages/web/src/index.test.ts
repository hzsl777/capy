import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toRunDate, type MapFile, type MapTile } from "@2dayai/core";
import type { Db } from "@2dayai/db";
// Test-only reach into the pipeline package: its PGlite helper and the fictional world fixture.
import { createTestDb } from "../../pipeline/src/test/db.js";
import { testConfig } from "../../pipeline/src/test/config.js";
import { FakeLlm } from "../../pipeline/src/llm/fake.js";
import { runDay } from "../../pipeline/src/day.js";
import { worldAnswers, worldFeedFor, worldSourcesYaml } from "../../pipeline/src/fixtures/world.js";
import { worldGdeltFor } from "../../pipeline/src/fixtures/gdelt.js";
import { runLocal } from "../../pipeline/src/stages/local.js";
import { createApp } from "./index.js";

const date = toRunDate("2026-09-27");
let db: Db;
let close: () => Promise<void>;
const env = { DATABASE_URL: "postgres://unused" };

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(async () => {
  await close();
});

describe("the Worker's headers", () => {
  it("sends no referrer from any page, and lets its HTML pages run no scripts", async () => {
    const app = createApp(() => db);
    const page = await app.request("/r/0123456789abcdef0123456789abcdef/2026-09-27", {}, env);
    expect(page.status).toBe(404);
    expect(page.headers.get("referrer-policy")).toBe("no-referrer");
    expect(page.headers.get("x-content-type-options")).toBe("nosniff");
    expect(page.headers.get("content-security-policy")).toContain("default-src 'none'");
    const health = await app.request("/health", {}, env);
    expect(health.headers.get("referrer-policy")).toBe("no-referrer");
    expect(health.headers.get("content-security-policy")).toBeNull();
  });
});

describe("the Worker's map data", () => {
  it("answers 404 before the world desk has run", async () => {
    const app = createApp(() => db);
    const res = await app.request("/data/latest.json", {}, env);
    expect(res.status).toBe(404);
  });

  it("serves the latest map, and a dated one, from the database", async () => {
    const dir = mkdtempSync(join(tmpdir(), "web-"));
    writeFileSync(join(dir, "sources.yaml"), worldSourcesYaml());
    await runDay(db, testConfig(), new FakeLlm(worldAnswers()), date, {
      fetchFeed: async (url) => worldFeedFor(url, date),
      fetchPage: async () => "",
      sourcesPath: join(dir, "sources.yaml"),
      readersDir: dir,
    });
    const app = createApp(() => db);
    const res = await app.request("/data/latest.json", {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("max-age=300");
    const map = (await res.json()) as MapFile;
    expect(map).toMatchObject({ version: 2, source: "live", runDate: date });
    expect(map.telegram).toMatchObject({ word: "Unease", band: -1 });
    // Twelve publisher cities and Valparaiso, where one story happened (decision 44).
    expect(map.places).toHaveLength(13);

    const dated = await app.request(`/data/${date}.json`, {}, env);
    expect(((await dated.json()) as MapFile).telegram?.word).toBe("Unease");
    expect((await app.request("/data/2026-13-40.json", {}, env)).status).toBe(404);
    expect((await app.request("/data/latest.jsonx", {}, env)).status).toBe(404);
  });

  it("keeps local stories out of the day's file and serves them by tile from the database (decision 78)", async () => {
    await runLocal(db, date, { perTown: 2, max: 80_000 }, async (url) => worldGdeltFor(url, date));
    const app = createApp(() => db);
    const map = (await (await app.request("/data/latest.json", {}, env)).json()) as MapFile;
    expect(map.items.some((i) => i.via === "gdelt")).toBe(false);
    expect(map.places).toHaveLength(13);
    expect(map.local).toMatchObject({ deg: 10, base: `local/${date}/` });
    expect(Object.values(map.local!.tiles).reduce((a, b) => a + b, 0)).toBe(28);
    // Kisumu, Ikinu and Mombasa are in the tile from 10 degrees south to the equator and 30 to 40 degrees east.
    const res = await app.request(`/data/local/${date}/10S_30E.json`, {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("max-age=300");
    const tile = (await res.json()) as MapTile;
    expect(tile).toMatchObject({ version: 2, runDate: date, key: "10S_30E" });
    expect(tile.items).toHaveLength(map.local!.tiles["10S_30E"]!);
    expect(tile.places.map((p) => p.name).sort()).toEqual(["Ikinu", "Kisumu", "Mombasa"]);
    expect(tile.items.every(([, t], i) => i === 0 || t <= tile.items[i - 1]![1])).toBe(true);
    // A cell with no stories, a key off the grid, and a bad date.
    expect((await app.request(`/data/local/${date}/80N_170E.json`, {}, env)).status).toBe(404);
    expect((await app.request(`/data/local/${date}/15N_30E.json`, {}, env)).status).toBe(404);
    expect((await app.request(`/data/local/${date}/-10_30.json`, {}, env)).status).toBe(404);
    expect((await app.request("/data/local/2026-13-40/10S_30E.json", {}, env)).status).toBe(404);
  });
});

describe("the Worker's stored map files", () => {
  it("streams the file the daily run stored, without reading the database", async () => {
    const files: Record<string, string> = { "latest.json": '{"stored":"latest"}', "2026-09-20.json": '{"stored":"dated"}', "local/2026-09-20/40N_80W.json": '{"stored":"tile"}' };
    const MAPS = {
      get: async (key: string) =>
        key in files ? { body: new Response(files[key]).body!, httpEtag: `"${key}"` } : null,
    };
    const app = createApp(() => {
      throw new Error("the database should not be read");
    });
    const latest = await app.request("/data/latest.json", {}, { ...env, MAPS });
    expect(latest.status).toBe(200);
    expect(latest.headers.get("content-type")).toContain("application/json");
    expect(latest.headers.get("cache-control")).toContain("max-age=300");
    expect(await latest.json()).toEqual({ stored: "latest" });
    const dated = await app.request("/data/2026-09-20.json", {}, { ...env, MAPS });
    expect(await dated.json()).toEqual({ stored: "dated" });
    const tile = await app.request("/data/local/2026-09-20/40N_80W.json", {}, { ...env, MAPS });
    expect(tile.headers.get("etag")).toBe('"local/2026-09-20/40N_80W.json"');
    expect(await tile.json()).toEqual({ stored: "tile" });
  });

  it("falls back to the database for a day with no stored file", async () => {
    const MAPS = { get: async () => null };
    const app = createApp(() => db);
    const res = await app.request(`/data/${date}.json`, {}, { ...env, MAPS });
    expect(res.status).toBe(200);
    expect(((await res.json()) as MapFile).runDate).toBe(date);
  });
});
