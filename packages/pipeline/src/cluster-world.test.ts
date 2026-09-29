// Cluster world in batches, with the merge pass across them, on a real Postgres engine and a scripted model.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { toRunDate } from "@2dayai/core";
import { articles, eventArticles, events, sources, type Db } from "@2dayai/db";
import { FakeLlm, type FakeAnswer } from "./llm/fake.js";
import { LlmParseError } from "./llm/types.js";
import { runClusterWorld, splitBatches } from "./stages/cluster.js";
import { createTestDb } from "./test/db.js";
import { testConfig } from "./test/config.js";

const date = toRunDate("2026-09-27");
let db: Db;
let close: () => Promise<void>;

const OUTLETS = [
  { id: "s1", name: "Northgate Wire", place: "London" },
  { id: "s2", name: "Harbor Daily", place: "Lagos" },
  { id: "s3", name: "Meridian Post", place: "Nairobi" },
  { id: "s4", name: "Gulf Courier", place: "Doha" },
  { id: "s5", name: "Andes Ledger", place: "Lima" },
  { id: "s6", name: "Pacific Record", place: "Sydney" },
];

// Twelve articles, newest first. With batches of at most 5 they split 4, 4, 4 by time, so the flood story
// (three outlets) and the port story (two outlets) each land in more than one batch.
const ARTICLES: [hour: number, outlet: string, story: string][] = [
  [21, "s1", "flood"], [20, "s2", "a"], [19, "s3", "port"], [18, "s4", "b"],
  [17, "s5", "flood"], [16, "s6", "c"], [15, "s1", "port"], [14, "s2", "d"],
  [13, "s3", "flood"], [12, "s4", "e"], [11, "s5", "f"], [10, "s6", "g"],
];
const TITLES: Record<string, string> = { flood: "Floodwater closes the river road in Varda", port: "Port Lenn dock workers begin a strike" };
const titleOf = (story: string) => TITLES[story] ?? `Story ${story} is reported`;

/** Groups each batch's articles by the story named in the headline. The Lima report of the flood rates higher. */
const clusterAnswer: FakeAnswer = ({ user }) => {
  const byStory = new Map<string, { ids: number[]; lima: boolean }>();
  for (const m of user.matchAll(/^\[(\d+)\] (\S+) report from (.+?) \([^)]*\)$/gm)) {
    const entry = byStory.get(m[2]!) ?? { ids: [], lima: false };
    entry.ids.push(Number(m[1]));
    entry.lima ||= m[3] === "Andes Ledger";
    byStory.set(m[2]!, entry);
  }
  return {
    events: [...byStory].map(([story, e]) => ({
      title: titleOf(story),
      articleIds: e.ids,
      importance: e.lima ? 4 : 3,
      importanceReason: "scripted",
      topic: e.lima ? "environment" : "other",
    })),
    skipped: [],
  };
};

/** Keys of the batch events for one story, read from the merge call's input. */
const keysFor = (user: string, story: string) => [...user.matchAll(/^\[(b\d+-e\d+)\] (.+)$/gm)].filter((m) => m[2] === titleOf(story)).map((m) => m[1]!);

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await db.insert(sources).values(OUTLETS.map((o) => ({ id: o.id, name: o.name, url: `https://${o.id}.example/feed.xml`, topic: "world", tier: "general", desk: "world", placeName: o.place, lat: 0, lon: 0 })));
  const name = new Map(OUTLETS.map((o) => [o.id, o.name]));
  await db.insert(articles).values(
    ARTICLES.map(([hour, outlet, story], i) => ({
      sourceId: outlet,
      url: `https://${outlet}.example/${i}`,
      title: `${story} report from ${name.get(outlet)}`,
      lead: "A lead.",
      publishedAt: new Date(Date.UTC(2026, 8, 26, hour)),
    })),
  );
});
afterAll(async () => {
  await close();
});

async function worldEvents() {
  const evs = await db.select().from(events).where(eq(events.desk, "world"));
  const links = await db.select().from(eventArticles);
  return evs.map((e) => ({ ...e, articleIds: links.filter((l) => l.eventId === e.id).map((l) => l.articleId).sort((a, b) => a - b) }));
}

