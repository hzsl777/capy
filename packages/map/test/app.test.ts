import { describe, expect, it } from "vitest";
import { byOrigin, canonicalRedirect, editionDate, FILTERS, formatCoords, formatWeekday, lastFullDay, withoutEmoji, wordStatus, groupByPlace, hasTiers, passes, scaleBar, tierOf, timeAgo, weightOf, type Filters } from "../src/data.ts";
import type { MapFile, MapItem } from "../src/types.ts";

const base: MapItem = { id: "1", t: 100, title: "t", url: "https://x", domain: "x", publisher: "X", lang: "en", topics: [], place: 0 };
const all = (from = 0, to = 1000): Filters => ({ topics: new Set(FILTERS), from, to });

describe("filters", () => {
  it("applies the time window", () => {
    expect(passes(base, all(0, 200))).toBe(true);
    expect(passes(base, all(150, 200))).toBe(false);
  });
  it("routes untagged items to Other", () => {
    expect(passes(base, { ...all(), topics: new Set(["other"]) })).toBe(true);
    expect(passes(base, { ...all(), topics: new Set(["sport"]) })).toBe(false);
    expect(passes({ ...base, topics: ["sport"] }, { ...all(), topics: new Set(["sport"]) })).toBe(true);
  });
  it("groups by place newest first", () => {
    const file: MapFile = {
      version: 2,
      source: "sample",
      generatedAt: 1000,
      runDate: "2026-09-27",
      places: [{ id: "a", name: "A", lat: 0, lon: 0 }],
      items: [base, { ...base, id: "2", t: 300 }],
      events: {},
      telegram: null,
    };
    expect(groupByPlace(file, all()).get(0)!.map((i) => i.id)).toEqual(["2", "1"]);
  });
});

describe("formatting", () => {
  it("formats coordinates and ages", () => {
    expect(formatCoords(-1.2833, 36.8167)).toBe("1°17′ S  36°49′ E");
    // Pin Drop's scale bar: a round distance no longer than the room it has.
    expect(scaleBar(30, 84)).toEqual({ km: 2000, width: 2000 / 30 });
    expect(scaleBar(1.1, 84).km).toBe(50);
    expect(scaleBar(0.009, 56).km).toBe(0.5);
    for (const k of [0.003, 0.7, 12, 95, 400]) {
      const { km, width } = scaleBar(k, 84);
      expect(width).toBeLessThanOrEqual(84 + 1e-9);
      expect(width).toBeGreaterThan(84 / 5 - 1e-9);
      expect(String(km)).toMatch(/^(0\.0*)?[125]0*$/);
    }
    expect(timeAgo(0, 30)).toBe("just now");
    expect(timeAgo(0, 600)).toBe("10 min ago");
    expect(timeAgo(0, 7200)).toBe("2 h ago");
  });
});

describe("zoom tiers (decision 30)", () => {
  const item = (reach?: number, importance?: number) => ({ reach, importance }) as MapItem;
  it("ranks places into five zoom tiers by importance and reach (decision 46)", () => {
    expect(tierOf(item(1, 5), true)).toBe(0);
    expect(tierOf(item(1, 4), true)).toBe(0);
    expect(tierOf(item(4, 1), true)).toBe(0);
    expect(tierOf(item(1, 3), true)).toBe(1);
    expect(tierOf(item(3, 1), true)).toBe(1);
    expect(tierOf(item(1, 2), true)).toBe(2);
    expect(tierOf(item(2, 1), true)).toBe(2);
    expect(tierOf(item(1, 1), true)).toBe(3);
    expect(tierOf(item(), true)).toBe(4);
    // GDELT's local stories carry importance 1 but no model rated them: they wait for the closest zoom.
    expect(tierOf({ ...item(1, 1), via: "gdelt" }, true)).toBe(4);
    expect(tierOf({ ...item(1, 1), via: "gdelt" }, false)).toBe(0);
  });
  it("weighs a place by its most important story", () => {
    expect(weightOf([item(1, 2), item(1, 4)])).toBe(4);
    expect(weightOf([item()])).toBe(1);
    // Every step has its own mark (decision 146); GDELT's local stories, which no model rated, are 0, "not rated".
    for (const i of [1, 2, 3, 4, 5]) expect(weightOf([item(1, i)])).toBe(i);
    expect(weightOf([{ ...item(1, 1), via: "gdelt" }])).toBe(0);
    expect(weightOf([{ ...item(1, 1), via: "gdelt" }, item(1, 2)])).toBe(2);
  });
  it("shows everything at once when the file has no event data", () => {
    expect(tierOf(item(), false)).toBe(0);
    expect(hasTiers({ items: [item()] } as unknown as MapFile)).toBe(false);
    expect(hasTiers({ items: [item(1, 2)] } as unknown as MapFile)).toBe(true);
  });
});

