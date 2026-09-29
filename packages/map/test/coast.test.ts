import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { feature } from "topojson-client";
import type { FeatureCollection } from "geojson";
import type { GeometryCollection, Topology } from "topojson-specification";
import { coastOf } from "../src/map/basemap.ts";

describe("the coastline (decision 42)", () => {
  it("drops the edges the data adds along 180 degrees, so no straight line is drawn there", () => {
    const land: FeatureCollection = {
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[170, 60], [180, 60], [180, 70], [170, 70], [170, 60]]] } }],
    };
    expect(coastOf(land).coordinates).toEqual([
      [[170, 60], [180, 60]],
      [[180, 70], [170, 70], [170, 60]],
    ]);
  });

  for (const file of ["world-110m", "world-50m"]) {
    it(`leaves no cut edges in ${file}`, () => {
      const topo = JSON.parse(readFileSync(new URL(`../public/basemap/${file}.json`, import.meta.url), "utf8")) as Topology;
      const coast = coastOf(feature(topo, topo.objects["land"] as GeometryCollection) as FeatureCollection);
      const cuts = coast.coordinates.flatMap((line) => line.slice(1).filter((p, i) => Math.abs(p[0]!) > 179.99 && Math.abs(line[i]![0]!) > 179.99));
      expect(cuts).toHaveLength(0);
      expect(coast.coordinates.length).toBeGreaterThan(100);
    });
  }
});
