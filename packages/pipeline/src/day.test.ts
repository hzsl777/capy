import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { toRunDate } from "@2dayai/core";
import { articles, citations, editions, eventExplanations, events, feedback, llmCalls, loadEditionView, recordFeedback, runs, type Db } from "@2dayai/db";
import { runDay } from "./day.js";
import { FEED_XML, PROFILE_YAML } from "./fixtures/day.js";
import { FakeLlm } from "./llm/fake.js";
import { isDue, runDeliver } from "./stages/deliver.js";
import { runExplain } from "./stages/explain.js";
import { selectionProblems } from "./stages/select.js";
import { createTestDb } from "./test/db.js";
import { testConfig } from "./test/config.js";

const date = toRunDate("2026-09-04");
let db: Db;
let close: () => Promise<void>;
let dir: string;

/** The fake model answers the way a good run would, plus one fabricated sentence that must be caught. */
function fakeLlm(ids: { treasury: number; journal: number; chip: number }, opts: { badHeadlineFirst?: boolean } = {}) {
  return new FakeLlm({
    cluster: () => ({
      events: [
        { title: "Treasury proposes partnership basis-shifting rules", articleIds: [ids.treasury, ids.journal], importance: 4, importanceReason: "new reporting obligation for thousands of partnerships" },
        { title: "Chipmaker starts Arizona packaging plant", articleIds: [ids.chip], importance: 3, importanceReason: "large capital project with a depreciation program" },
        { title: "Phantom event", articleIds: [9999], importance: 5, importanceReason: "invented id must be dropped" },
      ],
      skipped: [],
    }),
    explain: ({ user }) => {
      if (user.includes("basis-shifting")) {
        return {
          whatHappened: [
            { text: "Treasury and the IRS proposed rules on basis shifting among related partners.", citations: [{ articleId: ids.treasury, excerpt: "proposed regulations targeting basis-shifting transactions among related partners" }] },
            { text: "Partnerships would report certain basis adjustments on a new form.", citations: [{ articleId: ids.treasury, excerpt: "report certain basis adjustments under section 734 and section 743 on a new form" }] },
            { text: "The rules take effect immediately for all partnerships.", citations: [{ articleId: ids.treasury, excerpt: "take effect immediately for all partnerships" }] },
          ],
          whyItMatters: [{ text: "Practitioners expect the burden to fall on mid-size partnerships.", citations: [{ articleId: ids.journal, excerpt: "the reporting burden would fall on mid-size partnerships" }] }],
          whatChangesNext: [{ text: "Comments are due 60 days after publication.", citations: [{ articleId: ids.treasury, excerpt: "Comments are due 60 days after publication" }] }],
        };
      }
      return {
        whatHappened: [
          { text: "A chipmaker began building an advanced packaging plant in Arizona.", citations: [{ articleId: ids.chip, excerpt: "began construction of an advanced packaging plant in Arizona" }] },
          { text: "The company put the investment at 6.5 billion dollars.", citations: [{ articleId: ids.chip, excerpt: "6.5 billion dollars of investment" }] },
        ],
        whyItMatters: [{ text: "The project qualifies for accelerated depreciation under a state program.", citations: [{ articleId: ids.chip, excerpt: "qualifies for accelerated depreciation under a program enacted last year" }] }],
        whatChangesNext: [],
      };
    },
    select: ({ user, attempt }) => {
      const eventIds = [...user.matchAll(/\[event (\d+)\]/g)].map((m) => Number(m[1]));
      const [basis, chip] = eventIds;
      const headline = opts.badHeadlineFirst && attempt === 1 ? "Is your partnership next?" : "Basis-shifting rules arrive; your related-party partnerships now have a form.";
      return {
        selected: [
          { eventId: basis, line: "Treasury proposed basis-shifting rules that add a reporting form for your related-party partnerships.", stakeParagraph: "You manage related-party partnerships. The new form would apply to basis adjustments you already track.", outsideInterests: false },
          { eventId: chip, line: "A chipmaker started a 6.5 billion dollar Arizona plant under an accelerated depreciation program.", stakeParagraph: "A large asset-heavy project with a state depreciation program is close to your fixed-asset work.", outsideInterests: false },
        ],
        rejected: [],
        quietDay: false,
        headline,
      };
    },
  });
}

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  dir = mkdtempSync(join(tmpdir(), "2dayai-"));
  writeFileSync(join(dir, "sources.yaml"), `sources:\n  - { id: fixture-wire, name: Fixture wire, url: https://fixture.test/feed.xml, topic: tax, tier: primary }\n`);
  writeFileSync(join(dir, "r01.yaml"), PROFILE_YAML);
});
afterAll(async () => {
  await close();
});