describe("the word's date and status line (decisions 81 and 127)", () => {
  const word = (runDate: string) => ({ word: "Grief", band: -1, runDate, items: [], scores: [] }) as unknown as MapFile["telegram"];
  // Noon on October 1 in New York.
  const noon = new Date("2026-10-01T16:00:00Z");

  it("shows a finished day's word, dated like a morning paper the day after the news it weighed", () => {
    expect(wordStatus({ source: "live", runDate: "2026-09-30", telegram: word("2026-09-30") }, noon)).toEqual({ date: "2026-09-30", note: null });
    expect(editionDate("2026-09-30")).toBe("2026-10-01");
    expect(editionDate("2026-12-31")).toBe("2027-01-01");
  });

  it("ends the day at midnight in New York, in summer and winter time", () => {
    expect(lastFullDay(new Date("2026-10-04T03:59:00Z"))).toBe("2026-10-02");
    expect(lastFullDay(new Date("2026-10-04T04:01:00Z"))).toBe("2026-10-03");
    expect(lastFullDay(new Date("2026-12-05T04:30:00Z"))).toBe("2026-12-03");
    expect(lastFullDay(new Date("2026-12-05T05:01:00Z"))).toBe("2026-12-04");
  });

  it("keeps the last word after midnight and says the next one is being chosen", () => {
    const early = new Date("2026-10-01T04:20:00Z");
    expect(wordStatus({ source: "live", runDate: "2026-09-29", telegram: word("2026-09-29") }, early)).toEqual({ date: "2026-09-29", note: `The next word, from ${formatWeekday("2026-09-30")}'s news, is being chosen.` });
  });

  it("names the day that had no word when an earlier word is carried", () => {
    expect(wordStatus({ source: "live", runDate: "2026-09-30", telegram: word("2026-09-29") }, noon)).toEqual({ date: "2026-09-29", note: `${formatWeekday("2026-09-30")}'s news gave no word: none passed the checks.` });
  });

  it("takes emoji and flags off headlines and keeps every word, digit and sign as published", () => {
    expect(withoutEmoji("\u{1F534} Live: talks resume \u{1F1FA}\u{1F1F8}")).toBe("Live: talks resume");
    expect(withoutEmoji("Rain \u26A0\uFE0F floods 3 towns \u{1F30A}\u{1F44D}\u{1F3FD}")).toBe("Rain floods 3 towns");
    expect(withoutEmoji("Fund\u00ae says \u00a9 2026, 50% off\u2122")).toBe("Fund\u00ae says \u00a9 2026, 50% off\u2122");
    expect(withoutEmoji("Минск: погода")).toBe("Минск: погода");
    expect(withoutEmoji("東京の天気")).toBe("東京の天気");
  });

  it("says nothing of the kind for the sample or a demo", () => {
    expect(wordStatus({ source: "sample", runDate: "2026-09-20", telegram: word("2026-09-20") }, noon).note).toBeNull();
  });
});

describe("one address (decision 93)", () => {
  const home = "https://globalgist.io/";
  it("sends the www name and the workers.dev address to the canonical one, keeping a shared link's query", () => {
    expect(canonicalRedirect(new URL("https://www.globalgist.io/"), home)).toBe("https://globalgist.io/");
    expect(canonicalRedirect(new URL("https://globalgist.someone.workers.dev/?place=ll:1,2"), home)).toBe("https://globalgist.io/?place=ll:1,2");
  });
  it("leaves the canonical address, branch previews, local development and a build without one alone", () => {
    expect(canonicalRedirect(new URL("https://globalgist.io/?theme=pond"), home)).toBeNull();
    expect(canonicalRedirect(new URL("https://claude-branch-globalgist.someone.workers.dev/"), home)).toBeNull();
    expect(canonicalRedirect(new URL("https://claude-branch.globalgist.io/"), home)).toBeNull();
    expect(canonicalRedirect(new URL("https://f29ea4d7.globalgist.io/"), home)).toBeNull();
    expect(canonicalRedirect(new URL("http://localhost:5173/"), home)).toBeNull();
    expect(canonicalRedirect(new URL("https://globalgist.someone.workers.dev/"), null)).toBeNull();
  });
});

describe("a place's reports by where their outlets are (decision 98)", () => {
  const item = (id: string, t: number, extra: Partial<MapItem> = {}): MapItem => ({ id, t, title: id, url: `https://x.test/${id}`, domain: "x.test", publisher: "X", lang: "en", topics: [], place: 0, ...extra });

  it("puts the place's own outlets first, then outlets elsewhere, then GDELT, keeping newest first in each", () => {
    const items = [item("abroad-new", 9, { from: "Damascus" }), item("gdelt", 8, { via: "gdelt" }), item("local-new", 7), item("abroad-old", 5, { from: "Doha" }), item("local-old", 3)];
    expect(byOrigin(items).map((g) => [g.origin, g.items.map((i) => i.id)])).toEqual([
      ["here", ["local-new", "local-old"]],
      ["elsewhere", ["abroad-new", "abroad-old"]],
      ["gdelt", ["gdelt"]],
    ]);
  });

  it("lists an outlet's reports on another country after the place's own news, before GDELT's (decision 107)", () => {
    const items = [item("away", 5, { abroad: true }), item("gdelt", 4, { via: "gdelt" }), item("home", 3), item("other", 2, { from: "Lima" })];
    expect(byOrigin(items).map((g) => [g.origin, g.items.map((i) => i.id)])).toEqual([
      ["here", ["home"]],
      ["elsewhere", ["other"]],
      ["abroad", ["away"]],
      ["gdelt", ["gdelt"]],
    ]);
  });

  it("never lets a report on another country raise its outlet's city (decision 107)", () => {
    const away: MapItem = { ...base, importance: 5, reach: 6, abroad: true };
    expect(weightOf([away])).toBe(1);
    expect(weightOf([away, { ...base, importance: 3 }])).toBe(3);
    expect(tierOf(away, true)).toBe(3);
  });

  it("leaves out empty groups", () => {
    expect(byOrigin([item("a", 1, { from: "Kyiv" })]).map((g) => g.origin)).toEqual(["elsewhere"]);
    expect(byOrigin([])).toEqual([]);
  });
});
