// Console Menu's home screen (decision 99): a grid of rounded channel tiles over pale grey lines, after the feel of a
// late-2000s console's channel menu, with a rounded bottom bar holding a clock and two round buttons. The map is the
// first and largest tile, a live copy of the map's own canvas; the other tiles open what the map already has (the
// word, the newest report, Topics, the Key, Pinned places, About). Picking a tile zooms it up to fill the screen and
// lands in the map. Our own drawing and CSS only: no console maker's names, logos, sounds, characters or art.
//
// Only Console Menu shows any of this. It is a modal <dialog>, so focus stays in it, Escape leaves it, and the page
// behind is inert; the Menu button on the map brings it back. Text goes in as text, never as HTML.

import { THEMES, type ThemeId } from "../themes.ts";
import { markPath, markRing } from "../map/marks.ts";
import { SITE_NAME, SITE_TAGLINE } from "../brand.ts";
import { h } from "./dom.ts";

/** Where a tile leads: into the map, and then to one of its parts. */
export type Channel = "map" | "word" | "latest" | "topics" | "key" | "pins";

export interface ChannelSource {
  theme(): ThemeId;
  /** The day's word with its label and date, or a line saying there is none. */
  word(): { kicker: string; word: string; date: string } | { none: string; date: string } | null;
  /** The newest report as the panel shows it (its headline and meta line), or null. */
  latest(): Node[] | null;
  /** Which topics are on, as a short line. */
  topics(): string;
  /** The reader's pinned places by name. */
  pins(): string[];
  /** Into the map, then to the part the tile names. */
  open(channel: Channel): void;
  about(): void;
}

const NS = "http://www.w3.org/2000/svg";
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let src: ChannelSource;
let home: HTMLDialogElement;
let grid: HTMLElement;
let preview: HTMLCanvasElement;
let wordTile: HTMLElement;
let latestTile: HTMLElement;
let topicsLine: HTMLElement;
let pinsLine: HTMLElement;
let keyMarks: HTMLElement;
let clock: HTMLElement;
let dateLine: HTMLElement;
let copyTimer = 0;
let clockTimer = 0;
let leaving = false;

