/**
 * Screenshots every design in both views, plus the reader, into docs/screenshots.
 * Run after `npm run build`:  npm run screenshots
 * Uses the preinstalled Chromium when PLAYWRIGHT_BROWSERS_PATH is set.
 */
import { mkdir } from "node:fs/promises";
import { preview } from "vite";
import { chromium } from "playwright-core";

const OUT = process.env.SHOT_DIR ?? "../../docs/map/screenshots";
const themes = ["morning", "cabinet", "wire"] as const;
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
        await page.goto(`${base}?theme=${theme}&view=${view}&place=ll:-1.3,36.8`);
        await page.waitForFunction(() => document.querySelector(".place-name"));
        await page.waitForTimeout(1600);
        await page.screenshot({ path: `${OUT}/${label}-${theme}-${view}.jpg`, quality: 82 });
        if (view === (theme === "wire" ? "3d" : "2d")) {
          await page.locator(".story").first().click();
          await page.waitForTimeout(1200);
          await page.screenshot({ path: `${OUT}/${label}-${theme}-reader.jpg`, quality: 82 });
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
