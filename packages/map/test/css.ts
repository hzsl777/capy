// The stylesheets as the page has them: the base file (src/style.css) and one file per design (src/designs/<id>.css),
// which loads with the design. Tests that check a design's CSS read it through here.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

/** The base file: the layout, Morning Edition and what every design shares. */
export const baseCss = read("../src/style.css");

/** One design's file. */
export const designCss = (id: string) => read(`../src/designs/${id}.css`);

/** Every design's file, by id. */
export function allDesignCss(): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of readdirSync(fileURLToPath(new URL("../src/designs/", import.meta.url)))) {
    if (f.endsWith(".css")) out.set(f.replace(/\.css$/, ""), designCss(f.replace(/\.css$/, "")));
  }
  return out;
}

/** What the page has once a design is on: the base file, then that design's own, as the browser applies them. */
export const cssFor = (id: string) => `${baseCss}\n${designCss(id)}`;
