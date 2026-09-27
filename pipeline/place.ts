import type { GkgLocation } from "./gkg.ts";
import type { Place } from "../src/types.ts";

/**
 * Picks the one place an article is about.
 * Prefers city-level mentions, then provinces/states; country-only articles are
 * dropped because a country centroid is not a real place and would plant a dot
 * that reads as a statement about the whole country.
 * Among candidates the earliest mention wins, which is usually the dateline.
 */
export function choosePlace(locations: GkgLocation[]): Place | null {
  const rank = (type: number) => (type === 3 || type === 4 ? 0 : type === 2 || type === 5 ? 1 : 9);
  const best = locations
    .filter((l) => rank(l.type) < 9)
    .sort((a, b) => rank(a.type) - rank(b.type) || a.offset - b.offset)[0];
  if (!best) return null;
  return {
    id: placeId(best.featureId, best.lat, best.lon),
    name: shortName(best.fullName),
    lat: round(best.lat),
    lon: round(best.lon),
  };
}

/** "Springfield, Illinois, United States" -> "Springfield". The map never names countries. */
export function shortName(fullName: string): string {
  return fullName.split(",")[0].trim() || fullName.trim();
}

export function placeId(featureId: string | undefined, lat: number, lon: number): string {
  const f = featureId?.trim();
  if (f && /^-?[\w]+$/.test(f)) return `g:${f}`;
  return `ll:${lat.toFixed(1)},${lon.toFixed(1)}`;
}

function round(n: number) {
  return Math.round(n * 1000) / 1000;
}