describe("cluster world in batches", () => {
  beforeEach(async () => {
    await db.delete(events);
  });

  it("splits into even batches no larger than the limit", () => {
    expect(splitBatches([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 5).map((b) => b.length)).toEqual([4, 4, 4]);
    expect(splitBatches([1, 2, 3], 300)).toEqual([[1, 2, 3]]);
    expect(splitBatches([], 5)).toEqual([]);
  });

  it("clusters each batch, then joins batch events that report the same story, with every article in exactly one event", async () => {
    const llm = new FakeLlm({
      "cluster-world": clusterAnswer,
      "cluster-world-merge": ({ user }) => ({ groups: [{ eventKeys: keysFor(user, "flood"), title: "Floodwater closes the river road in Varda" }] }),
    });
    const report = await runClusterWorld(db, testConfig({ worldClusterBatch: 5 }), llm, date);

    expect(llm.calls.filter((c) => c.stage === "cluster-world").map((c) => c.id)).toEqual(["batch-1", "batch-2", "batch-3"]);
    const merge = llm.calls.find((c) => c.stage === "cluster-world-merge")!;
    expect(merge.user).toContain("outlets: Andes Ledger (Lima)");
    expect(keysFor(merge.user, "flood")).toEqual(["b1-e1", "b2-e1", "b3-e1"]);

    // Twelve batch events; the three flood events become one. The Lima outlet's two stories are environment.
    expect(report).toEqual({ articles: 12, events: 10, skipped: 0, unknownIds: 0, unassigned: 0, byTopic: { environment: 2, other: 8 }, batches: 3, merged: 1, mergeDropped: 0 });
    const evs = await worldEvents();
    const all = evs.flatMap((e) => e.articleIds);
    expect(all).toHaveLength(12);
    expect(new Set(all).size).toBe(12);

    const floodIds = (await db.select().from(articles)).filter((a) => a.title.startsWith("flood ")).map((a) => a.id).sort((a, b) => a - b);
    const flood = evs.filter((e) => e.title === TITLES["flood"]);
    expect(flood).toHaveLength(1);
    // The union of the articles, the highest importance, and the topic of the most important member.
    expect(flood[0]).toMatchObject({ articleIds: floodIds, importance: 4, topic: "environment", promptVersion: "cluster-world.v2+cluster-world-merge.v1" });
    // Not merged, so the port story stays two events.
    expect(evs.filter((e) => e.title === TITLES["port"])).toHaveLength(2);
  });

  it("drops a merge group with an unknown key or a key another group also uses, and applies the rest", async () => {
    const llm = new FakeLlm({
      "cluster-world": clusterAnswer,
      "cluster-world-merge": ({ user }) => {
        const [f1, f2, f3] = keysFor(user, "flood");
        return {
          groups: [
            { eventKeys: [f1, f2], title: "Floodwater closes the river road" },
            { eventKeys: [f2, f3], title: "Floodwater closes the river road" }, // f2 again: both flood groups are dropped
            { eventKeys: [keysFor(user, "a")[0], "b9-e9"], title: "Story a is reported" }, // unknown key
            { eventKeys: keysFor(user, "port"), title: "Port Lenn dock workers strike over pay" },
            { eventKeys: [f3], title: "One event is not a group" },
          ],
        };
      },
    });
    const report = await runClusterWorld(db, testConfig({ worldClusterBatch: 5 }), llm, date);

    expect(report).toMatchObject({ articles: 12, events: 11, batches: 3, merged: 1, mergeDropped: 4 });
    const evs = await worldEvents();
    expect(evs.filter((e) => e.title === TITLES["flood"])).toHaveLength(3);
    const port = evs.filter((e) => e.title.startsWith("Port Lenn"));
    expect(port.map((e) => e.title)).toEqual(["Port Lenn dock workers strike over pay"]);
    expect(port[0]!.articleIds).toHaveLength(2);
    expect(new Set(evs.flatMap((e) => e.articleIds)).size).toBe(12);
  });

  it("halves a batch whose answer runs past the output limit and asks again (decision 36)", async () => {
    // Batches of more than two articles "run out of room"; halving twice gets every batch under that.
    const tooLong: FakeAnswer = (req) => {
      if ((req.user.match(/^\[\d+\]/gm) ?? []).length > 2) throw new LlmParseError("cluster-world", "output hit max_tokens");
      return clusterAnswer(req);
    };
    const llm = new FakeLlm({ "cluster-world": tooLong, "cluster-world-merge": () => ({ groups: [] }) });
    const report = await runClusterWorld(db, testConfig({ worldClusterBatch: 5 }), llm, date);
    expect(report.batches).toBeGreaterThan(3);
    const linked = (await worldEvents()).flatMap((e) => e.articleIds);
    expect(new Set(linked).size).toBe(ARTICLES.length);
    expect(linked).toHaveLength(ARTICLES.length);
  });

  it("fails loudly when one batch fails and keeps the day it had", async () => {
    await runClusterWorld(db, testConfig({ worldClusterBatch: 5 }), new FakeLlm({ "cluster-world": clusterAnswer, "cluster-world-merge": () => ({ groups: [] }) }), date);
    const before = await worldEvents();
    expect(before).toHaveLength(12);

    // Batch 2 fails on its first call (attempt 2) and on its retry (attempt 4, after batch 3).
    const llm = new FakeLlm({ "cluster-world": (req) => (req.attempt === 2 || req.attempt === 4 ? { events: "not a list" } : clusterAnswer(req)) });
    await expect(runClusterWorld(db, testConfig({ worldClusterBatch: 5 }), llm, date)).rejects.toThrow(/cluster-world: 1 batch still failed after a retry, nothing written\. batch-2\.again: /);
    expect(await worldEvents()).toEqual(before);
    expect(llm.calls.some((c) => c.stage === "cluster-world-merge")).toBe(false);
  });

  it("asks a failed batch once more, and drops an event with no articles instead of failing (decision 41)", async () => {
    const withEmpty: FakeAnswer = (req) => {
      if (req.attempt === 2) throw new LlmParseError("cluster-world", "output was not JSON");
      const answer = clusterAnswer(req) as { events: unknown[]; skipped: unknown[] };
      return { ...answer, events: [...answer.events, { title: "Nothing", articleIds: [], importance: 1, importanceReason: "none", topic: "other" }] };
    };
    const llm = new FakeLlm({ "cluster-world": withEmpty, "cluster-world-merge": () => ({ groups: [] }) });
    const report = await runClusterWorld(db, testConfig({ worldClusterBatch: 5 }), llm, date);
    expect(llm.calls.filter((c) => c.stage === "cluster-world")).toHaveLength(4);
    expect(report).toMatchObject({ events: 12, unknownIds: 0, unassigned: 0 });
    expect((await worldEvents()).every((e) => e.articleIds.length > 0)).toBe(true);
  });

  it("keeps at most WORLD_PER_SOURCE newest articles per outlet", async () => {
    const llm = new FakeLlm({ "cluster-world": clusterAnswer });
    const report = await runClusterWorld(db, testConfig({ worldPerSource: 1 }), llm, date);
    expect(report).toMatchObject({ articles: 6, batches: 1, merged: 0 });
    expect(llm.calls).toHaveLength(1);
  });
});
