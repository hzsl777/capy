// Builds data/towns.txt, the list of towns that GDELT's local stories are checked against (decisions 67 and 78),
// from GeoNames (geonames.org, CC BY 4.0): its cities1000 list, every place of 1,000 people or more and every seat of
// a local government down to the third administrative level, however small. Run with `npm run towns:build`.
//
// GeoNames' own download host changes its files daily, so the build reads the copy packaged in geonamescache 3.0.2
// on PyPI (July 2026), pinned by its checksum: the same input always gives the same file. Pass a path to a copy of
// that wheel to build without the network. Tests never run this; they read the committed file.
//
// Each town gets a first-level region named the way the city list names it (data/places.json, Natural Earth), so
// the daily coverage count and the local stage's regions stay the ones decision 46 counts. A GeoNames region code
// takes the Natural Earth region most listed cities inside it carry, when at least three quarters of them agree.
// Otherwise the town takes the region of the nearest listed city in its country. Neither the country nor the region
// is ever shown on the site.
//
// Output, compact because it is committed (decision 78): a line "=CC<tab>Region" starts a country and region, and
// each line after it is one town of it: the name, then its latitude and longitude in hundredths of a degree, each
// counted from the town on the line before (from zero at the block's first town). Towns in a block run south to
// north. A town already on the city list (same name and country within 30 km) is left out: the list's entry wins.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import { km, norm } from "../src/places.js";

const WHEEL = "https://files.pythonhosted.org/packages/48/c2/52f1b29de8839b4b55cd2641dfd722a6a94953d74fa82514e26084a92318/geonamescache-3.0.2-py3-none-any.whl";
const SHA256 = "b830e8942f2d58c7e68782dcf4dff2ffe8c4104a35ee881ed1ad4023cefcdba4";
const MEMBER = "geonamescache/data/cities1000.json";
const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
/** A town this close to a listed city of the same name and country is that city. */
const SAME_KM = 30;
/** A listed city this close to a town is taken as inside the town's GeoNames region, for the vote. */
const VOTE_KM = 15;
const AGREE = 0.75;

type City = [name: string, cc: string, lat: number, lon: number, pop: number, alts: string[], region?: string];
type Town = { geonameid: number; name: string; latitude: number; longitude: number; countrycode: string; population: number; admin1code: string };

const local = process.argv[2];
const bytes = local ? new Uint8Array(await readFile(local)) : new Uint8Array(await (await fetch(WHEEL)).arrayBuffer());
const sum = createHash("sha256").update(bytes).digest("hex");
if (sum !== SHA256) throw new Error(`geonamescache wheel: checksum ${sum}, expected ${SHA256}`);
const file = unzipSync(bytes, { filter: (f) => f.name === MEMBER })[MEMBER];
if (!file) throw new Error(`${MEMBER} is not in the wheel`);
const towns = Object.values(JSON.parse(new TextDecoder().decode(file)) as Record<string, Town>).sort((a, b) => a.geonameid - b.geonameid);
const cities = JSON.parse(await readFile(join(DATA, "places.json"), "utf8")) as City[];

// A coarse grid over the listed cities, for "the nearest listed city" below.
const CELL = 2;
/** Grid column, wrapped at the date line. */
const col = (x: number) => ((((x + 90) % 180) + 180) % 180) - 90;
const grid = new Map<string, City[]>();
for (const c of cities) {
  const k = `${Math.floor(c[2] / CELL)},${Math.floor(c[3] / CELL)}`;
  grid.set(k, [...(grid.get(k) ?? []), c]);
}
function nearestCity(lat: number, lon: number, maxKm: number, ok: (c: City) => boolean): City | null {
  const [cy, cx] = [Math.floor(lat / CELL), Math.floor(lon / CELL)];
  const reach = Math.ceil(maxKm / (111 * CELL * Math.max(Math.cos((Math.min(80, Math.abs(lat)) * Math.PI) / 180), 0.15))) + 1;
  let best: City | null = null;
  let bestKm = maxKm;
  for (let y = cy - reach; y <= cy + reach; y++)
    for (let x = cx - reach; x <= cx + reach; x++)
      for (const c of grid.get(`${y},${col(x)}`) ?? []) {
        if (!ok(c)) continue;
        const d = km(lat, lon, c[2], c[3]);
        if (d < bestKm) [best, bestKm] = [c, d];
      }
  return best;
}

