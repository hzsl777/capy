// The pictures that tell Frog Pond, Arcadia and Lasso apart (decision 69) sit in open water. Each is drawn as wide
// as the open water around its spot, so the whole circle must be clear of land and far from every place.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { geoContains, geoDistance } from "d3-geo";
import type { FeatureCollection } from "geojson";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import { describe, expect, it } from "vitest";
import { POND, REEF, ROPE, TEA } from "../src/map/scenery.ts";
import { samplePlaces } from "./sample.ts";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const RAD = Math.PI / 180;

function land(file: string): FeatureCollection {
  const topo = JSON.parse(readFileSync(here(`../public/basemap/${file}`), "utf8")) as Topology;
  return feature(topo, topo.objects.land as GeometryCollection) as FeatureCollection;
}

function places(): [number, number][] {
  const yaml = readFileSync(here("../../../config/sources.yaml"), "utf8");
  const out: [number, number][] = [...yaml.matchAll(/lat:\s*(-?[\d.]+),\s*lon:\s*(-?[\d.]+)/g)].map((m) => [Number(m[2]), Number(m[1])]);
  for (const p of samplePlaces()) out.push([p.lon, p.lat]);
  return out;
}

function ring(lon: number, lat: number, deg: number): [number, number][] {
  const pts: [number, number][] = [[lon, lat]];
  for (const f of [0.5, 1]) {
    for (let a = 0; a < 360; a += 20) {
      const dLat = f * deg * Math.cos(a * RAD);
      const dLon = (f * deg * Math.sin(a * RAD)) / Math.cos((lat + dLat) * RAD);
      pts.push([lon + dLon, lat + dLat]);
    }
  }
  return pts;
}

describe("scenery", () => {
  const all = places();
  const spots = [...POND, ...ROPE, ...TEA, ...REEF];

  for (const file of ["world-110m.json", "world-50m.json"]) {
    it(`keeps every picture's whole circle off land (${file})`, () => {
      const l = land(file);
      for (const s of spots) {
        for (const p of ring(s.lon, s.lat, s.r)) expect(geoContains(l, p), `${s.kind} at ${s.lat},${s.lon}`).toBe(false);
      }
      // The detailed coastline takes a few seconds, more when every package's tests run at once.
    }, 60_000);
  }

  it("keeps every picture at least 3 degrees clear of every place", () => {
    for (const s of spots) {
      const nearest = Math.min(...all.map((p) => geoDistance(p, [s.lon, s.lat]) / RAD));
      expect(nearest - s.r, `${s.kind} at ${s.lat},${s.lon}`).toBeGreaterThan(3);
    }
  });
});
