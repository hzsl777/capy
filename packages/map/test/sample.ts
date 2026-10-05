// Every place of the sample day: the day's file and its tiles of local stories (decision 78), which the site loads
// when zoomed in (their file names start with a digit: names.json, the search index, holds no tile). Tests that keep
// decorations clear of places read them all.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "data");

type Places = { places: { lat: number; lon: number }[] };

export function samplePlaces(): { lat: number; lon: number }[] {
  const main = JSON.parse(readFileSync(join(DATA, "sample.json"), "utf8")) as Places & { local?: { base: string } };
  const out = [...main.places];
  if (main.local) {
    const dir = join(DATA, main.local.base);
    for (const f of readdirSync(dir).filter((n) => /^\d.*\.json$/.test(n))) out.push(...(JSON.parse(readFileSync(join(dir, f), "utf8")) as Places).places);
  }
  return out;
}