function svg(tag: string, attrs: Record<string, string | number>): SVGElement {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** A small picture for a tile, drawn in the tile's own blue. */
function icon(kind: "topics" | "pins" | "about" | "globe" | "grid"): SVGElement {
  const s = svg("svg", { viewBox: "0 0 40 40", class: `x-ico x-ico-${kind}`, "aria-hidden": "true" });
  const line = { fill: "none", stroke: "currentColor", "stroke-width": 2.6, "stroke-linecap": "round", "stroke-linejoin": "round" };
  if (kind === "topics") {
    // Three topic chips, one of them on.
    s.append(
      svg("rect", { x: 3, y: 8, width: 15, height: 10, rx: 5, ...line }),
      svg("rect", { x: 21, y: 6.7, width: 17, height: 12.6, rx: 6.3, fill: "currentColor" }),
      svg("rect", { x: 8, y: 23, width: 24, height: 10, rx: 5, ...line }),
    );
  } else if (kind === "pins") {
    s.append(svg("path", { d: "M20 35C20 35 9 23 9 15.5A11 11 0 0 1 31 15.5C31 23 20 35 20 35Z", ...line }), svg("circle", { cx: 20, cy: 15.5, r: 4, fill: "currentColor" }));
  } else if (kind === "about") {
    s.append(
      svg("circle", { cx: 20, cy: 20, r: 15, ...line }),
      svg("path", { d: "M15.5 15.5A4.6 4.6 0 1 1 21.6 19.8C20.6 20.3 20 21.1 20 22.3V23.5", ...line }),
      svg("circle", { cx: 20, cy: 28.5, r: 1.8, fill: "currentColor" }),
    );
  } else if (kind === "globe") {
    s.append(
      svg("circle", { cx: 20, cy: 20, r: 14, ...line }),
      svg("ellipse", { cx: 20, cy: 20, rx: 6, ry: 14, ...line }),
      svg("path", { d: "M6 20H34M8.5 12.5H31.5M8.5 27.5H31.5", ...line, "stroke-width": 2 }),
    );
  } else if (kind === "grid") {
    for (const [x, y] of [
      [6, 6],
      [22, 6],
      [6, 22],
      [22, 22],
    ] as const)
      s.append(svg("rect", { x, y, width: 12, height: 12, rx: 3.5, fill: "currentColor" }));
  }
  return s;
}

/** The Key tile's three marks, drawn from the same outline as the map and the Key (src/map/marks.ts). */
function marks(): SVGElement {
  const t = THEMES[src.theme()];
  const s = svg("svg", { viewBox: "0 0 96 32", class: "x-ch-marks", "aria-hidden": "true" });
  const at = (x: number, d: string, fill: string, stroke: string, width: number) =>
    svg("path", { d, fill, stroke, "stroke-width": width, transform: `translate(${x} 16)` });
  s.append(
    at(16, markPath(t.dotShape, 5.5), t.dotStroke, t.dot, 1.8),
    at(48, markPath(t.dotShape, 7), t.dot, t.dotStroke, 1.4),
    at(80, markPath(t.dotShape, 7), t.dot, t.dotStroke, 1.4),
    at(80, markRing(t.dotShape, 7, 3), "none", t.dot, 1.6),
  );
  return s;
}

/** A tile reads out its own text; only the map tile, whose picture says nothing to a screen reader, has a label. */
function tile(channel: Channel | "about", cls: string, label: string | undefined, ...children: (Node | null)[]): HTMLButtonElement {
  const b = h("button", { type: "button", class: `x-ch ${cls}`, "aria-label": label }, ...children);
  b.addEventListener("click", () => (channel === "about" ? src.about() : enter(channel, b)));
  return b;
}

function empty(): HTMLElement {
  return h("div", { class: "x-ch x-ch-empty", "aria-hidden": "true" });
}

export function mountChannels(source: ChannelSource): void {
  src = source;
  preview = h("canvas", { class: "x-ch-preview", "aria-hidden": "true" });
  wordTile = h("span", { class: "x-ch-body" });
  latestTile = h("span", { class: "x-ch-body" });
  topicsLine = h("span", { class: "x-ch-note" });
  pinsLine = h("span", { class: "x-ch-note" });
  keyMarks = h("span", { class: "x-ch-art" });
  clock = h("span", { class: "x-clock-time" });
  dateLine = h("span", { class: "x-clock-date" });

  const mapTile = tile(
    "map",
    "x-ch-map",
    "Open the map",
    h("span", { class: "x-ch-screen" }, preview),
    h("span", { class: "x-ch-cap" }, h("b", {}, SITE_NAME), h("span", {}, SITE_TAGLINE)),
  );
  grid = h(
    "div",
    { class: "x-home-grid" },
    mapTile,
    tile("word", "x-ch-word", undefined, wordTile),
    tile("latest", "x-ch-latest", undefined, latestTile),
    tile("topics", "x-ch-small", undefined, h("span", { class: "x-ch-art" }, icon("topics")), h("span", { class: "x-ch-title" }, "Topics"), topicsLine),
    tile("key", "x-ch-small", undefined, keyMarks, h("span", { class: "x-ch-title" }, "Key"), h("span", { class: "x-ch-note" }, "What the marks mean")),
    tile("pins", "x-ch-small", undefined, h("span", { class: "x-ch-art" }, icon("pins")), h("span", { class: "x-ch-title" }, "Pinned"), pinsLine),
    tile("about", "x-ch-small", undefined, h("span", { class: "x-ch-art" }, icon("about")), h("span", { class: "x-ch-title" }, "About"), h("span", { class: "x-ch-note" }, "How this works")),
    empty(),
    empty(),
  );
  grid.addEventListener("keydown", arrows);

  const about = h("button", { type: "button", class: "x-round x-round-l", "aria-label": "About", title: "About" }, icon("about"));
  about.addEventListener("click", () => src.about());
  const go = h("button", { type: "button", class: "x-round x-round-r", "aria-label": "Open the map", title: "Open the map" }, icon("globe"));
  go.addEventListener("click", () => enter("map", mapTile));

  home = h(
    "dialog",
    { class: "x-home", "aria-label": "Home menu" },
    h("div", { class: "x-home-bg" }),
    h("div", { class: "x-home-scroll" }, grid),
    h("div", { class: "x-home-bar" }, about, h("p", { class: "x-clock" }, clock, dateLine), go),
  );
  // Escape goes into the map, the same way the map tile does.
  home.addEventListener("cancel", (e) => {
    e.preventDefault();
    enter("map", mapTile);
  });
  home.addEventListener("close", stopTimers);
  document.body.append(home);

  const menu = h("button", { type: "button", class: "x-menu", "aria-label": "Menu: the home screen of channels" }, icon("grid"), h("span", {}, "Menu"));
  menu.addEventListener("click", () => showChannels(true));
  document.getElementById("map")?.append(menu);
  document.addEventListener("visibilitychange", () => {
    if (home.open && document.visibilityState === "visible") startTimers();
    else stopTimers();
  });
}

/** Fills the tiles from the day's file. Called when the screen opens and when the file arrives. */
export function refreshChannels(): void {
  if (!src || !home.open) return;
  const w = src.word();
  if (!w) wordTile.replaceChildren(h("span", { class: "x-ch-kicker" }, "Today's Word"), h("span", { class: "x-ch-note" }, "Loading the word..."));
  else if ("none" in w) wordTile.replaceChildren(h("span", { class: "x-ch-kicker" }, w.date), h("span", { class: "x-ch-title" }, w.none));
  else {
    const word = h("span", { class: "x-ch-word-text" }, w.word);
    word.style.setProperty("--len", String(Math.max(4, w.word.length)));
    // The word keeps its date and who chose it, as everywhere it shows (decision 40).
    wordTile.replaceChildren(h("span", { class: "x-ch-kicker" }, w.kicker), word, h("span", { class: "x-ch-date" }, w.date), h("span", { class: "x-ch-note" }, "Chosen by AI"));
  }
  const latest = src.latest();
  latestTile.replaceChildren(h("span", { class: "x-ch-kicker" }, "Latest report"), ...(latest ?? [h("span", { class: "x-ch-note" }, "No reports in this window")]));
  topicsLine.textContent = src.topics();
  const pins = src.pins();
  pinsLine.textContent = pins.length ? pins.join(" · ") : "Pin a place from its list";
  keyMarks.replaceChildren(marks());
}

export function channelsOpen(): boolean {
  return !!home?.open;
}

/** Opens the home screen. From the map, the map shrinks into its tile while the grid fades in. */
export function showChannels(animate: boolean): void {
  if (!src || home.open) return;
  leaving = false;
  home.classList.remove("leaving");
  home.showModal();
  refreshChannels();
  copyPreview();
  startTimers();
  const mapTile = grid.querySelector<HTMLElement>(".x-ch-map")!;
  mapTile.focus({ preventScroll: true });
  if (!animate || reduced) return;
  for (const el of home.querySelectorAll<HTMLElement>(":scope > .x-home-bg, :scope > .x-home-scroll, :scope > .x-home-bar"))
    el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: "ease-out" });
  grid.animate([{ transform: "scale(0.97)" }, { transform: "none" }], { duration: 380, easing: "cubic-bezier(.2,.7,.3,1)" });
  const map = document.getElementById("map")?.getBoundingClientRect();
  if (map) fly(ghost(), map, mapTile.getBoundingClientRect(), true);
}

