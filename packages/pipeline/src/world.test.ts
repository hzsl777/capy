import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { telegramProblems, toRunDate, wordViolations } from "@2dayai/core";
import { events, loadMapView, latestMapDate, telegrams, type Db } from "@2dayai/db";
import { runDay } from "./day.js";
import { worldAnswers, worldFeedFor, worldSourcesYaml } from "./fixtures/world.js";
import { FakeLlm } from "./llm/fake.js";
import { runTelegram } from "./stages/telegram.js";
import { createTestDb } from "./test/db.js";
import { testConfig } from "./test/config.js";

const date = toRunDate("2026-09-27");
let db: Db;
let close: () => Promise<void>;
let deps: Parameters<typeof runDay>[4];

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const dir = mkdtempSync(join(tmpdir(), "world-"));
  writeFileSync(join(dir, "sources.yaml"), worldSourcesYaml());
  deps = { fetchFeed: async (url) => worldFeedFor(url, date), fetchPage: async () => "", sourcesPath: join(dir, "sources.yaml"), readersDir: dir };
});
afterAll(async () => {
  await close();
});

describe("the world desk on a real Postgres engine", () => {
  it("clusters with topics, explains within the cap, and writes the telegram after rejecting a contested word", async () => {
    const llm = new FakeLlm(worldAnswers({ badWordFirst: "Chaos" }));
    const out = await runDay(db, testConfig(), llm, date, deps);

    expect(out["cluster"]).toEqual({ articles: 0, events: 0, skipped: 0, unknownIds: 0, unassigned: 0 });
    expect(out["clusterWorld"]).toMatchObject({ articles: 14, events: 9, unknownIds: 0, unassigned: 0, byTopic: { conflict: 3, environment: 1 } });
    // Conflict events and importance 4 or 5 only: three conflict stories plus the floods.
    expect(out["explain"]).toEqual({ events: 4, usable: 4, unusable: 0, failed: 0, sentencesDropped: 0 });
    expect(out["select"]).toMatchObject({ readers: 0 });
    expect(out["telegram"]).toEqual({ candidates: 3, written: true, word: "Ceasefire", quietDay: false, events: 3, retried: true });
    expect(llm.calls.filter((c) => c.stage === "telegram")).toHaveLength(2);
  });

  it("builds the map from publisher pins, with explanations, sources and the telegram", async () => {
    expect(await latestMapDate(db)).toBe(date);
    const map = await loadMapView(db, date, new Date("2026-09-27T12:00:00Z"));
    expect(map.version).toBe(2);
    expect(map.places).toHaveLength(12);
    expect(map.places.map((p) => p.name)).toContain("Nairobi");
    expect(map.items).toHaveLength(14);
    expect(map.items[0]!.t).toBeGreaterThanOrEqual(map.items[1]!.t);

    const talks = Object.values(map.events).find((e) => e.title.startsWith("Ceasefire talks"))!;
    expect(talks.topic).toBe("conflict");
    expect(talks.places).toHaveLength(3);
    expect(talks.whatHappened.map((s) => s.text)).toContain("Delegations resumed ceasefire talks in Port Lenn after a three-week pause.");
    // Every citation mark resolves to a source that carries the quoted passage.
    for (const s of [...talks.whatHappened, ...talks.whyItMatters, ...talks.whatChangesNext]) {
      expect(s.cites.length).toBeGreaterThan(0);
      for (const i of s.cites) expect(talks.sources[i]!.excerpts.length).toBeGreaterThan(0);
    }
    const talkItems = map.items.filter((i) => i.event === talks.id);
    expect(talkItems).toHaveLength(3);
    expect(new Set(talkItems.map((i) => i.story))).toEqual(new Set([`e${talks.id}`]));
    expect(talkItems.every((i) => i.topics[0] === "conflict")).toBe(true);

    // Unexplained events keep their headlines and links but offer no explanation.
    const port = map.items.find((i) => i.title.startsWith("Grain port"))!;
    expect(port.event).toBeUndefined();
    expect(port.topics).toEqual(["economy"]);
    expect(port.excerpt).toBe("The grain port reopened on Wednesday after four months of quay repairs.");

    expect(map.telegram).toMatchObject({ word: "Ceasefire", quietDay: false, runDate: date });
    expect(map.telegram!.items).toHaveLength(3);
    expect(map.telegram!.items[0]!.eventId).toBe(talks.id);
  });

  it("drops a stale telegram when the world desk is re-clustered, and refuses to fake a quiet day", async () => {
    await runDay(db, testConfig(), new FakeLlm({ ...worldAnswers(), "cluster-world": () => ({ events: [], skipped: [] }), telegram: () => ({ word: "Quiet", quietDay: true, events: [] }) }), date, deps);
    expect(await db.select().from(telegrams)).toHaveLength(0); // no conflict events, so no word at all
    const map = await loadMapView(db, date);
    expect(map.telegram).toBeNull();
    expect(Object.keys(map.events)).toHaveLength(0);
    expect(await db.select().from(events).where(eq(events.desk, "world"))).toHaveLength(0);

    await runDay(db, testConfig(), new FakeLlm(worldAnswers()), date, deps);
    const dead = new FakeLlm({ telegram: () => ({ word: "Gaza", quietDay: false, events: [] }) });
    await expect(runTelegram(db, testConfig(), dead, date)).rejects.toThrow(/after one retry/);
  });
});

describe("telegram word rules", () => {
  const sentences = [
    "Delegations resumed ceasefire talks in Port Lenn after a three-week pause.",
    "Shelling near Port Lenn displaced 1,200 families.",
    "Kestrel officials said the talks would continue.",
  ];
  it("accepts one word lifted from the verified sentences, with simple inflection", () => {
    expect(wordViolations("Ceasefire", false, sentences)).toEqual([]);
    expect(wordViolations("Talks", false, sentences)).toEqual([]);
    expect(wordViolations("Displaced", false, sentences)).toEqual([]);
  });
  it("rejects phrases, words not in the sources, names and contested words", () => {
    expect(wordViolations("Peace talks", false, sentences)[0]).toMatch(/not a single word/);
    expect(wordViolations("Escalation", false, sentences)[0]).toMatch(/does not appear/);
    expect(wordViolations("Lenn", false, sentences)[0]).toMatch(/proper noun/);
    expect(wordViolations("Chaos", false, [...sentences, "Residents described chaos at the crossing."])[0]).toMatch(/contested or alarm/);
  });
  it("reserves Quiet for quiet days", () => {
    expect(wordViolations("Quiet", true, [])).toEqual([]);
    expect(wordViolations("Ceasefire", true, sentences)[0]).toMatch(/quiet day/);
    expect(wordViolations("Quiet", false, ["The front was quiet overnight."])).toContain('"Quiet" is reserved for quiet days');
  });
  it("checks the chosen events", () => {
    const usable = new Map([[1, [{ text: sentences[0]!, citations: [], verified: true }]]]);
    expect(telegramProblems({ word: "Ceasefire", quietDay: false, events: [{ eventId: 1, line: "Talks resumed." }] }, usable)).toEqual([]);
    const problems = telegramProblems({ word: "Ceasefire", quietDay: false, events: [{ eventId: 2, line: "x" }, { eventId: 2, line: "y" }] }, usable);
    expect(problems).toContain("event 2 is not in the list");
    expect(problems).toContain("event 2 chosen twice");
    expect(telegramProblems({ word: "Quiet", quietDay: true, events: [{ eventId: 1, line: "x" }] }, usable)).toContain("a quiet day lists no events");
  });
});
