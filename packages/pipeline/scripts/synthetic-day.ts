// A synthetic day of local stories at scale (decision 78), to measure what tens of thousands of towns cost: the local
// stage's placing and choosing, the read model, the split into the day's file and its tiles, and their sizes. No
// network: the fictional world day and made-up GDELT rows about real towns, in memory.
//
//   npx tsx packages/pipeline/scripts/synthetic-day.ts [stories, default 50000] [--out dir]
//
// With --out, writes the day's file as latest.json and its tiles into that folder (for example
// packages/map/public/data, to look at it with `npm run map:dev`). Nothing here is real news.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { toRunDate } from "@2dayai/core";
import { loadLocalTile, loadMapView, localBase } from "@2dayai/db";
import { coverageOf } from "../src/coverage.js";
import { runDay } from "../src/day.js";
import { gkgRow, gkgZip } from "../src/fixtures/gdelt.js";
import { worldAnswers, worldFeedFor, worldSourcesYaml } from "../src/fixtures/world.js";
import { FakeLlm } from "../src/llm/fake.js";
import { writeMapFiles } from "../src/map-files.js";
import { Gazetteer, parseTowns } from "../src/places.js";
import { runLocal } from "../src/stages/local.js";
import { testConfig } from "../src/test/config.js";
import { createTestDb } from "../src/test/db.js";

const args = process.argv.slice(2);
const target = Number(args.find((a) => /^\d+$/.test(a)) ?? 50_000);
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : undefined;
const date = toRunDate("2026-09-29");
const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "data");

let seed = 42;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const WORDS = ["council", "school", "market", "road", "water", "festival", "hospital", "police", "bridge", "farmers", "mayor", "budget", "library", "flood", "harvest", "clinic", "election", "transit", "museum", "workers", "river", "park", "housing", "court", "fire", "station", "port", "teachers", "power", "rain"];
const title = (town: string) => {
  const words = Array.from({ length: 8 + Math.floor(rand() * 6) }, () => WORDS[Math.floor(rand() * WORDS.length)]);
  return `${town} ${words.join(" ")}`.slice(0, 120);
};
const LANGS = [undefined, undefined, "spa", "fre", "ger", "ita", "por", "rus", "ara", "hin", "ind", "tur"];

// Towns from the lists, a few kilometres off their listed point as GDELT's own points are.
const towns = parseTowns(readFileSync(join(DATA, "towns.txt"), "utf8"));
const picked = new Set<number>();
const count = Math.round(target * 0.6);
while (picked.size < Math.min(count, towns.length)) picked.add(Math.floor(rand() * towns.length));
const chosen = [...picked].map((i) => towns[i]!);
// Two in three towns have three stories that day (one more than a town keeps), the rest one.
const rows: { row: string; translated: boolean; file: number }[] = [];
let n = 0;
for (const [i, [name, , lat, lon]] of chosen.entries()) {
  const stories = i % 3 === 2 ? 1 : 3;
  for (let k = 0; k < stories; k++) {
    const file = Math.floor(rand() * 96);
    const when = new Date(Date.UTC(2026, 8, 28, 9, 0, 0) + file * 900_000 + Math.floor(rand() * 900) * 1000);
    const lang = LANGS[Math.floor(rand() * LANGS.length)];
    const site = `news${Math.floor(rand() * 20_000)}`;
    const t = title(name);
    const slug = t.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60);
    const town = { name: `${name}, Region, Country`, lat: lat + (rand() - 0.5) * 0.02, lon: lon + (rand() - 0.5) * 0.02, id: `S${i}` };
    rows.push({ row: gkgRow({ url: `https://www.${site}.example/local/2026/09/29/${slug}-${n++}`, title: t, when: when.toISOString().replace(/[-:T]/g, "").slice(0, 14), towns: [town], lang }), translated: !!lang, file });
  }
}
const files = new Map<string, Uint8Array>();
for (let f = 0; f < 96; f++) {
  const stamp = new Date(Date.UTC(2026, 8, 28, 9, 0, 0) + f * 900_000).toISOString().replace(/[-:T]/g, "").slice(0, 14);
  files.set(`${stamp}.gkg.csv.zip`, gkgZip(rows.filter((r) => r.file === f && !r.translated).map((r) => r.row)));
  files.set(`${stamp}.translation.gkg.csv.zip`, gkgZip(rows.filter((r) => r.file === f && r.translated).map((r) => r.row)));
}
console.log(`synthetic GDELT day: ${rows.length} rows about ${chosen.length} towns in 192 files`);

