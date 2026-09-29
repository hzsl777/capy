import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { geoContains, geoDistance } from "d3-geo";
import type { FeatureCollection } from "geojson";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import { describe, expect, it } from "vitest";
import { CREATURES, STARS } from "../src/map/decor.ts";
import { THEMES } from "../src/themes.ts";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const RAD = Math.PI / 180;

function land(file: string): FeatureCollection {
  const topo = JSON.parse(readFileSync(here(`../public/basemap/${file}`), "utf8")) as Topology;
  return feature(topo, topo.objects.land as GeometryCollection) as FeatureCollection;
}

/** Every outlet's city on the world and briefing desks, and every place in the sample day. */
function places(): [number, number][] {
  const yaml = readFileSync(here("../../../config/sources.yaml"), "utf8");
  const out: [number, number][] = [...yaml.matchAll(/lat:\s*(-?[\d.]+),\s*lon:\s*(-?[\d.]+)/g)].map((m) => [Number(m[2]), Number(m[1])]);
  const sample = JSON.parse(readFileSync(here("../public/data/sample.json"), "utf8")) as { places: { lat: number; lon: number }[] };
  for (const p of sample.places) out.push([p.lon, p.lat]);
  return out;
}

/** Points on a small circle around a spot, so the whole drawing is checked and not only its centre. */
function ring(lon: number, lat: number, deg: number): [number, number][] {
  const pts: [number, number][] = [[lon, lat]];
  for (let a = 0; a < 360; a += 30) {
    const dLat = deg * Math.cos(a * RAD);
    const dLon = (deg * Math.sin(a * RAD)) / Math.cos((lat + dLat) * RAD);
    pts.push([lon + dLon, lat + dLat]);
  }
  return pts;
}

describe("sea creatures", () => {
  const all = places();

  it("reads the outlet list", () => {
    expect(all.length).toBeGreaterThan(50);
  });

  it("sit far from every outlet's city", () => {
    for (const c of CREATURES) {
      const nearest = Math.min(...all.map((p) => geoDistance(p, [c.lon, c.lat]) / RAD));
      expect(nearest, `${c.kind} at ${c.lat},${c.lon}`).toBeGreaterThan(14);
    }
  });

  it("sit in open ocean, clear of any land", () => {
    for (const file of ["world-110m.json", "world-50m.json"]) {
      const l = land(file);
      // The check itself works: an inland city is on land.
      expect(geoContains(l, [36.82, -1.29])).toBe(true);
      for (const c of CREATURES) {
        for (const pt of ring(c.lon, c.lat, 6)) expect(geoContains(l, pt), `${c.kind} at ${c.lat},${c.lon} (${file})`).toBe(false);
      }
    }
  }, 30_000);

  it("appear in the Pirate design only", () => {
    expect(Object.values(THEMES).filter((t) => t.decor === "sea").map((t) => t.id)).toEqual(["pirate"]);
  });
});

describe("star chart", () => {
  const all = places();

  it("keeps every star in open ocean, away from outlets' cities", () => {
    const l = land("world-50m.json");
    for (const [lon, lat] of STARS) {
      expect(Math.min(...all.map((p) => geoDistance(p, [lon, lat]) / RAD)), `star at ${lat},${lon}`).toBeGreaterThan(8);
      for (const pt of ring(lon, lat, 2)) expect(geoContains(l, pt), `star at ${lat},${lon}`).toBe(false);
    }
  }, 30_000);
});
