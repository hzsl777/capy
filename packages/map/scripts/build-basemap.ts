/**
 * Builds the physical basemap from Natural Earth (public domain).
 *
 * Only physical geography goes in: land, lakes, rivers, ice, and relief marks
 * sampled from mountain-range and desert polygons. Every name and property is
 * stripped, and no political boundary layer is ever downloaded. See AGENTS.md
 * "Neutrality rules" before changing what this script includes.
 *
 * Output (committed, so builds need no network):
 *   public/basemap/world-110m.json  TopoJSON for the whole world on screen
 *   public/basemap/world-50m.json   TopoJSON once zoomed in (decision 42)
 *   public/basemap/relief.json      { peaks: [lon, lat][], dunes: [lon, lat][] }
 */
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { geoContains, geoBounds } from "d3-geo";
import { topology } from "topojson-server";
import { presimplify, simplify, quantile } from "topojson-simplify";
import { quantize } from "topojson-client";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { Topology } from "topojson-specification";

const NE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson";
const CACHE = ".cache/ne";
const OUT = "public/basemap";

async function load(name: string): Promise<FeatureCollection> {
  const path = join(CACHE, `${name}.geojson`);
  try {
    await access(path);
  } catch {
    await mkdir(CACHE, { recursive: true });
    const res = await fetch(`${NE}/${name}.geojson`);
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    await writeFile(path, await res.text());
  }
  return JSON.parse(await readFile(path, "utf8"));
}

/** Drop every property (names, labels, codes). Optionally keep a numeric rank. */
function strip(fc: FeatureCollection, keepRank = false): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: fc.features.map((f) => ({
      type: "Feature",
      properties: keepRank ? { r: Number(f.properties?.scalerank ?? 9) } : {},
      geometry: f.geometry,
    })),
  };
}

function build(objects: Record<string, FeatureCollection>, quant: number, keep: number) {
  let topo = presimplify(topology(objects) as unknown as Parameters<typeof presimplify>[0]);
  topo = simplify(topo, quantile(topo, keep));
  return quantize(topo as Topology<{}>, quant);
}

/** Deterministic 0..1 hash so relief marks don't move between builds. */
function hash(a: number, b: number): number {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function sample(features: Feature[], step: number): [number, number][] {
  const out: [number, number][] = [];
  for (const f of features) {
    const [[w, s], [e, n]] = geoBounds(f as Feature<Geometry>);
    const east = e < w ? e + 360 : e; // antimeridian crossing
    for (let lat = Math.floor(s / step) * step; lat <= n; lat += step) {
      const lonStep = step / Math.max(0.35, Math.cos((lat * Math.PI) / 180));
      for (let lon = Math.floor(w / lonStep) * lonStep; lon <= east; lon += lonStep) {
        const jx = (hash(lon, lat) - 0.5) * lonStep * 0.8;
        const jy = (hash(lat, lon) - 0.5) * step * 0.8;
        let x = lon + jx;
        if (x > 180) x -= 360;
        const p: [number, number] = [x, lat + jy];
        if (geoContains(f, p)) out.push([+p[0].toFixed(2), +p[1].toFixed(2)]);
      }
    }
  }
  return out;
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const [land110, lakes110, rivers110, glaciers110, land50, lakes50, rivers50, regions, glaciers, shelves] =
    await Promise.all([
      load("ne_110m_land"),
      load("ne_110m_lakes"),
      load("ne_110m_rivers_lake_centerlines"),
      load("ne_110m_glaciated_areas"),
      load("ne_50m_land"),
      load("ne_50m_lakes"),
      load("ne_50m_rivers_lake_centerlines"),
      load("ne_50m_geography_regions_polys"),
      load("ne_50m_glaciated_areas"),
      load("ne_50m_antarctic_ice_shelves_polys"),
    ]);

  const low = build(
    { land: strip(land110), lakes: strip(lakes110), rivers: strip(rivers110, true), ice: strip(glaciers110) },
    1e4,
    0.6,
  );
  const high = build(
    {
      land: strip(land50),
      lakes: strip(lakes50),
      rivers: strip(rivers50, true),
      ice: strip({ type: "FeatureCollection", features: [...glaciers.features, ...shelves.features] }),
    },
    5e4,
    0.18,
  );

  const cls = (c: string) =>
    regions.features.filter((f) => (f.properties?.FEATURECLA ?? f.properties?.featurecla) === c);
  const relief = {
    peaks: sample(cls("Range/mtn"), 1.1),
    dunes: sample(cls("Desert"), 1.3),
  };

  await writeFile(join(OUT, "world-110m.json"), JSON.stringify(low));
  await writeFile(join(OUT, "world-50m.json"), JSON.stringify(high));
  await writeFile(join(OUT, "relief.json"), JSON.stringify(relief));
  console.log(`peaks=${relief.peaks.length} dunes=${relief.dunes.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
