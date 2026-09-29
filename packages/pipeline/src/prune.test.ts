import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { toRunDate, type RunDate } from "@2dayai/core";
import { articles, events, telegrams, type Db } from "@2dayai/db";
import { runDay } from "./day.js";
import { worldAnswers, worldFeedFor, worldSourcesYaml } from "./fixtures/world.js";
import { FakeLlm } from "./llm/fake.js";
import { loadSources } from "./sources.js";
import { runIngest } from "./stages/ingest.js";
import { runPrune } from "./stages/prune.js";
import { createTestDb } from "./test/db.js";
import { testConfig } from "./test/config.js";

const OLD = toRunDate("2026-08-10");
const RECENT = toRunDate("2026-09-24");
const TODAY = toRunDate("2026-09-27");
let db: Db;
let close: () => Promise<void>;
let dir: string;

/** The fixture reuses article URLs every day; a date suffix keeps each day's articles distinct. */
const feedFor = (date: RunDate) => async (url: string) => worldFeedFor(url, date).replace(/<link>([^<]+)<\/link>/g, `<link>$1?d=${date}</link>`);
const dayOn = (date: RunDate) => runDay(db, testConfig(), new FakeLlm(worldAnswers()), date, { fetchFeed: feedFor(date), fetchPage: async () => "", sourcesPath: join(dir, "sources.yaml"), readersDir: dir });

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  dir = mkdtempSync(join(tmpdir(), "prune-"));
  writeFileSync(join(dir, "sources.yaml"), worldSourcesYaml());
}, 60_000);
afterAll(async () => {
  await close();
});

describe("prune (decision 34)", () => {
  it("drops world days past retention and page text past two days, and keeps today whole", async () => {
    await dayOn(OLD);
    await runIngest(db, loadSources(join(dir, "sources.yaml")), RECENT, feedFor(RECENT));
    await db.update(articles).set({ body: "fetched page text" });
    const out = await dayOn(TODAY);

    expect(out["prune"]).toMatchObject({ cutoff: "2026-08-28", telegrams: 1 });
    expect(await db.select().from(events).where(eq(events.runDate, OLD))).toHaveLength(0);
    expect(await db.select().from(telegrams).where(eq(telegrams.runDate, OLD))).toHaveLength(0);
    expect(await db.select().from(telegrams).where(eq(telegrams.runDate, TODAY))).toHaveLength(1);
    expect((await db.select().from(events).where(eq(events.runDate, TODAY))).length).toBeGreaterThan(0);

    const rows = await db.select({ url: articles.url, body: articles.body }).from(articles);
    expect(rows.filter((r) => r.url.endsWith(OLD))).toHaveLength(0);
    const recent = rows.filter((r) => r.url.endsWith(RECENT));
    expect(recent.length).toBeGreaterThan(0);
    expect(recent.every((r) => r.body === "")).toBe(true);
    expect(rows.filter((r) => r.url.endsWith(TODAY)).length).toBeGreaterThan(0);

    // Running it again finds nothing more to do.
    expect(await runPrune(db, TODAY, 30)).toEqual({ cutoff: "2026-08-28", telegrams: 0, events: 0, articles: 0, bodiesCleared: 0, localStories: 0 });
  }, 60_000);
});
