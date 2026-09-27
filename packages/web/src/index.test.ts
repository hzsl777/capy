import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toRunDate, type MapFile } from "@2dayai/core";
import type { Db } from "@2dayai/db";
// Test-only reach into the pipeline package: its PGlite helper and the fictional world fixture.
import { createTestDb } from "../../pipeline/src/test/db.js";
import { testConfig } from "../../pipeline/src/test/config.js";
import { FakeLlm } from "../../pipeline/src/llm/fake.js";
import { runDay } from "../../pipeline/src/day.js";
import { worldAnswers, worldFeedFor, worldSourcesYaml } from "../../pipeline/src/fixtures/world.js";
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
    expect(map.telegram?.word).toBe("Ceasefire");
    expect(map.places).toHaveLength(12);

    const dated = await app.request(`/data/${date}.json`, {}, env);
    expect(((await dated.json()) as MapFile).telegram?.word).toBe("Ceasefire");
    expect((await app.request("/data/2026-13-40.json", {}, env)).status).toBe(404);
    expect((await app.request("/data/latest.jsonx", {}, env)).status).toBe(404);
  });
});
