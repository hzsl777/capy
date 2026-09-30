// The files the site reads for one day (decision 78): the day's file, with the outlets' stories, the events, the word
// and an index of tiles, and one small file per tile of GDELT local stories beside it. `map export` and `demo`
// write them; the daily run stores the same files in R2.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { splitLocal, type MapFile } from "@2dayai/core";

export type WrittenMap = {
  main: MapFile;
  /** Bytes of the day's file, of all tiles together, and of the largest tile. */
  bytes: { main: number; tiles: number; largestTile: number };
  /** Every tile written: its R2 key (`<base><key>.json`, e.g. local/2026-09-30/40_-80.json) and its path on disk. */
  tiles: { key: string; file: string }[];
};

/**
 * Writes the day's file to `out` and its tiles to `<folder of out>/<base>`, where the site looks for them. The tiles'
 * folder is emptied first, so a re-export never leaves a tile the new index doesn't list.
 */
export function writeMapFiles(full: MapFile, out: string, base: string): WrittenMap {
  if (!/^local\/[\w-]+\/$/.test(base)) throw new Error(`tile folder "${base}" must be local/<name>/`);
  const { main, tiles } = splitLocal(full, base);
  const dir = join(dirname(out), base);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const text = JSON.stringify(main);
  writeFileSync(out, text);
  const written: WrittenMap["tiles"] = [];
  let total = 0;
  let largest = 0;
  for (const [key, tile] of tiles) {
    const body = JSON.stringify(tile);
    const file = join(dir, `${key}.json`);
    writeFileSync(file, body);
    written.push({ key: `${base}${key}.json`, file });
    const bytes = Buffer.byteLength(body);
    total += bytes;
    largest = Math.max(largest, bytes);
  }
  return { main, bytes: { main: Buffer.byteLength(text), tiles: total, largestTile: largest }, tiles: written };
}