/** Closes the home screen at once (another design was chosen). */
export function hideChannels(): void {
  if (home?.open) home.close();
}

/**
 * Into the map: the chosen tile zooms up to the map's place on the page and turns into the map's picture as it
 * grows, while the grid fades away; then the copy fades and the map itself is there. Nothing moves for reduced
 * motion: the map simply opens.
 */
function enter(channel: Channel, from: HTMLElement) {
  if (leaving) return;
  const done = () => {
    leaving = false;
    home.close();
    src.open(channel);
  };
  const map = document.getElementById("map")?.getBoundingClientRect();
  if (reduced || !map) return done();
  leaving = true;
  home.classList.add("leaving");
  fly(ghost(channel === "map" ? 1 : 0), from.getBoundingClientRect(), map, false).then(done);
}

/** A copy of the map's picture in a tile's white plastic, which flies between the grid and the map. */
function ghost(picture = 1): HTMLElement {
  const g = h("div", { class: "x-zoom", "aria-hidden": "true" });
  const c = document.querySelector<HTMLCanvasElement>("#map canvas");
  if (c?.width) {
    const copy = h("canvas", {});
    copy.width = c.width;
    copy.height = c.height;
    copy.getContext("2d")?.drawImage(c, 0, 0);
    copy.style.opacity = String(picture);
    g.append(copy);
  }
  home.append(g);
  return g;
}

