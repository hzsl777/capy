import { describe, expect, it } from "vitest";
import { FILTERS, formatCoords, groupByPlace, hasTiers, passes, tierOf, timeAgo, type Filters } from "../src/data.ts";
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
    expect(timeAgo(0, 30)).toBe("just now");
    expect(timeAgo(0, 600)).toBe("10 min ago");
    expect(timeAgo(0, 7200)).toBe("2 h ago");
  });
});

describe("zoom tiers (decision 30)", () => {
  const item = (reach?: number, importance?: number) => ({ reach, importance }) as MapItem;
  it("shows widely reported or important stories from the widest zoom", () => {
    expect(tierOf(item(3, 1), true)).toBe(0);
    expect(tierOf(item(1, 4), true)).toBe(0);
    expect(tierOf(item(2, 1), true)).toBe(1);
    expect(tierOf(item(1, 3), true)).toBe(1);
    expect(tierOf(item(1, 2), true)).toBe(2);
    expect(tierOf(item(), true)).toBe(2);
  });
  it("shows everything at once when the file has no event data", () => {
    expect(tierOf(item(), false)).toBe(0);
    expect(hasTiers({ items: [item()] } as unknown as MapFile)).toBe(false);
    expect(hasTiers({ items: [item(1, 2)] } as unknown as MapFile)).toBe(true);
  });
});
