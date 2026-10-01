/**
 * Screenshots every design in both views, plus the reader, into docs/screenshots.
 * Run after `npm run build`:  npm run screenshots
 * Uses the preinstalled Chromium when PLAYWRIGHT_BROWSERS_PATH is set.
 */
import { mkdir } from "node:fs/promises";
import { preview } from "vite";
import { chromium } from "playwright-core";

const OUT = process.env.SHOT_DIR ?? "../../docs/map/screenshots";
const themes = ["morning", "cabinet", "wire", "ops", "blueprint", "pirate", "space", "candy", "bit8", "bit16", "bit64", "realize", "newsroom", "pond", "honeycomb", "arcana", "arcadia", "nightcap", "campus", "lasso", "drive", "stitch", "glass", "club", "pool", "snow", "rave", "sheet", "terminal", "prep", "rail", "aquarium", "lava", "radar", "noir", "arcade", "stadium", "popup", "trainset", "chalk", "sketch", "cube", "dual", "realm", "tactical", "reef", "blocks", "pindrop", "deli", "marquee"];
const views = ["2d", "3d"] as const;

const server = await preview({ preview: { port: 4179, strictPort: true }, logLevel: "warn" });
const base = "http://localhost:4179/";
await mkdir(OUT, { recursive: true });
// Prefer a system Chromium (CI images, cloud sessions) over Playwright's pinned download.
const executablePath = process.env.CHROMIUM_PATH ?? (process.env.PLAYWRIGHT_BROWSERS_PATH ? "/opt/pw-browsers/chromium" : undefined);
const browser = await chromium.launch(executablePath ? { executablePath } : {});

try {
  for (const [label, viewport] of [
    ["desktop", { width: 1440, height: 900 }],
    ["mobile", { width: 390, height: 844 }],
  ] as const) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: Number(process.env.SHOT_DPR ?? 1) });
    page.on("pageerror", (e) => console.error(`[pageerror] ${e.message}`));
    for (const theme of themes) {
      for (const view of views) {
        if (label === "mobile" && view === "2d" && theme !== "morning") continue;
        await page.goto(`${base}?theme=${theme}&view=${view}&place=ll:-1.29,36.82`);
        await page.waitForFunction(() => document.querySelector(".place-name"));
        await page.waitForTimeout(1600);
        await page.screenshot({ path: `${OUT}/${label}-${theme}-${view}.jpg`, quality: 82 });
        // Console Menu's home screen of channels (decision 100), opened from the Menu button and closed with Escape.
        if (theme === "cube" && view === "3d") {
          await page.locator(".x-menu").click();
          await page.waitForTimeout(900);
          await page.screenshot({ path: `${OUT}/${label}-cube-home.jpg`, quality: 82 });
          await page.keyboard.press("Escape");
          await page.waitForTimeout(900);
        }
        if (view === (theme === "wire" ? "3d" : "2d")) {
          await page.locator(".story").first().click();
          await page.waitForTimeout(1200);
          await page.screenshot({ path: `${OUT}/${label}-${theme}-reader.jpg`, quality: 82 });
          // The telegram: level 0 and 1, then one event's explanation and sources (levels 2 and 3).
          if (await page.locator(".telegram-word").count()) {
            await page.locator(".telegram-word").click();
            await page.waitForTimeout(900);
            await page.screenshot({ path: `${OUT}/${label}-${theme}-telegram.jpg`, quality: 82 });
            await page.locator(".telegram-view .story").first().click();
            await page.waitForTimeout(1300);
            await page.screenshot({ path: `${OUT}/${label}-${theme}-explained.jpg`, quality: 82 });
          }
        }
      }
    }
    await page.close();
  }
} finally {
  await browser.close();
  server.httpServer.close();
}
console.log(`screenshots -> ${OUT}`);
