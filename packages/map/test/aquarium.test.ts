// Aquarium's fish (decision 77) swim only inside fixed circles of open ocean, sized to the circle, so the whole
// circle must be clear of land and far from every place.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { geoDistance } from "d3-geo";
import { describe, expect, it } from "vitest";
import { FISH } from "../src/map/aquarium.ts";
import { samplePlaces } from "./sample.ts";
import { BASEMAPS, inLand, landOf } from "./basemaps.ts";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const RAD = Math.PI / 180;

const land = landOf;

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

describe("aquarium fish", () => {
  for (const file of BASEMAPS) {
    it(`keeps every fish's whole circle off land (${file})`, () => {
      const l = land(file);
      for (const s of FISH) {
        for (const p of ring(s.lon, s.lat, s.r)) expect(inLand(l, p), `${s.kind} at ${s.lat},${s.lon}`).toBe(false);
      }
    }, 30_000);
  }

  it("keeps every fish at least 3 degrees clear of every place", () => {
    const all = places();
    for (const s of FISH) {
      const nearest = Math.min(...all.map((p) => geoDistance(p, [s.lon, s.lat]) / RAD));
      expect(nearest - s.r, `${s.kind} at ${s.lat},${s.lon}`).toBeGreaterThan(3);
    }
  });
});
