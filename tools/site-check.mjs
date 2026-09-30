// Checks the live site from outside: the page, its headers, the day's map file and one tile, a few paths that must
// 404, and the page itself in a real browser at desktop and phone width (console errors, failed requests,
// screenshots). Usage: node tools/site-check.mjs <site url> [chrome path] [out dir]. Exits 1 on any failure.
import { mkdirSync, writeFileSync } from "node:fs";

const site = (process.argv[2] ?? "").replace(/\/$/, "");
const chrome = process.argv[3];
const out = process.argv[4] ?? "site-check";
if (!/^https:\/\//.test(site)) {
  console.error("Usage: node tools/site-check.mjs https://<site> [chrome] [out]");
  process.exit(2);
}
mkdirSync(out, { recursive: true });
const failures = [];
const warnings = [];
const lines = [];
const log = (s) => { lines.push(s); console.log(s); };
const fail = (s) => { failures.push(s); log(`FAIL ${s}`); };
const warn = (s) => { warnings.push(s); log(`WARN ${s}`); };

async function get(path, init) {
  const t = Date.now();
  const res = await fetch(site + path, { redirect: "manual", ...init });
  const body = Buffer.from(await res.arrayBuffer());
  log(`${res.status} ${path} ${body.length} bytes ${Date.now() - t} ms ${res.headers.get("content-type") ?? ""} ${res.headers.get("content-encoding") ?? ""}`);
  return { res, body };
}

const page = await get("/", { headers: { "accept-encoding": "gzip, br" } });
if (page.res.status !== 200) fail(`/ answered ${page.res.status}`);
for (const h of ["content-security-policy", "x-content-type-options", "referrer-policy", "x-frame-options", "strict-transport-security", "permissions-policy", "cache-control", "x-robots-tag"]) {
  log(`  ${h}: ${page.res.headers.get(h) ?? "(none)"}`);
}
for (const h of ["content-security-policy", "x-content-type-options", "referrer-policy", "strict-transport-security"]) if (!page.res.headers.get(h)) fail(`/ has no ${h}`);
if (/noindex/i.test(page.res.headers.get("x-robots-tag") ?? "")) fail("the production page says noindex");

const latest = await get("/data/latest.json", { headers: { "accept-encoding": "gzip, br" } });
let map = null;
if (latest.res.status !== 200) fail(`/data/latest.json answered ${latest.res.status}`);
else {
  try { map = JSON.parse(latest.body.toString("utf8")); } catch { fail("/data/latest.json is not JSON"); }
}
if (map) {
  const age = Date.now() / 1000 - map.generatedAt;
  const tiles = Object.entries(map.local?.tiles ?? {});
  const localCount = tiles.reduce((n, [, c]) => n + c, 0);
  log(`  source ${map.source}, day ${map.runDate}, generated ${new Date(map.generatedAt * 1000).toISOString()} (${(age / 3600).toFixed(1)} h ago)`);
  log(`  word: ${map.telegram ? `${map.telegram.word} (${map.telegram.runDate}, band ${map.telegram.band})` : "none"}`);
  log(`  places ${map.places.length}, outlet stories ${map.items.length}, events ${Object.keys(map.events).length}, tiles ${tiles.length}, local stories ${localCount}`);
  log(`  cache-control: ${latest.res.headers.get("cache-control")}`);
  if (map.source !== "live") fail(`latest.json is ${map.source}, not live`);
  if (age > 30 * 3600) fail(`latest.json is ${(age / 3600).toFixed(0)} hours old`);
  if (!map.telegram) warn("no word in latest.json");
  if (map.items.length === 0) fail("latest.json has no outlet stories");
  if (tiles.length === 0) warn("latest.json lists no tiles of local stories");
  const bad = map.items.filter((i) => typeof i.url === "string" && !/^https?:\/\//.test(i.url));
  if (bad.length) fail(`${bad.length} stories with a link that is not http(s), first: ${bad[0].url}`);
  if (tiles.length) {
    const [key] = tiles.sort((a, b) => b[1] - a[1])[0];
    const base = new URL(map.local.base, `${site}/data/`).pathname;
    const tile = await get(`${base}${key}.json`, { headers: { "accept-encoding": "gzip, br" } });
    if (tile.res.status !== 200) fail(`tile ${key} answered ${tile.res.status}`);
    else {
      const t = JSON.parse(tile.body.toString("utf8"));
      log(`  tile ${key}: ${t.places.length} places, ${t.items.length} stories`);
      const badT = t.items.filter((i) => typeof i.url === "string" && !/^https?:\/\//.test(i.url));
      if (badT.length) fail(`${badT.length} tile stories with a non-http(s) link`);
    }
  }
}

for (const path of ["/data/2026-13-45.json", "/data/..%2F..%2Fetc%2Fpasswd", "/data/local/2026-09-30/..%2F..%2Flatest.json", "/data/local/2026-09-30/999N_999E.json", "/wp-login.php", "/.env", "/.git/config"]) {
  const r = await get(path);
  if (r.res.status === 200 && /json|text\/plain/.test(r.res.headers.get("content-type") ?? "") && path !== "/wp-login.php") fail(`${path} answered 200`);
  if (/DATABASE_URL|postgres(ql)?:\/\/|at .+\.ts:\d+/.test(r.body.toString("utf8"))) fail(`${path} leaks internals`);
}
await get("/robots.txt");

if (chrome) {
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ executablePath: chrome });
  for (const [name, viewport, mobile] of [["desktop", { width: 1440, height: 900 }, false], ["phone", { width: 390, height: 844 }, true]]) {
    const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
    const p = await ctx.newPage();
    const errors = [];
    p.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
    p.on("pageerror", (e) => errors.push(`page error: ${e.message}`));
    p.on("requestfailed", (r) => errors.push(`request failed: ${r.url()} ${r.failure()?.errorText}`));
    p.on("response", (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
    const t = Date.now();
    await p.goto(site + "/", { waitUntil: "networkidle", timeout: 60000 });
    log(`${name}: loaded in ${Date.now() - t} ms`);
    await p.waitForTimeout(4000);
    const scroll = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (scroll > 1) fail(`${name}: page scrolls sideways by ${scroll}px`);
    log(`${name}: title "${await p.title()}"`);
    await p.screenshot({ path: `${out}/${name}.png` });
    for (const e of errors) fail(`${name}: ${e}`);
    await ctx.close();
  }
  await browser.close();
}

log(`\n${failures.length} failures, ${warnings.length} warnings`);
writeFileSync(`${out}/report.txt`, lines.join("\n") + "\n");
process.exit(failures.length ? 1 : 0);
