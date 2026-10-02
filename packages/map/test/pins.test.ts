import { describe, expect, it } from "vitest";
import { isNew, markSeen, newCounts, startClocks, type Pin } from "../src/pins.ts";

describe("new since the last look at a pinned place", () => {
  const items = [
    { place: 0, t: 100 },
    { place: 0, t: 200 },
    { place: 0, t: 300 },
    { place: 1, t: 250 },
    { place: 2, t: 400 },
  ];

  it("counts reports after the last look, by place", () => {
    const counts = newCounts(items, new Map([[0, 150], [1, 100]]));
    expect(counts.get(0)).toBe(2);
    expect(counts.get(1)).toBe(1);
  });

  it("skips places that are not pinned and places with nothing new", () => {
    const counts = newCounts(items, new Map([[0, 300], [1, 250]]));
    expect(counts.size).toBe(0);
    expect(counts.has(2)).toBe(false);
  });

  it("does not count a report from the moment of the look", () => {
    expect(isNew(300, 300)).toBe(false);
    expect(isNew(301, 300)).toBe(true);
    expect(isNew(301, undefined)).toBe(false);
  });

  it("finds nothing new at a place just pinned", () => {
    // The pin's clock starts at the end of the reports on show, which is never before the newest of them.
    expect(newCounts(items, new Map([[0, 300]])).size).toBe(0);
  });

  it("starts the clock for pins saved before last looks were kept, and keeps the others", () => {
    const pins: Pin[] = [{ id: "a", name: "A" }, { id: "b", name: "B", seen: 50 }];
    expect(startClocks(pins, 500)).toEqual([{ id: "a", name: "A", seen: 500 }, { id: "b", name: "B", seen: 50 }]);
  });

  it("moves a look forward only", () => {
    const pins: Pin[] = [{ id: "a", name: "A", seen: 500 }, { id: "b", name: "B", seen: 50 }];
    expect(markSeen(pins, "a", 900)[0]!.seen).toBe(900);
    expect(markSeen(pins, "a", 100)[0]!.seen).toBe(500);
    expect(markSeen(pins, "a", 900)[1]!.seen).toBe(50);
  });
});
