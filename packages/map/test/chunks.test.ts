// How the site is split (src/registry.ts): the main chunk holds the layout and Morning Edition; every other design is
// one entry module (src/designs/<id>.ts) with its own CSS file (src/designs/<id>.css), its fonts and what it registers,
// loaded the first time the design is shown. These tests keep that true as designs are added or changed.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { hasEntry } from "../src/registry.ts";
import { THEMES, type ThemeId } from "../src/themes.ts";
import { allDesignCss, baseCss } from "./css.ts";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const read = (p: string) => readFileSync(here(p), "utf8");
const ids = Object.keys(THEMES) as ThemeId[];
const others = ids.filter((id) => id !== "morning");
const designs = allDesignCss();
const entry = (id: string) => read(`../src/designs/${id}.ts`);
const themeIds = (css: string) => [...css.matchAll(/\[data-theme\s*=\s*"([\w-]+)"\]/g)].map((m) => m[1]!);

describe("a chunk for every design", () => {
  it("has an entry module for every design, and one for nothing else", () => {
    for (const id of ids) {
      expect(existsSync(here(`../src/designs/${id}.ts`)), id).toBe(true);
      expect(hasEntry(id), id).toBe(true);
    }
    const files = readdirSync(here("../src/designs/")).filter((f) => f.endsWith(".ts"));
    expect(files.map((f) => f.replace(/\.ts$/, "")).sort()).toEqual([...ids].sort());
  });

  it("gives every design but Morning Edition a CSS file its entry imports, and Morning Edition none", () => {
    expect([...designs.keys()].sort()).toEqual([...others].sort());
    for (const id of others) expect(entry(id), id).toContain(`import "./${id}.css";`);
    expect(entry("morning")).not.toContain(`import "./`);
    expect(existsSync(here("../src/designs/morning.css"))).toBe(false);
  });

  it("loads a design only through the registry: the page imports nothing of any but the default", () => {
    const imports: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(here(dir), { withFileTypes: true })) {
        const p = `${dir}${e.name}`;
        if (e.isDirectory()) walk(`${p}/`);
        else if (/\.ts$/.test(e.name) && !p.startsWith("../src/designs/")) {
          for (const m of read(p).matchAll(/from "([^"]*designs\/[^"]*)"|import "([^"]*designs\/[^"]*)"/g)) imports.push(`${p} ${m[1] ?? m[2]}`);
        }
      }
    };
    walk("../src/");
    expect(imports).toEqual(['../src/main.ts ./designs/morning.ts']);
  });
});

