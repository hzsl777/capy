import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, lt, notInArray } from "drizzle-orm";
import { allowedWords, dayBand, medianScores, MOOD_WORDS, scoreProblems, splitLocal, toRunDate, withTodayStories, WORD_REPEAT_DAYS, wordProblems } from "@2dayai/core";
import { articles, events, loadLocalTile, loadMapView, latestMapDate, localBase, sources, telegrams, type Db } from "@2dayai/db";
import { runDay } from "./day.js";
import { worldGdeltFor } from "./fixtures/gdelt.js";
import { worldAnswers, worldFeedFor, worldSourcesYaml } from "./fixtures/world.js";
import { FakeLlm, type FakeAnswer } from "./llm/fake.js";
import { runClusterWorld } from "./stages/cluster.js";
import { runLocal } from "./stages/local.js";
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
    expect(out["clusterWorld"]).toMatchObject({ articles: 16, events: 11, placed: 1, abroad: 1, unknownIds: 0, unassigned: 0, byTopic: { conflict: 3, environment: 1, other: 1 } });
    // Importance 3 or more: three conflict stories, the floods, the port, the clinics and the rescue.
    expect(out["explain"]).toEqual({ events: 7, usable: 7, unusable: 0, failed: 0, sentencesDropped: 0 });
    expect(out["select"]).toMatchObject({ readers: 0 });
    // Two significant events scored -1 and nothing lower, so the worst sets the day: band -1, a word from its list.
    expect(out["telegram"]).toEqual({ candidates: 7, written: true, word: MOOD_WORDS[-1][0], band: -1, events: 5, scoreRuns: 3, split: 0, retried: { score: false, word: true }, rejected: 0 });
    expect(llm.calls.filter((c) => c.stage === "telegram-word")).toHaveLength(2);
  });

  it("builds the map with stories where they happened, explanations, sources and the telegram", async () => {
    expect(await latestMapDate(db)).toBe(date);
    const map = await loadMapView(db, date, new Date("2026-09-27T12:00:00Z"));
    expect(map.version).toBe(2);
    // Twelve publisher cities, plus Valparaiso where the port story happened (decision 44).
    expect(map.places).toHaveLength(13);
    const port = map.items.find((i) => i.title.startsWith("Grain port reopens"))!;
    expect(map.places[port.place]).toMatchObject({ name: "Valparaíso" });
    expect(port.from).toBe("Lima");
    // The rescue named a town whose point was nowhere near a listed city of its country: it stays at its outlet.
    const rescue = map.items.find((i) => i.event !== undefined && map.events[String(i.event)]!.title.startsWith("Eleven miners"))!;
    expect(map.places[rescue.place]!.name).toBe("Santiago");
    expect(rescue.from).toBeUndefined();
    expect(map.items).toHaveLength(16);
    // The Doha outlet's report on a court ruling in another country stays at Doha, marked (decision 107).
    expect(map.items.filter((i) => i.abroad).map((i) => map.places[i.place]!.name)).toEqual(["Doha"]);
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

  it("adds GDELT's local stories from every town the outlets did not reach, two a town (decisions 67 and 78)", async () => {
    // The daily run's defaults; the test config turns GDELT off.
    const report = await runLocal(db, date, { perTown: 2, max: 80_000 }, async (url) => worldGdeltFor(url, date));
    const map = await loadMapView(db, date, new Date("2026-09-27T12:00:00Z"));
    const local = map.items.filter((i) => i.via === "gdelt");
    const at = (name: string) => local.filter((i) => map.places[i.place]!.name === name);
    // Helsinki has its outlet and Valparaíso the port story: both stay the outlets' alone.
    expect(at("Helsinki").filter((i) => i.via === "gdelt")).toHaveLength(0);
    expect(at("Valparaíso")).toHaveLength(0);
    // Espoo, 16 km from Helsinki, is a town of its own.
    expect(at("Espoo")).toHaveLength(1);
    // Every town keeps its two newest stories.
    expect(at("Kisumu").map((i) => i.title)).toEqual(["Ferry timetable on the gulf changes next month", "Kisumu market traders get a new covered hall"]);
    expect(at("Mombasa").length + at("Malindi").length).toBe(2);
    // Small municipalities from GeoNames' places of 1,000 people or more, and towns in regions outlets reached.
    expect(at("Stanmore")).toHaveLength(1);
    expect(at("Ikinu")).toHaveLength(1);
    expect(at("Hyderabad")).toHaveLength(1);
    expect(at("Wollongong")).toHaveLength(1);
    expect(report).toMatchObject({ stories: 28, towns: 27, overMax: 0, townsNearOutlet: 2 });
    expect(local.every((i) => i.importance === 1 && i.topics.length === 0 && i.event === undefined)).toBe(true);
    // The outlets' stories and places are unchanged.
    expect(map.items.filter((i) => i.via !== "gdelt")).toHaveLength(16);

    // Decision 78: the site's file keeps the outlets' stories and lists the tiles; each tile has its own places.
    const { main, tiles } = splitLocal(map, localBase(date));
    expect(main.items.every((i) => i.via !== "gdelt" && main.places[i.place])).toBe(true);
    expect(main.places).toHaveLength(13);
    expect(Object.values(main.events).every((e) => e.places.every((p) => main.places[p]))).toBe(true);
    expect([...tiles.values()].reduce((n, t) => n + t.items.length, 0)).toBe(28);
    const kisumu = tiles.get("10S_30E")!;
    expect(kisumu.items.filter(([, , , , , , p]) => kisumu.places[p]!.name === "Kisumu")).toHaveLength(2);
    // The Worker builds the same tiles and index from the database when no file is stored.
    for (const [key, tile] of tiles) expect(await loadLocalTile(db, date, key)).toEqual(tile);
    const indexed = await loadMapView(db, date, new Date("2026-09-27T12:00:00Z"), { local: "index" });
    expect(indexed).toEqual(main);
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

  it("never uses a word from the past week again, even when the band repeats (decision 128)", async () => {
    // The day before had the same band and took its first word; a week and a day before had the second, which is free again.
    await db.insert(telegrams).values([
      { runDate: "2026-09-26", scope: "world", word: "Unease", band: -1, promptVersion: "test" },
      { runDate: "2026-09-19", scope: "world", word: "Strain", band: -1, promptVersion: "test" },
    ]);
    const llm = new FakeLlm(worldAnswers());
    expect(await runTelegram(db, testConfig(), llm, date)).toMatchObject({ written: true, band: -1, word: "Strain" });
    const user = llm.calls.find((c) => c.stage === "telegram-word")!.user;
    expect(user).toContain("Allowed words for this band: Strain, Worry,");
    expect(user).not.toMatch(/Allowed words[^\n]*Unease/);
    await db.delete(telegrams).where(lt(telegrams.runDate, date));
    expect(await runTelegram(db, testConfig(), new FakeLlm(worldAnswers()), date)).toMatchObject({ word: "Unease" });
  });

  it("drops a stale telegram when the world desk is re-clustered, and writes no word without explained events", async () => {
    await runDay(db, testConfig(), new FakeLlm({ ...worldAnswers(), "cluster-world": () => ({ events: [], skipped: [] }) }), date, deps);
    expect(await db.select().from(telegrams)).toHaveLength(0); // nothing explained, so no word at all
    const map = await loadMapView(db, date);
    expect(map.telegram).toBeNull();
    expect(Object.keys(map.events)).toHaveLength(0);
    // The model grouped nothing, so every article stands alone at the lowest importance (decision 50): ranked on
    // the map, never explained, no word.
    const alone = await db.select().from(events).where(eq(events.desk, "world"));
    expect(alone).toHaveLength(16);
    expect(alone.every((e) => e.importance === 1)).toBe(true);

    await runDay(db, testConfig(), new FakeLlm(worldAnswers()), date, deps);
    // A score whose reason is not one of the event's sentences is never used: every run and both spares break the
    // rule, so the day has no word (decision 51).
    const inventedScores: FakeAnswer = ({ user }) => ({ scores: [...user.matchAll(/^\[event (\d+)\]/gm)].map((m) => ({ eventId: Number(m[1]), score: 0, because: "Nothing much happened." })) });
    const invented = new FakeLlm({ ...worldAnswers(), "telegram-score": inventedScores });
    expect(await runTelegram(db, testConfig(), invented, date)).toMatchObject({ written: false, word: null, rejected: 5, reason: expect.stringMatching(/telegram-score: .*after one retry/) });
    expect(invented.calls.filter((c) => c.stage === "telegram-score")).toHaveLength(10);
    expect(await db.select().from(telegrams)).toHaveLength(0);
    // A word from another band twice: no word either.
    const offScale = new FakeLlm({ ...worldAnswers(), "telegram-word": () => ({ word: "Joy", events: [{ eventId: 1, line: "x" }] }) });
    expect(await runTelegram(db, testConfig(), offScale, date)).toMatchObject({ written: false, band: -1, reason: expect.stringMatching(/telegram-word: .*not one of/) });
    // An outage is not a broken rule: it still fails the stage.
    const down = new FakeLlm({ ...worldAnswers(), "telegram-score": () => { throw new Error("503 Service Unavailable"); } });
    await expect(runTelegram(db, testConfig(), down, date)).rejects.toThrow(/503/);
  });

  it("carries the last word into a day that has none, with its own date and evidence (decision 81)", async () => {
    await runDay(db, testConfig(), new FakeLlm(worldAnswers()), date, deps);
    const word = (await loadMapView(db, date)).telegram!;
    // The next day is quiet: its articles group into nothing the word could rest on.
    const next = toRunDate("2026-09-28");
    const quiet = { ...deps, fetchFeed: async (url: string) => worldFeedFor(url, next) };
    await runDay(db, testConfig(), new FakeLlm({ ...worldAnswers(), "cluster-world": () => ({ events: [], skipped: [] }) }), next, quiet);
    const map = await loadMapView(db, next);
    expect(map.runDate).toBe(next);
    expect(map.telegram).toMatchObject({ word: word.word, runDate: date });
    for (const { eventId } of map.telegram!.items) {
      const ev = map.events[String(eventId)]!;
      expect(ev.whatHappened.length).toBeGreaterThan(0);
      expect(ev.places.every((p) => map.places[p] !== undefined)).toBe(true);
    }
    // Only for a week: an older word is not carried.
    expect((await loadMapView(db, toRunDate("2026-10-06"))).telegram).toBeNull();
    expect((await loadMapView(db, toRunDate("2026-10-04"))).telegram).toMatchObject({ runDate: date });
  });

  it("lists the 7 newest earlier words under the word, newest first, skipping days with none (decision 112)", async () => {
    // State from the test above: 2026-09-27 has a word, 2026-09-28 has none and carries it.
    const own = (await loadMapView(db, date)).telegram!;
    const past = (d: string, band: -2 | -1 | 0 | 1 | 2) => ({ runDate: d, scope: "world", word: MOOD_WORDS[band][0]!, band, promptVersion: "telegram-word.v1" });
    // Nine earlier days with a word, one day with none (09-22), and a word from another scope that is never listed.
    await db.insert(telegrams).values([
      past("2026-09-16", 2),
      past("2026-09-17", 1),
      past("2026-09-18", 0),
      past("2026-09-19", -1),
      past("2026-09-20", -2),
      past("2026-09-21", 0),
      past("2026-09-23", 1),
      past("2026-09-24", 2),
      past("2026-09-25", -1),
      past("2026-09-26", 0),
      { ...past("2026-09-26", 1), scope: "other" },
    ]);
    const map = await loadMapView(db, date);
    expect(map.telegram).toMatchObject({ word: own.word, runDate: date });
    expect(map.recent).toEqual([
      { date: "2026-09-26", word: MOOD_WORDS[0][0], band: 0 },
      { date: "2026-09-25", word: MOOD_WORDS[-1][0], band: -1 },
      { date: "2026-09-24", word: MOOD_WORDS[2][0], band: 2 },
      { date: "2026-09-23", word: MOOD_WORDS[1][0], band: 1 },
      { date: "2026-09-21", word: MOOD_WORDS[0][0], band: 0 },
      { date: "2026-09-20", word: MOOD_WORDS[-2][0], band: -2 },
      { date: "2026-09-19", word: MOOD_WORDS[-1][0], band: -1 },
    ]);
    // Nothing but the date, the word and the band.
    for (const r of map.recent!) expect(Object.keys(r).sort()).toEqual(["band", "date", "word"]);
    // A day with no word carries the last one; the list starts before the carried word and never repeats it.
    const carried = await loadMapView(db, toRunDate("2026-09-28"));
    expect(carried.telegram).toMatchObject({ runDate: date });
    expect(carried.recent!.map((r) => r.date)).toEqual(map.recent!.map((r) => r.date));
    // Each day lists the words before it. This one has no word and nothing to carry (those days have no events).
    expect((await loadMapView(db, toRunDate("2026-09-21"))).recent!.map((r) => r.date)).toEqual(["2026-09-20", "2026-09-19", "2026-09-18", "2026-09-17", "2026-09-16"]);
    // The site's file keeps the list (splitLocal).
    expect(splitLocal(map, localBase(date)).main.recent).toEqual(map.recent);
    await db.delete(telegrams).where(lt(telegrams.runDate, date));
  });

  it("sets aside a score run that breaks the rules twice and asks another (decision 51)", async () => {
    const good = worldAnswers()["telegram-score"]!;
    // The first run and its retry invent a reason; the next three runs are fine.
    const llm = new FakeLlm({ ...worldAnswers(), "telegram-score": (req) => (req.attempt <= 2 ? { scores: [] } : good(req)) });
    const report = await runTelegram(db, testConfig(), llm, date);
    expect(report).toMatchObject({ written: true, band: -1, scoreRuns: 3, rejected: 1 });
    expect(llm.calls.filter((c) => c.stage === "telegram-score")).toHaveLength(5);
  });

  it("groups only the day's new articles during the day, keeping its events and word, and adds them to the published file (decision 130)", async () => {
    const before = await db.select({ id: events.id }).from(events).where(eq(events.runDate, date));
    const [word] = await db.select().from(telegrams).where(eq(telegrams.runDate, date));
    const [src] = await db.select({ id: sources.id }).from(sources).where(eq(sources.desk, "world")).limit(1);
    const [fresh] = await db
      .insert(articles)
      .values({ sourceId: src!.id, url: "https://late.example/ferry", title: "Evening ferry adds a second crossing", lead: "The ferry adds a crossing.", publishedAt: new Date("2026-09-28T01:00:00Z") })
      .returning({ id: articles.id });
    const llm = new FakeLlm(worldAnswers());
    const report = await runClusterWorld(db, testConfig(), llm, date, [], { onlyNew: true });
    // The model saw only the new article, twice (the first pass and the pass for what it left), and no merge pass ran.
    expect(report).toMatchObject({ articles: 1, events: 1, alone: 1, merged: 0, onlyNew: true });
    expect(llm.calls.map((c) => c.stage)).toEqual(["cluster-world", "cluster-world"]);
    expect(llm.calls[0]!.user).toContain("Evening ferry adds a second crossing");
    expect(llm.calls[0]!.user).not.toContain("Grain port reopens");
    const after = await db.select({ id: events.id }).from(events).where(eq(events.runDate, date));
    expect(after).toHaveLength(before.length + 1);
    expect(after.map((e) => e.id)).toEqual(expect.arrayContaining(before.map((e) => e.id)));
    expect((await db.select().from(telegrams).where(eq(telegrams.runDate, date)))[0]?.word).toBe(word!.word);

    // The published file of the day before takes the day's stories by place, replacing its own copy of any.
    const day = await loadMapView(db, date, new Date("2026-09-28T02:00:00Z"), { local: "index", noCarry: true });
    const published = { ...day, runDate: "2026-09-26", items: [day.items[0]!], places: [day.places[day.items[0]!.place]!], generatedAt: 1 };
    const merged = withTodayStories(published, day, new Date("2026-09-28T02:00:00Z"));
    expect(merged.runDate).toBe("2026-09-26");
    expect(merged.telegram).toEqual(published.telegram);
    expect(merged.items).toHaveLength(day.items.length);
    expect(new Set(merged.places.map((p) => p.id)).size).toBe(merged.places.length);
    expect(merged.items.every((it) => it.event === undefined)).toBe(true);
    const ferry = merged.items.find((it) => it.id === `a${fresh!.id}`)!;
    expect(merged.places[ferry.place]!.id).toBe(day.places[day.items.find((it) => it.id === ferry.id)!.place]!.id);
    expect(merged.generatedAt).toBe(Date.parse("2026-09-28T01:00:00Z") / 1000);

    // Put the fixture day back as it was for the tests that follow.
    await db.delete(events).where(and(eq(events.runDate, date), notInArray(events.id, before.map((e) => e.id))));
    await db.delete(articles).where(eq(articles.id, fresh!.id));
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
  it("rejects a word from the past week whatever its band, and always leaves a word to choose (decision 128)", () => {
    const scored = [{ eventId: 2, importance: 4, score: -1 }];
    expect(wordProblems({ word: "Unease", events: [{ eventId: 2, line: "x" }] }, -1, scored, ["unease"])[0]).toMatch(/not one of: Strain/);
    expect(wordProblems({ word: "Strain", events: [{ eventId: 2, line: "x" }] }, -1, scored, ["Unease"])).toEqual([]);
    for (const band of [-2, -1, 0, 1, 2] as const) {
      expect(MOOD_WORDS[band].length).toBeGreaterThan(WORD_REPEAT_DAYS);
      expect(allowedWords(band, MOOD_WORDS[band].slice(0, WORD_REPEAT_DAYS)).length).toBeGreaterThan(0);
    }
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
