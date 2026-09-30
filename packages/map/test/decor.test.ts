import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { geoContains, geoDistance } from "d3-geo";
import type { FeatureCollection, Position } from "geojson";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import { describe, expect, it } from "vitest";
import { CANDIES, CREATURES, STARS, WAVE_FIELDS } from "../src/map/decor.ts";
import { THEMES } from "../src/themes.ts";
import { samplePlaces } from "./sample.ts";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const RAD = Math.PI / 180;
const FILES = ["world-110m.json", "world-50m.json"];

function land(file: string): FeatureCollection {
  const topo = JSON.parse(readFileSync(here(`../public/basemap/${file}`), "utf8")) as Topology;
  return feature(topo, topo.objects.land as GeometryCollection) as FeatureCollection;
}

/** Every coastline of both basemaps as points at most a quarter of a degree apart, so no stretch of coast is missed. */
function coastPoints(): [number, number][] {
  const out: [number, number][] = [];
  const ring = (r: Position[]) => {
    for (let i = 0; i + 1 < r.length; i++) {
      const [ax, ay] = r[i];
      const [bx, by] = r[i + 1];
      // An edge along the 180th meridian's cut is not a coast.
      if (Math.abs(bx - ax) > 180) continue;
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 0.25));
      for (let j = 0; j < n; j++) out.push([ax + ((bx - ax) * j) / n, ay + ((by - ay) * j) / n]);
    }
  };
  for (const file of FILES) {
    for (const f of land(file).features) {
      const g = f.geometry;
      if (g.type === "Polygon") g.coordinates.forEach(ring);
      else if (g.type === "MultiPolygon") g.coordinates.forEach((p) => p.forEach(ring));
    }
  }
  return out;
}

/** Every outlet's city on the world and briefing desks, and every place in the sample day. */
function places(): [number, number][] {
  const yaml = readFileSync(here("../../../config/sources.yaml"), "utf8");
  const out: [number, number][] = [...yaml.matchAll(/lat:\s*(-?[\d.]+),\s*lon:\s*(-?[\d.]+)/g)].map((m) => [Number(m[2]), Number(m[1])]);
  for (const p of samplePlaces()) out.push([p.lon, p.lat]);
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

const nearest = (pts: [number, number][], lon: number, lat: number) => Math.min(...pts.map((p) => geoDistance(p, [lon, lat]) / RAD));

/** The nearest point within `max` degrees, or `max` if none is closer. Points outside the latitude band are skipped. */
function nearestWithin(pts: [number, number][], lon: number, lat: number, max: number): number {
  let best = max;
  for (const p of pts) {
    if (Math.abs(p[1] - lat) >= best) continue;
    best = Math.min(best, geoDistance(p, [lon, lat]) / RAD);
  }
  return best;
}

describe("the Pirate sea", () => {
  const all = places();
  const coast = coastPoints();
  const lands = FILES.map(land);

  it("reads the outlet list and the coasts", () => {
    expect(all.length).toBeGreaterThan(50);
    expect(coast.length).toBeGreaterThan(10_000);
    // The check itself works: an inland city is on land.
    for (const l of lands) expect(geoContains(l, [36.82, -1.29])).toBe(true);
  });

  it("has a crowded sea: many drawings of many kinds", () => {
    expect(CREATURES.length).toBeGreaterThanOrEqual(15);
    expect(new Set(CREATURES.map((c) => c.kind)).size).toBeGreaterThanOrEqual(10);
  });

  it("keeps every drawing in open sea: no coast within its radius", () => {
    for (const c of CREATURES) {
      const at = `${c.kind} at ${c.lat},${c.lon}`;
      for (const l of lands) expect(geoContains(l, [c.lon, c.lat]), at).toBe(false);
      expect(nearestWithin(coast, c.lon, c.lat, c.r + 1), at).toBeGreaterThan(c.r);
    }
  }, 60_000);

  it("keeps every drawing 7 degrees beyond its radius from every outlet's city", () => {
    for (const c of CREATURES) expect(nearest(all, c.lon, c.lat), `${c.kind} at ${c.lat},${c.lon}`).toBeGreaterThan(c.r + 7);
  });

  it("never lets two drawings overlap", () => {
    for (const [i, a] of CREATURES.entries()) {
      for (const b of CREATURES.slice(i + 1)) {
        expect(geoDistance([a.lon, a.lat], [b.lon, b.lat]) / RAD, `${a.kind} and ${b.kind}`).toBeGreaterThan(a.r + b.r);
      }
    }
  });

  it("keeps every wave-mark area 1.5 degrees from any coast and 3 from every outlet's city", () => {
    expect(WAVE_FIELDS.length).toBeGreaterThan(50);
    for (const [lon, lat, r] of WAVE_FIELDS) {
      const at = `wave area at ${lat},${lon}`;
      for (const l of lands) expect(geoContains(l, [lon, lat]), at).toBe(false);
      expect(nearestWithin(coast, lon, lat, r + 2), at).toBeGreaterThan(r + 1.5);
      expect(nearest(all, lon, lat), at).toBeGreaterThan(r + 3);
    }
  }, 120_000);

  it("appears in the Pirate design only", () => {
    expect(Object.values(THEMES).filter((t) => t.decor === "sea").map((t) => t.id)).toEqual(["pirate"]);
  });
});

describe("Candy Shop sweets", () => {
  const all = places();

  it("sit far from every outlet's city", () => {
    for (const c of CANDIES) expect(nearest(all, c.lon, c.lat), `${c.kind} at ${c.lat},${c.lon}`).toBeGreaterThan(14);
  });

  it("sit in open ocean, clear of any land", () => {
    for (const file of FILES) {
      const l = land(file);
      for (const c of CANDIES) {
        for (const pt of ring(c.lon, c.lat, 6)) expect(geoContains(l, pt), `${c.kind} at ${c.lat},${c.lon} (${file})`).toBe(false);
      }
    }
  }, 30_000);

  it("appear in the Candy Shop only", () => {
    expect(Object.values(THEMES).filter((t) => t.decor === "candy").map((t) => t.id)).toEqual(["candy"]);
  });
});

describe("star chart", () => {
  const all = places();

  it("keeps every star in open ocean, away from outlets' cities", () => {
    const l = land("world-50m.json");
    for (const [lon, lat] of STARS) {
      expect(nearest(all, lon, lat), `star at ${lat},${lon}`).toBeGreaterThan(8);
      for (const pt of ring(lon, lat, 2)) expect(geoContains(l, pt), `star at ${lat},${lon}`).toBe(false);
    }
  }, 30_000);
});