const { db, close } = await createTestDb();
const dir = mkdtempSync(join(tmpdir(), "capy-synthetic-"));
writeFileSync(join(dir, "sources.yaml"), worldSourcesYaml());
await runDay(db, testConfig(), new FakeLlm(worldAnswers()), date, { fetchFeed: async (url) => worldFeedFor(url, date), fetchPage: async () => "", sourcesPath: join(dir, "sources.yaml"), readersDir: dir });

const ms = (t: number) => `${Math.round(performance.now() - t)} ms`;
let t = performance.now();
const gaz = Gazetteer.loadWithTowns();
console.log(`gazetteer: ${gaz.size()} places in ${ms(t)}`);
t = performance.now();
const report = await runLocal(db, date, { perTown: 2, max: 80_000 }, async (url) => files.get(url.split("/").pop()!) ?? null, gaz);
console.log(`local stage (unzip, parse, place, choose, insert into PGlite): ${ms(t)}`, JSON.stringify(report));
t = performance.now();
const full = await loadMapView(db, date);
console.log(`read model, whole day: ${full.items.length} items at ${full.places.length} places in ${ms(t)}`);
t = performance.now();
const coverage = coverageOf(full, gaz);
console.log(`coverage in ${ms(t)}: ${coverage.towns} towns, ${coverage.countries} countries, ${coverage.regions} regions`);
const target_dir = outDir ?? mkdtempSync(join(tmpdir(), "capy-synthetic-out-"));
mkdirSync(target_dir, { recursive: true });
t = performance.now();
const written = writeMapFiles(full, join(target_dir, "latest.json"), localBase(date));
console.log(`split and write: ${ms(t)}`);
const gz = (file: string) => gzipSync(readFileSync(file)).length;
const tileSizes = written.tiles.filter((x) => !x.key.endsWith("/names.json")).map((x) => ({ key: x.key, bytes: readFileSync(x.file).length, gz: gz(x.file) })).sort((a, b) => b.bytes - a.bytes);
const kb = (b: number) => `${(b / 1024).toFixed(0)} KB`;
console.log(`day's file: ${kb(written.bytes.main)} (${kb(gz(join(target_dir, "latest.json")))} gzipped)`);
console.log(`tiles: ${tileSizes.length}, ${kb(written.bytes.tiles)} in all (${kb(tileSizes.reduce((a, b) => a + b.gz, 0))} gzipped); largest ${tileSizes.slice(0, 5).map((x) => `${x.key.split("/").pop()} ${kb(x.bytes)} (${kb(x.gz)} gz)`).join(", ")}; median ${kb(tileSizes[Math.floor(tileSizes.length / 2)]!.bytes)}`);
const namesFile = written.tiles.find((x) => x.key.endsWith("/names.json"));
if (namesFile) console.log(`names index (the place search): ${kb(written.bytes.names)} (${kb(gz(namesFile.file))} gzipped), ${(JSON.parse(readFileSync(namesFile.file, "utf8")) as { places: unknown[] }).places.length} places`);
t = performance.now();
const indexed = await loadMapView(db, date, new Date(), { local: "index" });
console.log(`read model with the tile index only (the Worker's fallback): ${ms(t)}, ${Object.keys(indexed.local!.tiles).length} tiles`);
const biggest = tileSizes[0]!.key.split("/").pop()!.replace(".json", "");
t = performance.now();
const tile = await loadLocalTile(db, date, biggest);
console.log(`one tile from the database (${biggest}, ${tile!.items.length} stories): ${ms(t)}`);
await close();
