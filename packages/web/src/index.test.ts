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
    expect(health.headers.get("content-security-policy")).toBe("default-src 'none'; frame-ancestors 'none'");
    for (const res of [page, health]) {
      expect(res.headers.get("strict-transport-security")).toContain("max-age=");
      expect(res.headers.get("permissions-policy")).toContain("camera=()");
      expect(res.headers.get("x-frame-options")).toBe("DENY");
    }
  });

  it("asks crawlers to stay out of branch previews, and only there", async () => {
    const app = createApp(() => db);
    const prod = await app.request("https://globalgist.huckabuck412.workers.dev/robots.txt", {}, env);
    expect(await prod.text()).toContain("Allow: /");
    expect(prod.headers.get("x-robots-tag")).toBeNull();
    const custom = await app.request("https://globalgist.com/robots.txt", {}, env);
    expect(await custom.text()).toContain("Allow: /");
    const preview = await app.request("https://launch-fixes-globalgist.huckabuck412.workers.dev/robots.txt", {}, env);
    expect(await preview.text()).toContain("Disallow: /");
    expect(preview.headers.get("x-robots-tag")).toBe("noindex");
    const data = await app.request("https://0f1e2d3c-globalgist.huckabuck412.workers.dev/data/nope.json", {}, env);
    expect(data.headers.get("x-robots-tag")).toBe("noindex");
  });

  it("answers an unknown path with a plain 404 page", async () => {
    const app = createApp(() => db);
    for (const path of ["/nope", "/data/../../etc/passwd", "/.env", "/wp-login.php"]) {
      const res = await app.request(path, {}, env);
      expect(res.status).toBe(404);
    }
    const res = await app.request("/nope", { method: "POST" }, env);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("No page at this address");
  });

  it("hides the cause of a failure, and never caches it", async () => {
    const secret = "postgres://user:hunter2@db.example/neondb";
    const app = createApp(() => {
      throw new Error(`could not connect to ${secret}`);
    });
    const errors: unknown[] = [];
    const log = console.error;
    console.error = (e: unknown) => errors.push(e);
    try {
      const data = await app.request(`/data/${date}.json`, {}, env);
      expect(data.status).toBe(503);
      expect(data.headers.get("cache-control")).toBe("no-store");
      expect(data.headers.get("x-content-type-options")).toBe("nosniff");
      const body = await data.text();
      expect(JSON.parse(body)).toEqual({ error: "unavailable" });
      const page = await app.request(`/r/0123456789abcdef0123456789abcdef/${date}`, {}, env);
      expect(page.status).toBe(503);
      const html = await page.text();
      expect(html).not.toContain("hunter2");
      expect(html).not.toContain("Error");
      expect(errors).toHaveLength(2);
    } finally {
      console.error = log;
    }
  });
});

describe("the Worker's reader pages", () => {
  it("refuses a malformed token, and a far date, without reading the database", async () => {
    const app = createApp(() => {
      throw new Error("the database should not be read");
    });
    for (const path of [
      `/r/not-a-token/${date}`,
      `/r/${"a".repeat(5000)}/${date}`,
      `/r/0123456789ABCDEF0123456789ABCDEF/${date}`,
      `/r/0123456789abcdef0123456789abcdef/2099-01-01`,
      `/r/0123456789abcdef0123456789abcdef/1999-01-01/e/1`,
      `/f/x/${date}/1/more`,
    ]) {
      const res = await app.request(path, {}, env);
      expect(res.status, path).toBe(404);
      expect(res.headers.get("cache-control"), path).toBe("private, no-store");
    }
    const post = await app.request(`/f/x' OR 1=1 --/${date}/1/more`, { method: "POST" }, env);
    expect(post.status).toBe(404);
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

  it("serves the day's share image from R2, and the timeless one until there is one (decision 92)", async () => {
    const app = createApp(() => {
      throw new Error("the database should not be read");
    });
    const MAPS = { get: async (key: string) => (key === "og.png" ? { body: new Response("PNG").body!, httpEtag: '"og"' } : null) };
    const day = await app.request("/og.png", {}, { ...env, MAPS });
    expect(day.status).toBe(200);
    expect(day.headers.get("content-type")).toBe("image/png");
    expect(await day.text()).toBe("PNG");
    const none = await app.request("/og.png", {}, { ...env, MAPS: { get: async () => null } });
    expect(none.status).toBe(302);
    expect(none.headers.get("location")).toBe("/og-image.png");
  });

  it("answers 304 to a browser that has the file, and HEAD without failing", async () => {
    const MAPS = { get: async () => ({ body: new Response('{"stored":"latest"}').body!, httpEtag: '"v1"' }) };
    const app = createApp(() => db);
    const again = await app.request("/data/latest.json", { headers: { "If-None-Match": '"v1"' } }, { ...env, MAPS });
    expect(again.status).toBe(304);
    expect(again.headers.get("etag")).toBe('"v1"');
    const changed = await app.request("/data/latest.json", { headers: { "If-None-Match": '"v0"' } }, { ...env, MAPS });
    expect(changed.status).toBe(200);
    const head = await app.request("/data/latest.json", { method: "HEAD" }, { ...env, MAPS });
    expect(head.status).toBe(200);
  });

  it("refuses dates with no data before looking anywhere", async () => {
    const MAPS = {
      get: async (): Promise<null> => {
        throw new Error("the store should not be read");
      },
    };
    const app = createApp(() => {
      throw new Error("the database should not be read");
    });
    for (const path of ["/data/1970-01-01.json", "/data/2099-12-31.json", "/data/local/2099-12-31/40N_80W.json", "/data/local/2020-01-01/40N_80W.json", "/data/%2e%2e%2f%2e%2e%2fsecret.json", "/data/local/..%2F..%2F/40N_80W.json"]) {
      const res = await app.request(path, {}, { ...env, MAPS });
      expect(res.status, path).toBe(404);
      expect(res.headers.get("content-type"), path).toContain("application/json");
    }
  });

  it("falls back to the database for a day with no stored file", async () => {
    const MAPS = { get: async () => null };
    const app = createApp(() => db);
    const res = await app.request(`/data/${date}.json`, {}, { ...env, MAPS });
    expect(res.status).toBe(200);
    expect(((await res.json()) as MapFile).runDate).toBe(date);
  });
});