describe("a full day on a real Postgres engine", () => {
  it("runs every stage, verifies citations, drops the fabricated sentence, and writes one edition", async () => {
    // First pass with a throwaway fake so article ids exist, then the real fake keyed by those ids.
    const deps = { fetchFeed: async () => FEED_XML, fetchPage: async () => "", sourcesPath: join(dir, "sources.yaml"), readersDir: dir };
    const probe = new FakeLlm({ cluster: () => ({ events: [], skipped: [] }), explain: () => ({}), select: () => ({}) });
    await runDay(db, testConfig(), probe, date, deps);
    const rows = await db.select({ id: articles.id, url: articles.url }).from(articles);
    const idOf = (part: string) => rows.find((r) => r.url.includes(part))!.id;
    const ids = { treasury: idOf("treasury-basis"), journal: idOf("journal-basis"), chip: idOf("chip-plant") };

    const llm = fakeLlm(ids, { badHeadlineFirst: true });
    const out = await runDay(db, testConfig(), llm, date, deps);

    expect(out["ingest"]).toEqual([{ source: "fixture-wire", fetched: 3, inserted: 0 }]);
    expect(out["cluster"]).toEqual({ articles: 3, events: 2, skipped: 0, unknownIds: 1, unassigned: 0 });
    expect(out["explain"]).toEqual({ events: 2, usable: 2, unusable: 0, failed: 0, sentencesDropped: 1 });
    expect(out["select"]).toEqual({ readers: 1, editions: 1, quiet: 0, failed: 0, retried: 1, skippedSent: 0 });

    const evs = await db.select().from(events).where(eq(events.runDate, date));
    expect(evs.map((e) => e.title)).not.toContain("Phantom event");

    const basis = evs.find((e) => e.title.includes("basis"))!;
    const ex = (await db.select().from(eventExplanations).where(eq(eventExplanations.eventId, basis.id)))[0]!;
    const texts = JSON.stringify(ex.sentences);
    expect(texts).not.toContain("take effect immediately");
    expect(ex.survivors).toBe(4);
    expect(ex.dropped).toBe(1);
    const cites = await db.select().from(citations).where(eq(citations.eventId, basis.id));
    expect(cites.filter((c) => !c.verified).map((c) => c.excerpt)).toEqual(["take effect immediately for all partnerships"]);
    expect(cites.filter((c) => c.verified)).toHaveLength(4);

    const ed = (await db.select().from(editions))[0]!;
    expect(ed.headline).toMatch(/^Basis-shifting rules arrive/);
    expect(ed.quietDay).toBe(false);

    const recordedStages = (await db.select({ stage: runs.stage, status: runs.status }).from(runs)).filter((r) => r.status === "ok").map((r) => r.stage);
    expect(new Set(recordedStages)).toEqual(new Set(["ingest", "readers", "enrich-briefing", "cluster", "cluster-world", "enrich", "explain", "select", "telegram", "local", "prune"]));
    expect(await db.select().from(llmCalls)).toHaveLength(0); // the fake never spends
  });

  it("renders the edition with sources limited to cited articles, then delivers once", async () => {
    const reader = (await db.select().from(editions))[0]!;
    const view = (await loadEditionView(db, { editionId: reader.id }))!;
    expect(view.items).toHaveLength(2);
    const basis = view.items[0]!;
    expect(basis.sources.map((s) => s.url).sort()).toEqual(["https://fixture.test/journal-basis", "https://fixture.test/treasury-basis"]);
    expect(basis.explanation.whatHappened.map((s) => s.text)).not.toContain("The rules take effect immediately for all partnerships.");

    const sent: string[] = [];
    const send = async (m: { to: string; subject: string; html: string; text: string }) => {
      sent.push(`${m.to}|${m.subject}`);
      expect(m.html).toContain("Open the story");
      expect(m.html).toContain("/f/");
      expect(m.text).toContain("1. Treasury proposed");
      return { id: "msg_1" };
    };
    const early = new Date("2026-09-04T09:30:00Z"); // 05:30 in New York, before the 06:00 delivery hour
    expect(await runDeliver(db, testConfig(), date, send, early)).toEqual({ due: 0, sent: 0, failed: 0, waiting: 1 });
    const later = new Date("2026-09-04T10:30:00Z"); // 06:30 in New York
    expect(await runDeliver(db, testConfig(), date, send, later)).toEqual({ due: 1, sent: 1, failed: 0, waiting: 0 });
    expect(await runDeliver(db, testConfig(), date, send, later)).toEqual({ due: 0, sent: 0, failed: 0, waiting: 0 });
    expect(sent).toEqual(["reader@example.test|Basis-shifting rules arrive; your related-party partnerships now have a form."]);
  });

  it("records feedback only for an event in that reader's edition on that date", async () => {
    const view = (await loadEditionView(db, { editionId: (await db.select().from(editions))[0]!.id }))!;
    const eventId = view.items[0]!.eventId;
    expect(await recordFeedback(db, { readerToken: view.readerToken, runDate: view.runDate, eventId, kind: "more" })).toEqual({ title: view.items[0]!.title });
    expect(await recordFeedback(db, { readerToken: "not-a-token", runDate: view.runDate, eventId, kind: "more" })).toBeNull();
    expect(await recordFeedback(db, { readerToken: view.readerToken, runDate: "2026-01-01", eventId, kind: "more" })).toBeNull();
    expect(await recordFeedback(db, { readerToken: view.readerToken, runDate: view.runDate, eventId: 999999, kind: "more" })).toBeNull();
    expect(await db.select().from(feedback)).toHaveLength(1);
  });

  it("refuses to re-cluster a date with a sent edition unless forced, and never re-selects for a sent reader", async () => {
    const rows = await db.select({ id: articles.id, url: articles.url }).from(articles);
    const idOf = (part: string) => rows.find((r) => r.url.includes(part))!.id;
    const ids = { treasury: idOf("treasury-basis"), journal: idOf("journal-basis"), chip: idOf("chip-plant") };
    const deps = { fetchFeed: async () => FEED_XML, fetchPage: async () => "", sourcesPath: join(dir, "sources.yaml"), readersDir: dir };
    await expect(runDay(db, testConfig(), fakeLlm(ids), date, deps)).rejects.toThrow(/already sent/);

    const before = (await db.select().from(events)).map((e) => e.id);
    const out = await runDay(db, testConfig(), fakeLlm(ids), date, { ...deps, force: true });
    expect(out["select"]).toEqual({ readers: 1, editions: 0, quiet: 0, failed: 0, retried: 0, skippedSent: 1 });
    const after = (await db.select().from(events)).map((e) => e.id);
    expect(after.some((id) => before.includes(id))).toBe(false);
    expect(await db.select().from(eventExplanations)).toHaveLength(2);
    const eds = await db.select().from(editions);
    expect(eds).toHaveLength(1);
    expect(eds[0]!.sentAt).not.toBeNull();
    expect(await db.select().from(feedback)).toHaveLength(1); // feedback survives the cascade
  });

  it("stops the day instead of writing quiet editions when the explain stage dies", async () => {
    const dead = new FakeLlm({ explain: () => { throw new Error("api down"); } });
    await expect(runExplain(db, testConfig(), dead, date)).rejects.toThrow(/model requests failed/);
  });
});

