import { describe, expect, it } from "vitest";
import { THEMES, designMenu, type ThemeId } from "../src/themes.ts";
import { isDark, luminance, menuOrder, readIds, stepDesign, withRecent } from "../src/ui/designs.ts";

const listed = (Object.keys(THEMES) as ThemeId[]).filter((id) => !THEMES[id].experimental);

describe("the Design picker (decision 131)", () => {
  it("reads saved lists, keeping only designs that exist, each once", () => {
    expect(readIds("wire,nope,morning,wire,")).toEqual(["wire", "morning"]);
    expect(readIds("")).toEqual([]);
  });

  it("keeps the recent list newest first, without repeats, and short", () => {
    let recent: ThemeId[] = [];
    for (const id of ["morning", "wire", "cabinet", "wire", "pirate", "space", "candy", "bit8"] as ThemeId[]) recent = withRecent(recent, id);
    expect(recent).toEqual(["bit8", "candy", "space", "pirate", "wire", "cabinet"]);
  });

  it("steps through the menu's order both ways and wraps round, as the phone's swipe does", () => {
    const order = menuOrder(listed);
    expect(order).toEqual(designMenu(listed).flatMap((g) => g.ids));
    expect(new Set(order).size).toBe(listed.length);
    expect(stepDesign(listed, order[0]!, 1)).toBe(order[1]);
    expect(stepDesign(listed, order[0]!, -1)).toBe(order.at(-1));
    expect(stepDesign(listed, order.at(-1)!, 1)).toBe(order[0]);
  });

  it("sorts designs into light and dark by their own sea and land", () => {
    expect(luminance("#ffffff")).toBeCloseTo(1, 5);
    expect(luminance("#000000")).toBe(0);
    expect(luminance("not a colour")).toBe(0.5);
    expect(isDark("wire")).toBe(true);
    expect(isDark("morning")).toBe(false);
    const dark = listed.filter(isDark).length;
    expect(dark).toBeGreaterThan(5);
    expect(listed.length - dark).toBeGreaterThan(5);
  });
});
