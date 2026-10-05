// The files the site reads for one day (decision 78): the day's file, with the outlets' stories, the events, the word
// and an index of tiles, and one small file per tile of GDELT local stories beside it. `map export` and `demo`
// write them; the daily run stores the same files in R2.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { LOCAL_NAMES_FILE, splitLocal, type MapFile } from "@2dayai/core";

export type WrittenMap = {
  main: MapFile;
  /** Bytes of the day's file, of all tiles together, of the largest tile, and of the names index (0 with no tile). */
  bytes: { main: number; tiles: number; largestTile: number; names: number };
  /**
   * Every file written beside the day's file: each tile's R2 key (`<base><key>.json`, e.g. local/2026-09-30/40N_80W.json)
   * and its path on disk, and the names index (`<base>names.json`) when there is any tile.
   */
  tiles: { key: string; file: string }[];
};

/**
 * Writes the day's file to `out` and its tiles to `<folder of out>/<base>`, where the site looks for them. The tiles'
 * folder is emptied first, so a re-export never leaves a tile the new index doesn't list.
 */
export function writeMapFiles(full: MapFile, out: string, base: string): WrittenMap {
  if (!/^local\/[\w-]+\/$/.test(base)) throw new Error(`tile folder "${base}" must be local/<name>/`);
  const { main, tiles, names } = splitLocal(full, base);
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
  // The names index goes beside the tiles, so the same upload stores it (decision 78: the site fetches it when search opens).
  let namesBytes = 0;
  if (names) {
    const body = JSON.stringify(names);
    const file = join(dir, LOCAL_NAMES_FILE);
    writeFileSync(file, body);
    written.push({ key: `${base}${LOCAL_NAMES_FILE}`, file });
    namesBytes = Buffer.byteLength(body);
  }
  return { main, bytes: { main: Buffer.byteLength(text), tiles: total, largestTile: largest, names: namesBytes }, tiles: written };
}

/**
 * Why a written day's file must not go up as the site's latest.json, or none when it may. The daily run and the
 * refresh check the file on disk before they store it, so a broken export fails the run and the file already up
 * stays. Broken means: not JSON or not a day's file, a story at a place the file lacks, no outlet stories, no
 * explained event and no local story either, or a tile the file lists that is not on disk to be stored with it. A
 * day without a word is fine (decision 81).
 */
export function mapFileProblems(text: string, tiles: { key: string; file: string }[]): string[] {
  let file: MapFile;
  try {
    file = JSON.parse(text) as MapFile;
  } catch {
    return ["the file is not valid JSON"];
  }
  const shaped = file && typeof file === "object" && file.version === 2 && /^\d{4}-\d{2}-\d{2}$/.test(String(file.runDate));
  if (!shaped || !Array.isArray(file.items) || !Array.isArray(file.places) || !file.events || typeof file.events !== "object") {
    return ["the file is not a day's map (version 2, a run date, places, items and events)"];
  }
  const problems: string[] = [];
  if (file.items.some((i) => !Number.isInteger(i.place) || i.place < 0 || i.place >= file.places.length)) problems.push("a story points at a place the file does not have");
  const outlets = file.items.filter((i) => i.via !== "gdelt").length;
  const listed = file.local?.tiles ?? {};
  const local = Object.values(listed).reduce((a, b) => a + b, 0) + file.items.length - outlets;
  if (outlets === 0) problems.push("no outlet stories");
  if (Object.keys(file.events).length === 0 && local === 0) problems.push("no explained events and no local stories");
  const base = file.local?.base ?? "";
  const onDisk = new Map(tiles.map((t) => [t.key, t.file]));
  const missing = Object.keys(listed).filter((k) => {
    const f = onDisk.get(`${base}${k}.json`);
    return !f || !existsSync(f);
  });
  if (missing.length) problems.push(`${missing.length} listed tiles are not on disk, for example ${base}${missing[0]}.json`);
  if (file.local?.names) {
    const f = onDisk.get(`${base}${LOCAL_NAMES_FILE}`);
    if (!f || !existsSync(f)) problems.push(`the names index ${base}${LOCAL_NAMES_FILE} is not on disk`);
  }
  return problems;
}

/** mapFileProblems for a file on disk and the tile list `map export --manifest` wrote beside it. */
export function checkMapFile(path: string, manifest?: string): string[] {
  const tiles = manifest ? (JSON.parse(readFileSync(manifest, "utf8")) as { key: string; file: string }[]) : [];
  return mapFileProblems(readFileSync(path, "utf8"), tiles);
}
