// Feed health (decision 36) on a real Postgres engine: remembered feeds, failure streaks, the weekly retry.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { toRunDate, type Source } from "@2dayai/core";
import { sources, type Db } from "@2dayai/db";
import { createTestDb } from "../test/db.js";
import { PAUSE_AFTER_FAILED_DAYS, runIngest } from "./ingest.js";

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
}, 60_000);
afterAll(async () => {
  await close();
});

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title></channel></rss>`;
const PAGE = `<html><head><link rel="alternate" type="application/rss+xml" href="/rss.xml"></head></html>`;
const outlet = (id: string, url: string): Source => ({ id, name: id, url, topic: "world", tier: "general", desk: "world", lang: "en", place: { name: "Lima", lat: -12.05, lon: -77.04 } });
const healthOf = async (id: string) => (await db.select().from(sources).where(eq(sources.id, id)))[0]!;

describe("feed health (decision 36)", () => {
  it("remembers the feed found behind a homepage and fetches it directly after that", async () => {
    const src = outlet("home", "https://home.example/");
    const fetched: string[] = [];
    const fetcher = async (url: string) => {
      fetched.push(url);
      return url.endsWith("/rss.xml") ? RSS : PAGE;
    };
    await runIngest(db, [src], toRunDate("2026-09-21"), fetcher);
    expect(await healthOf("home")).toMatchObject({ feedUrl: "https://home.example/rss.xml", feedFrom: "https://home.example/", failStreak: 0 });
    fetched.length = 0;
    await runIngest(db, [src], toRunDate("2026-09-22"), fetcher);
    expect(fetched).toEqual(["https://home.example/rss.xml"]);
  });

  it("forgets a remembered feed when sources.yaml points somewhere new", async () => {
    const fetched: string[] = [];
    await runIngest(db, [outlet("home", "https://home.example/feed")], toRunDate("2026-09-23"), async (url) => {
      fetched.push(url);
      return RSS;
    });
    expect(fetched).toEqual(["https://home.example/feed"]);
    expect(await healthOf("home")).toMatchObject({ feedUrl: null, feedFrom: null });
  });

  it("counts a failed day once, pauses after a week of failures, and retries on Sundays", async () => {
    const src = outlet("dead", "https://dead.example/rss");
    let calls = 0;
    const failing = async () => {
      calls++;
      throw new Error("404 Not Found");
    };
    // Monday September 7 through Sunday September 13, with the Monday run twice.
    await runIngest(db, [src], toRunDate("2026-09-07"), failing);
    await runIngest(db, [src], toRunDate("2026-09-07"), failing);
    expect((await healthOf("dead")).failStreak).toBe(1);
    for (let d = 8; d <= 13; d++) await runIngest(db, [src], toRunDate(`2026-09-${String(d).padStart(2, "0")}`), failing);
    expect((await healthOf("dead")).failStreak).toBe(PAUSE_AFTER_FAILED_DAYS);

    calls = 0;
    const [monday] = await runIngest(db, [src], toRunDate("2026-09-14"), failing);
    expect(monday).toMatchObject({ paused: true });
    expect(calls).toBe(0);

    const [sunday] = await runIngest(db, [src], toRunDate("2026-09-20"), async () => RSS);
    expect(sunday!.error).toBeUndefined();
    expect(await healthOf("dead")).toMatchObject({ failStreak: 0, lastFailOn: null });
  });
});
