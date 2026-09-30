// The handmade designs of decision 76 put things out at sea: Pop-up Book's paper clouds, suns and boats on sticks,
// Toy Train Set's oval tracks, and the chalk and pencil doodles of Chalkboard and Sketchbook. Each is drawn no wider
// than the open water around its spot, so that whole circle must be clear of land and far from every place.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { geoContains, geoDistance } from "d3-geo";
import type { FeatureCollection } from "geojson";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import { describe, expect, it } from "vitest";
import { DOODLES } from "../src/map/handmade.ts";
import { POPUP_SPOTS } from "../src/map/popup.ts";
import { TRACKS } from "../src/map/trainset.ts";
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

/** The spot and points on two circles round it, half and all of its radius out. */
function ring(lon: number, lat: number, deg: number): [number, number][] {
  const pts: [number, number][] = [[lon, lat]];
  for (const f of [0.5, 1]) {
    for (let a = 0; a < 360; a += 15) {
      const dLat = f * deg * Math.cos(a * RAD);
      const dLon = (f * deg * Math.sin(a * RAD)) / Math.cos((lat + dLat) * RAD);
      pts.push([lon + dLon, lat + dLat]);
    }
  }
  return pts;
}

describe("the handmade designs' things at sea", () => {
  const all = places();
  const lists = { "Pop-up Book": POPUP_SPOTS, "Toy Train Set": TRACKS, doodles: DOODLES };

  for (const file of ["world-110m.json", "world-50m.json"]) {
    it(`keeps every spot's whole circle off land (${file})`, () => {
      const l = land(file);
      for (const [name, list] of Object.entries(lists)) {
        for (const s of list) {
          for (const p of ring(s.lon, s.lat, s.r)) expect(geoContains(l, p), `${name}: ${s.kind} at ${s.lat},${s.lon}`).toBe(false);
        }
      }
    }, 60_000);
  }

  it("keeps every spot at least 3 degrees clear of every place", () => {
    expect(all.length).toBeGreaterThan(50);
    for (const [name, list] of Object.entries(lists)) {
      for (const s of list) {
        const nearest = Math.min(...all.map((p) => geoDistance(p, [s.lon, s.lat]) / RAD));
        expect(nearest - s.r, `${name}: ${s.kind} at ${s.lat},${s.lon}`).toBeGreaterThan(3);
      }
    }
  });

  it("never lets two things of one design overlap", () => {
    for (const [name, list] of Object.entries(lists)) {
      for (const [i, a] of list.entries()) {
        for (const b of list.slice(i + 1)) {
          expect(geoDistance([a.lon, a.lat], [b.lon, b.lat]) / RAD, `${name}: ${a.kind} and ${b.kind}`).toBeGreaterThan(a.r + b.r);
        }
      }
    }
  });

  it("gives each of the four designs its own way of drawing the world", () => {
    expect(THEMES.popup.surface).toBe("popup");
    expect(THEMES.trainset.surface).toBe("trainset");
    expect(THEMES.chalk.surface).toBe("chalk");
    expect(THEMES.sketch.surface).toBe("sketch");
    // The fresh colour differs from the ordinary marker in each, so fresh reports read without a dotted ring.
    for (const id of ["popup", "trainset", "chalk", "sketch"] as const) expect(THEMES[id].fresh).not.toBe(THEMES[id].dot);
  });
});