// The vote: each listed city with a region says which region the GeoNames town nearest it belongs to.
const townGrid = new Map<string, Town[]>();
for (const t of towns) {
  const k = `${Math.floor(t.latitude / CELL)},${Math.floor(t.longitude / CELL)}`;
  townGrid.set(k, [...(townGrid.get(k) ?? []), t]);
}
const votes = new Map<string, Map<string, number>>();
for (const c of cities) {
  if (!c[1] || !c[6]) continue;
  const [cy, cx] = [Math.floor(c[2] / CELL), Math.floor(c[3] / CELL)];
  let best: Town | null = null;
  let bestKm = VOTE_KM;
  for (let y = cy - 1; y <= cy + 1; y++)
    for (let x = cx - 1; x <= cx + 1; x++)
      for (const t of townGrid.get(`${y},${col(x)}`) ?? []) {
        if (t.countrycode !== c[1]) continue;
        const d = km(c[2], c[3], t.latitude, t.longitude);
        if (d < bestKm) [best, bestKm] = [t, d];
      }
  if (!best || !best.admin1code || best.admin1code === "00") continue;
  const key = `${best.countrycode}.${best.admin1code}`;
  const tally = votes.get(key) ?? new Map<string, number>();
  tally.set(c[6], (tally.get(c[6]) ?? 0) + 1);
  votes.set(key, tally);
}
const regionOfCode = new Map<string, string>();
for (const [key, tally] of votes) {
  const total = [...tally.values()].reduce((a, b) => a + b, 0);
  const [region, n] = [...tally].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]!;
  if (n / total >= AGREE) regionOfCode.set(key, region);
}

const listed = new Map<string, City[]>();
for (const c of cities) {
  const k = `${norm(c[0])}|${c[1]}`;
  listed.set(k, [...(listed.get(k) ?? []), c]);
}
let byVote = 0;
let byNearest = 0;
let dropped = 0;
/** Towns by "CC<tab>Region": name, latitude and longitude in hundredths of a degree. */
const blocks = new Map<string, [string, number, number][]>();
let count = 0;
for (const t of towns) {
  const name = t.name.replace(/\s+/g, " ").trim().replace(/^[=#]+/, "");
  if (!name || !t.countrycode) continue;
  if ((listed.get(`${norm(name)}|${t.countrycode}`) ?? []).some((c) => km(c[2], c[3], t.latitude, t.longitude) <= SAME_KM)) {
    dropped += 1;
    continue;
  }
  let region = regionOfCode.get(`${t.countrycode}.${t.admin1code}`);
  if (region) byVote += 1;
  else {
    region = nearestCity(t.latitude, t.longitude, 300, (c) => c[1] === t.countrycode && !!c[6])?.[6] ?? "";
    if (region) byNearest += 1;
  }
  const key = `${t.countrycode}\t${region}`;
  const block = blocks.get(key) ?? [];
  block.push([name, Math.round(t.latitude * 100), Math.round(t.longitude * 100)]);
  blocks.set(key, block);
  count += 1;
}
// South to north within each block, so the differences between lines stay small.
const lines = [
  "# GeoNames' cities1000 (geonames.org, CC BY 4.0), from geonamescache 3.0.2. Built by packages/pipeline/scripts/build-towns.ts; do not edit.",
  "# \"=CC<tab>Region\" starts a country and its Natural Earth region. Each town: name<tab>latitude<tab>longitude, in hundredths of a degree, each counted from the line before.",
];
for (const key of [...blocks.keys()].sort()) {
  lines.push(`=${key}`);
  let [lat0, lon0] = [0, 0];
  for (const [name, lat, lon] of blocks.get(key)!.sort((a, b) => a[1] - b[1] || a[2] - b[2] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    lines.push(`${name}\t${lat - lat0}\t${lon - lon0}`);
    [lat0, lon0] = [lat, lon];
  }
}
await writeFile(join(DATA, "towns.txt"), `${lines.join("\n")}\n`);
console.log(`towns.txt: ${count} towns (${dropped} already on the city list), region by GeoNames code ${byVote}, by nearest listed city ${byNearest}, none ${count - byVote - byNearest}`);
