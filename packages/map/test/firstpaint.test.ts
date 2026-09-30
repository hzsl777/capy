// The first paint, before the script names a design: Morning Edition's tokens are every page's defaults
// (src/style.css), so they must never leak into another design. Every design sets each of them itself.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { THEMES } from "../src/themes.ts";

const css = readFileSync(fileURLToPath(new URL("../src/style.css", import.meta.url)), "utf8");

/** The custom properties a design's own `:root[data-theme="id"] { ... }` blocks set. */
function tokens(id: string): Set<string> {
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
    expect(css).toMatch(/:root,\s*:root\[data-theme="morning"\]\s*\{/);
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
