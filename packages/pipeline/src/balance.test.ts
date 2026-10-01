import { describe, expect, it } from "vitest";
import { SourcesFileSchema, type Source } from "@2dayai/core";
import { heldGroups } from "./balance.js";

const src = (id: string, balance?: Source["balance"]): Source => ({ id, name: id, url: `https://${id}.example/feed`, topic: "world", tier: "general", desk: "world", lang: "en", place: { name: "Here", lat: 0, lon: 0 }, ...(balance ? { balance } : {}) });
const list = [
  src("north-1", { group: "valley", side: "north" }),
  src("north-2", { group: "valley", side: "north" }),
  src("south-1", { group: "valley", side: "south" }),
  src("east-1", { group: "coast", side: "east" }),
  src("west-1", { group: "coast", side: "west" }),
  src("plain"),
];

describe("both or neither (decision 90)", () => {
  it("holds nothing while every side of every group has a story", () => {
    const r = heldGroups(list, new Map([["north-2", 3], ["south-1", 1], ["east-1", 2], ["west-1", 5]]));
    expect(r.held).toEqual([]);
    expect([...r.heldSources]).toEqual([]);
  });
  it("holds the whole group, both sides, when one side has no story", () => {
    const r = heldGroups(list, new Map([["north-1", 4], ["north-2", 2], ["east-1", 2], ["west-1", 1]]));
    expect(r.held).toEqual([{ group: "valley", missing: ["south"] }]);
    expect([...r.heldSources].sort()).toEqual(["north-1", "north-2", "south-1"]);
  });
  it("never holds a source outside a group", () => {
    const r = heldGroups(list, new Map());
    expect(r.held.map((h) => h.group)).toEqual(["coast", "valley"]);
    expect(r.heldSources.has("plain")).toBe(false);
  });
  it("refuses a group with only one side in the source list", () => {
    const parsed = SourcesFileSchema.safeParse({ sources: [src("north-1", { group: "valley", side: "north" }), src("north-2", { group: "valley", side: "north" })] });
    expect(parsed.success).toBe(false);
    expect(SourcesFileSchema.safeParse({ sources: list }).success).toBe(true);
  });
});
