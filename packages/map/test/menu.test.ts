// The Design menu in labelled groups (decision 77): every design exactly once, whatever designs exist.
import { describe, expect, it } from "vitest";
import { DESIGN_GROUPS, THEMES, designMenu } from "../src/themes.ts";

describe("design menu", () => {
  it("lists every design exactly once", () => {
    const ids = Object.keys(THEMES);
    const listed = designMenu(ids).flatMap((g) => g.ids);
    expect(listed).toHaveLength(ids.length);
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual([...ids].sort());
  });

  it("skips ids that don't exist and puts unlisted designs under Other", () => {
    expect(designMenu(["lava", "morning", "brand-new"])).toEqual([
      { label: "Paper, ink and craft", ids: ["morning"] },
      { label: "Places and moods", ids: ["lava"] },
      { label: "Other", ids: ["brand-new"] },
    ]);
  });

  it("names each id in one group only", () => {
    const all = DESIGN_GROUPS.flatMap((g) => g.ids);
    expect(new Set(all).size).toBe(all.length);
  });
});