describe("isDue", () => {
  it("sends an evening New York edition after UTC midnight and not before its hour", () => {
    expect(isDue("2026-09-04", 20, "America/New_York", new Date("2026-09-04T23:30:00Z"))).toBe(false); // 19:30 local
    expect(isDue("2026-09-04", 20, "America/New_York", new Date("2026-09-05T00:30:00Z"))).toBe(true); // 20:30 local, still Sept 4
    expect(isDue("2026-09-04", 20, "America/New_York", new Date("2026-09-06T00:30:00Z"))).toBe(true); // a day late still sends
    expect(isDue("2026-09-04", 6, "Asia/Tokyo", new Date("2026-09-03T22:00:00Z"))).toBe(true); // 07:00 Sept 4 in Tokyo
    expect(isDue("2026-09-04", 6, "Asia/Tokyo", new Date("2026-09-03T20:00:00Z"))).toBe(false); // 05:00 Sept 4 in Tokyo
  });
});

describe("selectionProblems", () => {
  const usable = new Set([1, 2, 3, 4]);
  const good = { selected: [1, 2, 3].map((id) => ({ eventId: id, line: "x", stakeParagraph: "y", outsideInterests: false })), rejected: [{ eventId: 4, reason: "low-importance" as const }], quietDay: false, headline: "Rates held." };
  it("passes a clean selection", () => {
    expect(selectionProblems(good, usable)).toEqual([]);
  });
  it("catches unknown ids, duplicates, overlap, too few, and headline rules", () => {
    const bad = { ...good, selected: [{ ...good.selected[0]!, eventId: 9 }, { ...good.selected[1]!, eventId: 2 }, { ...good.selected[2]!, eventId: 2 }], rejected: [{ eventId: 2, reason: "duplicate" as const }], headline: "Why you should care?" };
    const problems = selectionProblems(bad, usable);
    expect(problems).toContain("selected event 9 is not in the list");
    expect(problems).toContain("event 2 selected twice");
    expect(problems).toContain("event 2 is both selected and rejected");
    expect(problems).toContain("headline: question form");
  });
});
