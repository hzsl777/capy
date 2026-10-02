// The Design menu in labelled groups (decision 77): every design exactly once, whatever designs exist.
import { describe, expect, it } from "vitest";
import { DESIGN_GROUPS, FEATURED, THEMES, designMenu } from "../src/themes.ts";

describe("design menu", () => {
  it("lists every design exactly once", () => {
    const ids = Object.keys(THEMES);
    const listed = designMenu(ids).flatMap((g) => g.ids);
    expect(listed).toHaveLength(ids.length);
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual([...ids].sort());
  });

  it("skips ids that don't exist and puts unlisted designs under Other", () => {
    expect(designMenu(["lava", "morning", "sketch", "brand-new"])).toEqual([
      { label: "Featured", ids: ["morning"] },
      { label: "Paper, ink and craft", ids: ["sketch"] },
      { label: "Places and moods", ids: ["lava"] },
      { label: "Other", ids: ["brand-new"] },
    ]);
  });

  it("lists the featured designs first, and each of them only there (decision 111)", () => {
    const menu = designMenu(Object.keys(THEMES));
    expect(menu[0]!.label).toBe("Featured");
    expect(menu[0]!.ids).toEqual([...FEATURED]);
    expect(menu.slice(1).flatMap((g) => g.ids).some((id) => FEATURED.includes(id))).toBe(false);
  });

  it("names each id in one group only", () => {
    const all = DESIGN_GROUPS.flatMap((g) => g.ids);
    expect(new Set(all).size).toBe(all.length);
  });
});
