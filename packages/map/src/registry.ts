// What a design brings with it, and how the page gets it. Every design except Morning Edition (the default, whose
// code is in the main chunk) is one entry module, src/designs/<id>.ts, loaded the first time the design is shown. The
// entry imports the design's CSS (src/designs/<id>.css) and fonts, and fills this registry with its canvas drawing
// (a surface, or a kit for the few designs that bend the map's own code) and its page chrome (a UI kit). The map and
// the page look designs up here, never import them, so a design's code reaches a visitor only when they pick it.
//
// A design is applied only after its entry has loaded (`loadDesign`), so the lookups below always find what the
// design in use registered. Where one is missing the page draws nothing design-specific rather than another design's.
import type { SurfaceFrame, SurfaceResult } from "./map/surface.ts";
import type { Warp } from "./map/warp.ts";
import type { ThemeId } from "./themes.ts";

/** A design that draws land and sea its own way (`surface` in themes.ts). */
export interface Surface<C = unknown> {
  /** What it keeps between frames; one per page, made when the design is first drawn. */
  make?(): C;
  draw(f: SurfaceFrame, cache: C): SurfaceResult | number | void;
  /** Noodle Bowl: the sway the broth puts on the picture after a drag or a zoom (`warp: "wobble"`). */
  wobble?(cache: C, now: number, lon: number, lat: number, zoom: number, scale: number, w: number, h: number, still: boolean): Warp | null;
}

const surfaces = new Map<string, Surface<any>>();

export function registerSurface<C>(name: string, surface: Surface<C>) {
  surfaces.set(name, surface);
}

export function surfaceOf(name: string): Surface<any> | undefined {
  return surfaces.get(name);
}

/**
 * Code the map's own drawing calls into, for the designs that change more than what is drawn: each is a whole module,
 * registered by the designs that use it. `lowPoly` and `scenes` are the map's terrain and scene renderers
 * (src/map/lowpoly.ts, scene-view.ts).
 */
export interface Kits {
  decor?: typeof import("./map/decor.ts");
  scenery?: typeof import("./map/scenery.ts");
  fold?: typeof import("./map/fold.ts");
  vinyl?: typeof import("./map/vinyl.ts");
  zine?: typeof import("./map/zine.ts");
  lowPoly?: typeof import("./map/lowpoly.ts");
  scenes?: typeof import("./map/scene-view.ts");
}

export const kits: Kits = {};

/** The page chrome a design adds, one module each (src/ui). The page calls them only where they are present. */
export interface UiKits {
  flap?: typeof import("./ui/flap.ts");
  extras?: typeof import("./ui/extras.ts");
  paper?: typeof import("./ui/paper.ts");
  dial?: typeof import("./ui/dial.ts");
  channels?: typeof import("./ui/channels.ts");
  desktop?: typeof import("./ui/desktop.ts");
  vinyl?: typeof import("./ui/vinyl.ts");
  lobster?: typeof import("./ui/lobster.ts");
  postcard?: typeof import("./ui/postcard.ts");
  burger?: typeof import("./ui/burger.ts");
}

export const ui: UiKits = {};

/** Registers a module in `kits` or `ui`. */
export function registerKit<K extends keyof Kits>(name: K, module: NonNullable<Kits[K]>) {
  kits[name] = module;
}

export function registerUi<K extends keyof UiKits>(name: K, module: NonNullable<UiKits[K]>) {
  ui[name] = module;
}

// ---- loading ------------------------------------------------------------------------------------------------------

const loaders = import.meta.glob<unknown>(["./designs/*.ts", "!./designs/morning.ts"]);
const loaded = new Map<string, Promise<void>>();

/** Whether a design has an entry to load (Morning Edition's is in the main chunk). */
export function hasEntry(id: string): boolean {
  return id === "morning" || `./designs/${id}.ts` in loaders;
}

/** Whether a design's code and CSS are here. */
export function isLoaded(id: ThemeId): boolean {
  return id === "morning" || done.has(id);
}

const done = new Set<string>();

/** Waits for the design's stylesheets, which the browser fetches beside its script, so its chrome never shows bare. */
async function stylesReady() {
  const pending = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].filter((l) => !l.sheet);
  // A stylesheet that never answers must not hold the page for good: the design shows with what has come after a while.
  const patience = new Promise<void>((resolve) => setTimeout(resolve, 8000));
  await Promise.race([
    patience,
    Promise.all(
      pending.map(
        (l) =>
          new Promise<void>((resolve) => {
            l.addEventListener("load", () => resolve(), { once: true });
            l.addEventListener("error", () => resolve(), { once: true });
          }),
      ),
    ),
  ]);
}

/**
 * Starts loading a design and returns when its code, CSS and fonts' CSS are in. Safe to call again and again; a failed
 * load can be tried again.
 */
export function loadDesign(id: ThemeId): Promise<void> {
  if (isLoaded(id)) return Promise.resolve();
  let p = loaded.get(id);
  if (!p) {
    const load = loaders[`./designs/${id}.ts`];
    if (!load) return Promise.reject(new Error(`No entry for design ${id}`));
    p = load()
      .then(stylesReady)
      .then(() => {
        done.add(id);
      });
    p.catch(() => loaded.delete(id));
    loaded.set(id, p);
  }
  return p;
}

/** Starts fetching a design a reader looks at (a card they point at), without waiting for it or reporting a failure. */
export function prefetchDesign(id: ThemeId) {
  if (isLoaded(id) || !hasEntry(id)) return;
  loadDesign(id).catch(() => {});
}
