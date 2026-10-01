// The site's share image, 1200 by 630 (decision 92): the preview a link to the site shows. With a day's map file it
// shows that day's word under its date with the "Chosen by AI" line, as the word always appears (decision 40), and a
// dot for every place with a story that day; without one, the outlets' cities and the tagline. Land and coasts only:
// no borders and no names (packages/map/AGENTS.md, rule 1).
// Usage: node tools/share-image.mjs <out.png> [map.json] [chromium path]
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { geoEqualEarth, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import { parse } from "yaml";
import { chromium } from "playwright-core";

const W = 1200;
const H = 630;
const root = resolve(import.meta.dirname, "..");
const [out, mapPath, browser] = process.argv.slice(2);
if (!out) throw new Error("usage: node tools/share-image.mjs <out.png> [map.json] [chromium path]");

const topo = JSON.parse(readFileSync(join(root, "packages/map/public/basemap/world-110m.json"), "utf8"));
const land = feature(topo, topo.objects.land);
const projection = geoEqualEarth().fitExtent([[430, 40], [1170, 590]], { type: "Sphere" });
const path = geoPath(projection);

const map = mapPath ? JSON.parse(readFileSync(mapPath, "utf8")) : null;
const word = map?.telegram?.word ?? null;
const dateOf = (runDate) => new Date(`${runDate}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

// The day's places, or every outlet's city. One dot per point, whatever it holds: dots are never ranked here.
const points = map
  ? map.places.map((p) => [p.lon, p.lat])
  : parse(readFileSync(join(root, "config/sources.yaml"), "utf8")).sources.filter((s) => s.desk === "world" && s.place).map((s) => [s.place.lon, s.place.lat]);
const seen = new Set();
const dots = [];
for (const [lon, lat] of points) {
  const key = `${lat.toFixed(1)},${lon.toFixed(1)}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const xy = projection([lon, lat]);
  if (xy) dots.push(xy);
}

// Dots shrink as a day's places grow, so a busy day stays a map and never a blot.
const dotR = dots.length > 4000 ? 1 : dots.length > 1500 ? 1.5 : 2.2;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const font = (pkg, file) => `file://${join(root, "node_modules/@fontsource", pkg, "files", file)}`;
// The word's size follows its length, so every word on the lists fits, as on the site.
const wordSize = word ? Math.min(92, Math.floor(620 / Math.max(4, word.length))) : 0;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><pattern id="ht" width="4" height="4" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="0.7" fill="rgba(21,21,21,0.28)"/></pattern></defs>
<path d="${path({ type: "Sphere" })}" fill="#f6f3ea" stroke="#151515" stroke-width="1.2"/>
<path d="${path(land)}" fill="#e6e0d0" stroke="#151515" stroke-width="0.8"/>
<path d="${path(land)}" fill="url(#ht)"/>
${dots.map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${dotR}" fill="#151515"/>`).join("")}
</svg>`;

const brand = word
  ? `<h1 class="small">GlobalGist</h1><div class="rule"></div><p class="date">${esc(dateOf(map.telegram.runDate))}</p><p class="word" style="font-size:${wordSize}px">${esc(word)}</p><p class="line">Chosen by AI, weighing the day's news, good and bad.</p>`
  : `<h1>GlobalGist</h1><div class="rule"></div><p class="tag">One World. One Word.</p><p class="line">The day's news on a map, placed where it happened.</p>`;

const html = `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:Mast;src:url(${font("unifrakturmaguntia", "unifrakturmaguntia-latin-400-normal.woff2")})}
@font-face{font-family:Old;src:url(${font("old-standard-tt", "old-standard-tt-latin-400-normal.woff2")})}
@font-face{font-family:Old;font-weight:700;src:url(${font("old-standard-tt", "old-standard-tt-latin-700-normal.woff2")})}
@font-face{font-family:Old;font-style:italic;src:url(${font("old-standard-tt", "old-standard-tt-latin-400-italic.woff2")})}
html,body{margin:0;width:${W}px;height:${H}px;background:#efe9da;overflow:hidden}
.map{position:absolute;inset:0}
.brand{position:absolute;left:56px;top:0;bottom:0;width:380px;display:flex;flex-direction:column;justify-content:center;color:#151515}
h1{font-family:Mast;font-weight:400;font-size:82px;line-height:1;margin:0 0 18px}
h1.small{font-size:48px;margin-bottom:14px}
.rule{height:2px;background:#151515;margin:0 0 16px;width:300px}
.tag{font-family:Old;font-size:30px;margin:0 0 22px}
.date{font-family:Old;font-size:20px;letter-spacing:0.08em;text-transform:uppercase;margin:0 0 6px;color:#3d3a33}
.word{font-family:Mast;line-height:1.05;margin:0 0 14px;overflow-wrap:anywhere}
.line{font-family:Old;font-style:italic;font-size:21px;line-height:1.35;color:#3d3a33;margin:0}
</style><div class="map">${svg}</div><div class="brand">${brand}</div>`;

const dir = mkdtempSync(join(tmpdir(), "share-"));
writeFileSync(join(dir, "share.html"), html);
const b = await chromium.launch({ executablePath: browser || process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const page = await b.newPage({ viewport: { width: W, height: H } });
await page.goto(`file://${join(dir, "share.html")}`);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: out });
await b.close();
console.log(`${out}: ${word ? `the word "${word}" for ${map.telegram.runDate}` : "the outlets' cities"}, ${dots.length} dots`);