describe("a design's CSS is in its own file", () => {
  it("leaves no rule for any design but Morning Edition in the base file", () => {
    const named = new Set(themeIds(baseCss));
    named.delete("morning");
    expect([...named]).toEqual([]);
  });

  it("keeps each design's file to that design", () => {
    for (const [id, css] of designs) {
      const named = new Set(themeIds(css));
      expect(named.has(id), `${id} names itself`).toBe(true);
      named.delete(id);
      expect([...named], id).toEqual([]);
    }
  });

  it("leaves no selector of a design's own in the base file", () => {
    // Every selector that names a design is a rule of that design, wherever it sits; the base file has none of them.
    const base = new Set(selectors(baseCss));
    for (const [id, css] of designs) {
      const own = selectors(css).filter((s) => s.includes(`[data-theme="${id}"]`));
      expect(own.length, id).toBeGreaterThan(0);
      for (const s of own) expect(base.has(s), `${id}: ${s}`).toBe(false);
    }
  });

  it("keeps the classes only a design's own code builds with the design", () => {
    // The page chrome of these designs is made by their own modules, so its rules load with them (src/ui).
    const families: [string, RegExp][] = [
      ["desktop", /\.dk-/],
      ["postcard", /\.pc-/],
      ["shortwave", /\.sw-/],
      ["paper", /\.pp-/],
      ["flap", /\.fl-/],
      ["cube", /\.x-(home|ch|pv|ico|clock)\b/],
    ];
    for (const [id, re] of families) {
      expect(baseCss, id).not.toMatch(re);
      expect(designs.get(id), id).toMatch(re);
    }
  });

  it("has the default design's tokens in the base file as every page's first paint", () => {
    expect(baseCss).toMatch(/:root,\s*:root\[data-theme="morning"\]\s*\{/);
  });

  it("holds the page back for a saved design until its files are in", () => {
    expect(baseCss).toMatch(/html\[data-boot\] body\s*\{[^}]*visibility:\s*hidden/);
    // A hold that lets go by itself, so a design that cannot load never leaves the page blank.
    expect(baseCss).toMatch(/html\[data-boot\] body\s*\{[^}]*animation:\s*boot-hold/);
  });
});

/** Each selector of each rule, whitespace squeezed, at any depth. */
function selectors(css: string): string[] {
  const out: string[] = [];
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of bare.matchAll(/([^{}]+)\{/g)) {
    const head = m[1]!.trim();
    if (head.startsWith("@")) continue;
    for (const s of head.split(",")) out.push(s.replace(/\s+/g, " ").trim());
  }
  return out;
}

describe("a design's entry brings what the design needs", () => {
  it("registers the surface, scene, decoration, scenery and terrain the theme asks for", () => {
    for (const id of ids) {
      const t = THEMES[id];
      const src = entry(id);
      if (t.surface && t.surface !== "fold") expect(src, `${id} surface`).toContain(`registerSurface("${t.surface}"`);
      if (t.surface === "fold") expect(src, id).toContain('registerKit("fold"');
      if (t.surface === "vinyl") expect(src, id).toContain('registerKit("vinyl"');
      if (t.surface === "zine") expect(src, id).toContain('registerKit("zine"');
      if (t.scene) expect(src, `${id} scene`).toContain('registerKit("scenes"');
      if (t.decor) expect(src, `${id} decor`).toContain('registerKit("decor"');
      if (t.scenery) expect(src, `${id} scenery`).toContain('registerKit("scenery"');
      if (t.lowPoly) expect(src, `${id} lowPoly`).toContain('registerKit("lowPoly"');
    }
  });

  it("registers a page kit only for the designs that use it, and the rest do not", () => {
    // Which designs bring which chrome (src/ui): extras hold the page parts of ten designs, the others one each.
    const uses: Record<string, string[]> = {
      extras: ["sheet", "terminal", "prep", "rail", "rave", "realm", "tactical", "pindrop", "dual", "machine"],
      flap: ["flap"],
      paper: ["paper"],
      dial: ["shortwave"],
      channels: ["cube"],
      desktop: ["desktop"],
      vinyl: ["vinyl"],
      lobster: ["lobster"],
      postcard: ["postcard"],
      burger: ["burger"],
    };
    for (const [kit, users] of Object.entries(uses)) {
      for (const id of ids) {
        const has = entry(id).includes(`registerUi("${kit}"`);
        expect(has, `${id} ${kit}`).toBe(users.includes(id));
      }
    }
  });

  it("imports a font for every family a design's CSS names, in its entry or the default's", () => {
    // Each @fontsource family and its first face's name, from the packages the site depends on.
    const pkg = JSON.parse(read("../package.json")) as { dependencies: Record<string, string> };
    const families = new Map<string, string>();
    for (const name of Object.keys(pkg.dependencies).filter((n) => n.startsWith("@fontsource"))) {
      const dir = fileURLToPath(new URL(`../../../node_modules/${name}/`, import.meta.url));
      const file = ["index.css", "400.css", "latin-400.css", "wdth.css"].map((f) => `${dir}${f}`).find(existsSync);
      const face = file ? /font-family:\s*['"]?([^;'"]+)['"]?/.exec(readFileSync(file, "utf8"))?.[1] : null;
      if (face) families.set(name, face.trim());
    }
    expect(families.size).toBeGreaterThan(60);
    const imported = (id: string) => {
      const out = new Set<string>();
      for (const m of entry(id).matchAll(/import "(@fontsource[^/"]*\/[^/"]+)/g)) {
        const f = families.get(m[1]!.split("/").slice(0, 2).join("/"));
        if (f) out.add(f);
      }
      return out;
    };
    const used = (family: string, css: string) =>
      new RegExp(`(?:['"]|(?<=[:,\\s]))${family.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:['"]|\\s*[,;)}\\n])`, "i").test(css);
    const fromDefault = imported("morning");
    for (const [id, css] of designs) {
      const mine = imported(id);
      for (const family of families.values()) {
        if (used(family, css)) expect(mine.has(family) || fromDefault.has(family), `${id} uses ${family}`).toBe(true);
      }
    }
  });
});
