import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { dayBand, medianScores, MOOD_WORDS, scoreProblems, toRunDate, wordProblems } from "@2dayai/core";
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
  it("clusters with topics, explains within the cap, scores the day and writes the word after rejecting one outside the band", async () => {
    const llm = new FakeLlm(worldAnswers({ badWordFirst: "Joy" }));
    const out = await runDay(db, testConfig(), llm, date, deps);

    expect(out["cluster"]).toEqual({ skipped: "no reader profiles" });
    expect(out["clusterWorld"]).toMatchObject({ articles: 15, events: 10, unknownIds: 0, unassigned: 0, byTopic: { conflict: 3, environment: 1, other: 1 } });
    // Importance 3 or more: three conflict stories, the floods, the port, the clinics and the rescue.
    expect(out["explain"]).toEqual({ events: 7, usable: 7, unusable: 0, failed: 0, sentencesDropped: 0 });
    expect(out["select"]).toMatchObject({ readers: 0 });
    // Two significant events scored -1 and nothing lower, so the worst sets the day: band -1, a word from its list.
    expect(out["telegram"]).toEqual({ candidates: 7, written: true, word: MOOD_WORDS[-1][0], band: -1, events: 5, scoreRuns: 3, split: 0, retried: { score: false, word: true } });
    expect(llm.calls.filter((c) => c.stage === "telegram-word")).toHaveLength(2);
  });

  it("builds the map from publisher pins, with explanations, sources and the telegram", async () => {
    expect(await latestMapDate(db)).toBe(date);
    const map = await loadMapView(db, date, new Date("2026-09-27T12:00:00Z"));
    expect(map.version).toBe(2);
    expect(map.places).toHaveLength(12);
    expect(map.items).toHaveLength(15);
    expect(map.places.map((p) => p.name)).toContain("Nairobi");
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

    // Events below importance 3 keep their headlines and links but offer no explanation.
    const budget = map.items.find((i) => i.title.startsWith("Council sets date"))!;
    expect(budget.event).toBeUndefined();
    expect(budget.topics).toEqual(["politics"]);
    expect(budget.excerpt).toBe("The regional council scheduled its budget vote for next month after a public hearing.");

    expect(map.telegram).toMatchObject({ word: "Unease", band: -1, runDate: date });
    expect(map.telegram!.items).toHaveLength(5);
    expect(map.telegram!.items[0]!.eventId).toBe(talks.id);
    // Every explained event is scored, worst first, each with one of its own sentences as the reason.
    expect(map.telegram!.scores).toHaveLength(7);
    expect(map.telegram!.scores[0]!.score).toBe(-1);
    expect(map.telegram!.scores.at(-1)!.score).toBe(2);
    const talksScore = map.telegram!.scores.find((sc) => sc.eventId === talks.id)!;
    expect(talks.whatHappened.map((x) => x.text)).toContain(talksScore.because);
  });

  it("scores three times and keeps each event's middle score, so one odd run doesn't move the word (decision 36)", async () => {
    const base = worldAnswers();
    // The second run calls every event as bad as it gets; the other two outvote it.
    const llm = new FakeLlm({
      ...base,
      "telegram-score": (req) => {
        const answer = base["telegram-score"]!(req) as { scores: { eventId: number; score: number; because: string }[] };
        return req.attempt === 2 ? { scores: answer.scores.map((x) => ({ ...x, score: -2 })) } : answer;
      },
    });
    const report = await runTelegram(db, testConfig(), llm, date);
    expect(llm.calls.filter((c) => c.stage === "telegram-score")).toHaveLength(3);
    expect(report).toMatchObject({ word: "Unease", band: -1, scoreRuns: 3, split: 7 });
    const map = await loadMapView(db, date);
    expect(map.telegram!.scores.at(-1)!.score).toBe(2);
    expect(await runTelegram(db, testConfig({ telegramScoreRuns: 1 }), new FakeLlm(worldAnswers()), date)).toMatchObject({ scoreRuns: 1, split: 0 });
  });

  it("drops a stale telegram when the world desk is re-clustered, and writes no word without explained events", async () => {
    await runDay(db, testConfig(), new FakeLlm({ ...worldAnswers(), "cluster-world": () => ({ events: [], skipped: [] }) }), date, deps);
    expect(await db.select().from(telegrams)).toHaveLength(0); // nothing explained, so no word at all
    const map = await loadMapView(db, date);
    expect(map.telegram).toBeNull();
    expect(Object.keys(map.events)).toHaveLength(0);
    expect(await db.select().from(events).where(eq(events.desk, "world"))).toHaveLength(0);

    await runDay(db, testConfig(), new FakeLlm(worldAnswers()), date, deps);
    // A score whose reason is not one of the event's sentences fails twice, and the stage fails loudly.
    const invented = new FakeLlm({ ...worldAnswers(), "telegram-score": ({ user }) => ({ scores: [...user.matchAll(/^\[event (\d+)\]/gm)].map((m) => ({ eventId: Number(m[1]), score: 0, because: "Nothing much happened." })) }) });
    await expect(runTelegram(db, testConfig(), invented, date)).rejects.toThrow(/telegram-score: .*after one retry/);
    // A word from another band fails twice too.
    const offScale = new FakeLlm({ ...worldAnswers(), "telegram-word": () => ({ word: "Joy", events: [{ eventId: 1, line: "x" }] }) });
    await expect(runTelegram(db, testConfig(), offScale, date)).rejects.toThrow(/telegram-word: .*not one of/);
  });
});

