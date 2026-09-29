// Builds data/places.json, the fixed list of world cities that stories are placed at (decision 44), from Natural
// Earth's populated places (public domain). Run with `npm run places:build` when Natural Earth updates.
// Each row: [name, country code, lat, lon, population, alternate names, first-level region]. The country code
// tells same-named cities apart, and the country and region count coverage in the daily summary (decision 46).
// Neither is ever shown on the site.
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const URL_NE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places_simple.geojson";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "places.json");

type Props = { name: string; nameascii?: string; namealt?: string | null; iso_a2?: string; adm1name?: string | null; latitude: number; longitude: number; pop_max?: number };

const res = await fetch(URL_NE);
if (!res.ok) throw new Error(`${URL_NE}: HTTP ${res.status}`);
const geo = (await res.json()) as { features: { properties: Props }[] };
const round = (n: number) => Math.round(n * 1000) / 1000;
const rows = geo.features.map(({ properties: p }) => {
  const alts = [...new Set([p.nameascii, ...(p.namealt ?? "").split("|")].map((s) => (s ?? "").trim()).filter((s) => s && s !== p.name))];
  return [p.name, p.iso_a2 && p.iso_a2 !== "-99" ? p.iso_a2 : "", round(p.latitude), round(p.longitude), p.pop_max ?? 0, alts, p.adm1name ?? ""] as const;
});
rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : b[4] - a[4]));
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, `[\n${rows.map((r) => JSON.stringify(r)).join(",\n")}\n]\n`);
console.log(`${OUT}: ${rows.length} places`);
