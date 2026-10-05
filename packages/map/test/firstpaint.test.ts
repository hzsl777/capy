// The first paint, before the script names a design: Morning Edition's tokens are every page's defaults
// (src/style.css), so they must never leak into another design. Every design sets each of them itself, in its own
// file (src/designs/<id>.css), which loads before the design is shown.
import { describe, expect, it } from "vitest";
import { THEMES } from "../src/themes.ts";
import { allDesignCss, baseCss } from "./css.ts";

const designs = allDesignCss();

/** The custom properties a design's own `:root[data-theme="id"] { ... }` blocks set, in the CSS it loads with. */
function tokens(id: string): Set<string> {
  const css = id === "morning" ? baseCss : (designs.get(id) ?? "");
  const out = new Set<string>();
  const block = /((?::root[^{};]*?,\s*)*:root\[data-theme="([\w-]+)"\])\s*\{([^}]*)\}/g;
  for (const m of css.matchAll(block)) {
    if (m[2] !== id) continue;
    for (const v of m[3]!.matchAll(/(--[\w-]+)\s*:/g)) out.add(v[1]!);
  }
  return out;
}

describe("first paint", () => {
  it("gives the page Morning Edition's tokens before any design is named", () => {
    expect(baseCss).toMatch(/:root,\s*:root\[data-theme="morning"\]\s*\{/);
  });

  it("has every design set every default token, so none leaks from Morning Edition", () => {
    const defaults = tokens("morning");
    expect(defaults.size).toBeGreaterThan(10);
    for (const id of Object.keys(THEMES)) {
      const own = tokens(id);
      const missing = [...defaults].filter((v) => !own.has(v));
      expect(missing, id).toEqual([]);
    }
  });
});