describe("the mood formula", () => {
  const ev = (eventId: number, importance: number, score: number) => ({ eventId, importance, score });
  it("lets the worst significant event set a bad day, however much good news there is", () => {
    expect(dayBand([ev(1, 5, -2), ev(2, 4, 2), ev(3, 4, 2), ev(4, 3, 2)])).toBe(-2);
    expect(dayBand([ev(1, 3, -1), ev(2, 5, 2)])).toBe(-1);
  });
  it("ignores minor events when a significant one exists, and uses all events when none is significant", () => {
    expect(dayBand([ev(1, 1, -2), ev(2, 4, 1)])).toBe(1);
    expect(dayBand([ev(1, 2, -1), ev(2, 1, 2)])).toBe(-1);
  });
  it("averages an all-good day by importance and rounds", () => {
    expect(dayBand([ev(1, 5, 2), ev(2, 5, 1)])).toBe(2); // 1.5 rounds up
    expect(dayBand([ev(1, 5, 0), ev(2, 3, 1)])).toBe(0);
    expect(dayBand([])).toBeNull();
  });
});

describe("telegram checks", () => {
  const sentences = new Map([
    [1, [{ text: "Delegations resumed ceasefire talks in Port Lenn.", citations: [], verified: true }]],
    [2, [{ text: "Floodwater closed three main roads.", citations: [], verified: true }]],
  ]);
  it("requires every event scored once with one of its own sentences as the reason", () => {
    expect(scoreProblems({ scores: [{ eventId: 1, score: 1, because: "delegations resumed ceasefire talks in  Port Lenn." }, { eventId: 2, score: -1, because: "Floodwater closed three main roads." }] }, sentences)).toEqual([]);
    const problems = scoreProblems({ scores: [{ eventId: 1, score: 1, because: "Talks went well." }, { eventId: 1, score: 1, because: "x" }, { eventId: 9, score: 0, because: "x" }] }, sentences);
    expect(problems).toContain("the reason for event 1 is not one of its sentences; copy one exactly");
    expect(problems).toContain("event 1 scored twice");
    expect(problems).toContain("event 9 is not in the list");
    expect(problems).toContain("event 2 was not scored");
  });
  it("requires a word from the band's list and, on a bad day, the event that set it", () => {
    const scored = [{ eventId: 1, importance: 5, score: 1 }, { eventId: 2, importance: 4, score: -1 }];
    expect(wordProblems({ word: "Unease", events: [{ eventId: 2, line: "Roads closed." }] }, -1, scored)).toEqual([]);
    expect(wordProblems({ word: "Relief", events: [{ eventId: 2, line: "x" }] }, -1, scored)[0]).toMatch(/not one of: Unease/);
    expect(wordProblems({ word: "Unease", events: [{ eventId: 1, line: "x" }] }, -1, scored)).toContain("include the event that set the day (one of: 2)");
    expect(wordProblems({ word: "Hope", events: [{ eventId: 1, line: "x" }] }, 1, scored)).toEqual([]);
  });
  it("takes the middle of repeat scores, with the reason from a run that gave it", () => {
    const run = (score: number, because: string) => ({ scores: [{ eventId: 1, score, because }, { eventId: 2, score: 0, because: "Same." }] });
    const out = medianScores([run(-2, "Worst."), run(1, "Middle."), run(2, "Best.")]);
    expect(out.scores).toEqual([{ eventId: 1, score: 1, because: "Middle." }, { eventId: 2, score: 0, because: "Same." }]);
    expect(out.split).toBe(1);
    expect(medianScores([run(-1, "Only.")]).scores[0]).toMatchObject({ score: -1, because: "Only." });
  });
  it("keeps every band's words distinct", () => {
    const all = Object.values(MOOD_WORDS).flat();
    expect(new Set(all).size).toBe(all.length);
  });
});
