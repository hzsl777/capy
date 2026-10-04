/**
 * The Design picker's previews (decision 132): one small picture of every design, the whole page in its default view
 * with a place tuned, into public/thumbs/<id>.jpg. Run after a build, and again after changing how a design looks:
 *   npm run map:build && npm run map:thumbs
 * Uses the preinstalled Chromium when PLAYWRIGHT_BROWSERS_PATH is set.
 */
import { mkdir } from "node:fs/promises";
import { preview } from "vite";
import { chromium } from "playwright-core";
import { THEMES, type ThemeId } from "../src/themes.ts";

const OUT = "public/thumbs";
const only = process.argv.slice(2);
const ids = (Object.keys(THEMES) as ThemeId[]).filter((id) => !only.length || only.includes(id));

const server = await preview({ preview: { port: 4181, strictPort: true }, logLevel: "warn" });
const base = "http://localhost:4181/";
await mkdir(OUT, { recursive: true });
const executablePath = process.env.CHROMIUM_PATH ?? (process.env.PLAYWRIGHT_BROWSERS_PATH ? "/opt/pw-browsers/chromium" : undefined);
const browser = await chromium.launch(executablePath ? { executablePath } : {});

try {
  // A wide page drawn at a quarter of its size: 1280 by 800 becomes a 320 by 200 picture. Reduced motion holds every
  // design still, so a picture never catches a design mid-animation.
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 0.25, reducedMotion: "reduce" });
  page.on("pageerror", (e) => console.error(`[pageerror] ${e.message}`));
  for (const id of ids) {
    await page.goto(`${base}?theme=${id}&view=${THEMES[id].defaultView}&place=ll:-1.29,36.82`);
    await page.waitForFunction(() => document.querySelector(".place-name"), undefined, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/${id}.jpg`, quality: 72 });
    console.log(id);
  }
} finally {
  await browser.close();
  server.httpServer.close();
}
