import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { FeatureCollection } from "geojson";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import { geoContains } from "d3-geo";
import { cellKey, cellOf } from "../src/map/cells.ts";
import { decodePiece } from "../src/map/detail.ts";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/** What the tests that keep drawings clear of land read: the light and the 50m basemap, and "10m", the detailed cells. */
export const BASEMAPS = ["world-110m.json", "world-50m.json", "10m"];

let tiles: FeatureCollection | undefined;
/** Each cell's land by cell name, so a point is tried against its own cell alone. */
const byCell = new WeakMap<FeatureCollection, Map<string, FeatureCollection>>();

/** The land of every 10m cell, one feature per cell (the cells' own borders are inside land, never in open water). */
function land10m(): FeatureCollection {
  if (tiles) return tiles;
  const index = JSON.parse(readFileSync(here("../public/basemap/10m/index.json"), "utf8")) as { tiles: string[] };
  const cells = new Map<string, FeatureCollection>();
  const features = index.tiles.map((key) => {
    const piece = decodePiece(JSON.parse(readFileSync(here(`../public/basemap/10m/${key}.json`), "utf8")) as Topology);
    const f = { type: "Feature" as const, properties: {}, geometry: { type: "MultiPolygon" as const, coordinates: piece.land } };
    cells.set(key, { type: "FeatureCollection", features: [f] });
    return f;
  });
  tiles = { type: "FeatureCollection", features };
  byCell.set(tiles, cells);
  return tiles;
}

/** The land of one basemap by its file name, or of the 10m cells together. */
export function landOf(file: string): FeatureCollection {
  if (file === "10m") return land10m();
  const topo = JSON.parse(readFileSync(here(`../public/basemap/${file}`), "utf8")) as Topology;
  return feature(topo, topo.objects.land as GeometryCollection) as FeatureCollection;
}

/**
 * Whether a point [lon, lat] is on the land. The 10m cells' land is cut at the cells' borders, so a point can only be in
 * its own cell's polygons, and that is all it is tried against (all of them at once takes a minute for a test's circles).
 */
export function inLand(land: FeatureCollection, p: [number, number]): boolean {
  const cells = byCell.get(land);
  if (!cells) return geoContains(land, p);
  const own = cells.get(cellKey(cellOf(p[0], p[1])));
  return own ? geoContains(own, p) : false;
}