function fly(g: HTMLElement, a: DOMRect, b: DOMRect, toGrid: boolean): Promise<void> {
  const box = (r: DOMRect, radius: number) => ({ left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, borderRadius: `${radius}px` });
  const ms = 420;
  const easing = "cubic-bezier(.4,0,.2,1)";
  const pic = g.querySelector("canvas");
  if (pic && pic.style.opacity === "0") pic.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms, easing, fill: "forwards" });
  const anim = g.animate([box(a, toGrid ? 0 : 20), box(b, toGrid ? 20 : 0)], { duration: ms, easing, fill: "forwards" });
  return anim.finished.then(
    () =>
      g
        .animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, fill: "forwards" })
        .finished.then(() => g.remove()),
    () => g.remove(),
  );
}

/** The map tile is the map's own picture, copied a few times a second while the screen shows. */
function copyPreview() {
  const c = document.querySelector<HTMLCanvasElement>("#map canvas");
  if (!c?.width || !c.height) return;
  const r = preview.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(r.width * dpr));
  const hh = Math.max(1, Math.round(r.height * dpr));
  if (preview.width !== w || preview.height !== hh) {
    preview.width = w;
    preview.height = hh;
  }
  const g = preview.getContext("2d");
  if (!g) return;
  // Cover the tile, centred, so the reticle's place sits in its middle.
  const k = Math.max(w / c.width, hh / c.height);
  const sw = w / k, sh = hh / k;
  g.clearRect(0, 0, w, hh);
  g.drawImage(c, (c.width - sw) / 2, (c.height - sh) / 2, sw, sh, 0, 0, w, hh);
}

const two = (n: number) => String(n).padStart(2, "0");

function tickClock() {
  const now = new Date();
  clock.textContent = `${two(now.getHours())}:${two(now.getMinutes())}`;
  dateLine.textContent = now.toLocaleDateString(undefined, { weekday: "short", month: "numeric", day: "numeric" });
}

function startTimers() {
  stopTimers();
  if (!home.open) return;
  tickClock();
  clockTimer = window.setInterval(tickClock, 15000);
  // A still copy for reduced motion; otherwise five a second, enough to follow a turning globe.
  if (!reduced) copyTimer = window.setInterval(copyPreview, 200);
}

function stopTimers() {
  clearInterval(copyTimer);
  clearInterval(clockTimer);
  copyTimer = clockTimer = 0;
}

/** Arrow keys move to the nearest tile that way, by where the tiles sit on screen. */
function arrows(e: KeyboardEvent) {
  const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (!dir) return;
  const tiles = [...grid.querySelectorAll<HTMLElement>("button.x-ch")];
  const here = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>("button.x-ch");
  if (!here) return;
  e.preventDefault();
  const c = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2] as const;
  };
  const box = here.getBoundingClientRect();
  const [x0, y0] = c(here);
  // Half the current tile's size across the move: a tile level with any part of it counts as straight ahead, so
  // from the big map tile both rows beside it are reachable and the first one in the grid wins.
  const half = dir[0] ? box.height / 2 : box.width / 2;
  let best: HTMLElement | null = null;
  let bestD = Infinity;
  for (const t of tiles) {
    if (t === here) continue;
    const [x, y] = c(t);
    // Only tiles whose middle lies past the current tile's edge that way.
    const edge = dir[0] === 1 ? box.right : dir[0] === -1 ? -box.left : dir[1] === 1 ? box.bottom : -box.top;
    const along = x * dir[0]! + y * dir[1]! - edge;
    if (along <= 0) continue;
    const across = Math.max(0, Math.abs((x - x0) * dir[1]! + (y - y0) * dir[0]!) - half);
    const d = along + across * 2;
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  best?.focus();
}
