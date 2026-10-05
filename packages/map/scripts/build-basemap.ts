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
 *   public/basemap/10m/<cell>.json  Natural Earth 10m land, ice, lakes and rivers of one 10 degree cell ("30N_10E"),
 *                                   loaded only for the cells in view at the closest zooms; index.json lists the cells
 *
 * `npm run map:basemap` builds everything; `npm run map:basemap -- 10m` only the 10m cells, `-- world` only the rest.
 * ne_10m_land already holds the minor islands (2,763 of ne_10m_minor_islands' 2,795 polygons are copies of polygons in
 * it), so that layer is not used.
 */
import { mkdir, readFile, writeFile, access, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { geoContains, geoBounds } from "d3-geo";
import { topology } from "topojson-server";
import { presimplify, simplify, quantile, sphericalTriangleArea } from "topojson-simplify";
import { quantize, feature } from "topojson-client";
import type { Feature, FeatureCollection, Geometry, Position } from "geojson";
import type { GeometryCollection, Topology } from "topojson-specification";
import { CELL, COLS, ROWS, cellKey, cellId, splitLayers, type Piece } from "../src/map/cells.ts";

const NE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson";
const CACHE = ".cache/ne";
const OUT = "public/basemap";
const OUT10 = join(OUT, "10m");

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

async function buildWorld() {
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

/**
 * One layer thinned once, for the whole world, before it is cut into cells: thinning inside a cell would take out the
 * points along the cut edges, which keep the two sides of a border the same. `weight` is the smallest triangle (in
 * steradians; 1e-10 is about 4,000 square metres) a point may span and stay.
 */
function thin(fc: FeatureCollection, weight: number): FeatureCollection {
  const topo = simplify(presimplify(topology({ o: fc }) as unknown as Parameters<typeof presimplify>[0], sphericalTriangleArea), weight);
  return feature(topo as unknown as Topology, (topo as unknown as Topology).objects.o as GeometryCollection) as FeatureCollection;
}

/**
 * A ring round a pole (Antarctica) is closed in the data by points on the pole's own parallel, a 360 degree edge from
 * the antimeridian's one side to its other. They are the same point to the sphere, so thinning takes them out as no
 * triangle at all, and the ring is then not closed on the flat map the clipping works on. Put them back.
 */
function withPoles(fc: FeatureCollection): FeatureCollection {
  const fix = (ring: Position[]): Position[] => {
    const out: Position[] = [ring[0]!];
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1]!;
      const b = ring[i]!;
      if (Math.abs(b[0]! - a[0]!) > 180) {
        const pole = a[1]! < 0 ? -90 : 90;
        out.push([a[0]!, pole], [b[0]!, pole]);
      }
      out.push(b);
    }
    return out;
  };
  const polygon = (rings: Position[][]) => rings.map(fix);
  return {
    type: "FeatureCollection",
    features: fc.features.map((f) => {
      const g = f.geometry;
      if (g.type === "Polygon") return { ...f, geometry: { ...g, coordinates: polygon(g.coordinates) } };
      if (g.type === "MultiPolygon") return { ...f, geometry: { ...g, coordinates: g.coordinates.map(polygon) } };
      return f;
    }),
  };
}

/** Quantization steps across a cell. One more than a power of two, so a step is an exact binary fraction of a degree. */
const Q = Number(process.env.Q10 ?? 4097);

function tileTopology(piece: Piece, col: number, row: number): Topology {
  const fc = (features: Feature[]): FeatureCollection => ({ type: "FeatureCollection", features });
  const objects: Record<string, FeatureCollection> = {};
  if (piece.land.length) objects.land = fc([{ type: "Feature", properties: {}, geometry: { type: "MultiPolygon", coordinates: piece.land } }]);
  if (piece.ice.length) objects.ice = fc([{ type: "Feature", properties: {}, geometry: { type: "MultiPolygon", coordinates: piece.ice } }]);
  if (piece.lakes.length)
    objects.lakes = fc(
      piece.lakes.map((l) => ({ type: "Feature", id: l.id, properties: {}, geometry: { type: "MultiPolygon", coordinates: l.rings } }) as Feature),
    );
  if (piece.rivers.length)
    objects.rivers = fc(piece.rivers.map((r) => ({ type: "Feature", properties: { r: r.r }, geometry: { type: "MultiLineString", coordinates: r.lines } })));
  const step = CELL / (Q - 1);
  return quantize(topology(objects) as unknown as Topology<{}>, {
    scale: [step, step],
    translate: [-180 + col * CELL, -90 + row * CELL],
  } as never) as Topology;
}

async function build10m() {
  await mkdir(OUT10, { recursive: true });
  const [land, lakes, rivers, glaciers, shelves] = await Promise.all([
    load("ne_10m_land"),
    load("ne_10m_lakes"),
    load("ne_10m_rivers_lake_centerlines"),
    load("ne_10m_glaciated_areas"),
    load("ne_10m_antarctic_ice_shelves_polys"),
  ]);
  const wLand = Number(process.env.W_LAND ?? 3e-8);
  const wIce = Number(process.env.W_ICE ?? 1e-7);
  const wLake = Number(process.env.W_LAKE ?? 1e-8);
  const wRiver = Number(process.env.W_RIVER ?? 5e-8);
  // The view draws no river past rank 9.
  const ranked = (fc: FeatureCollection): FeatureCollection => ({
    type: "FeatureCollection",
    features: fc.features.filter((f) => Number(f.properties?.scalerank ?? 9) <= 9),
  });
  const pieces = splitLayers({
    land: withPoles(thin(strip(land), wLand)),
    ice: withPoles(thin(strip({ type: "FeatureCollection", features: [...glaciers.features, ...shelves.features] }), wIce)),
    lakes: thin(strip(lakes), wLake),
    rivers: thin(strip(ranked(rivers), true), wRiver),
  } as never);
  for (const f of (await readdir(OUT10)).filter((n) => n.endsWith(".json"))) await rm(join(OUT10, f));
  const keys: string[] = [];
  let bytes = 0;
  for (let row = 0; row < ROWS; row++)
    for (let col = 0; col < COLS; col++) {
      const piece = pieces.get(cellId({ col, row }));
      if (!piece || (!piece.land.length && !piece.ice.length)) continue;
      const key = cellKey({ col, row });
      const text = JSON.stringify(tileTopology(piece, col, row));
      await writeFile(join(OUT10, `${key}.json`), text);
      bytes += text.length;
      keys.push(key);
    }
  await writeFile(join(OUT10, "index.json"), JSON.stringify({ deg: CELL, q: Q, tiles: keys }));
  console.log(`10m: ${keys.length} cells, ${(bytes / 1e6).toFixed(2)} MB`);
}

async function main() {
  const what = process.argv[2] ?? "all";
  if (what === "all" || what === "world") await buildWorld();
  if (what === "all" || what === "10m") await build10m();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
