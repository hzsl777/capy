// Console Menu's home screen (decisions 100, 104 and 114): twelve channels of one size in a grid of four by three over
// pale grey lines, after the feel of a late-2000s console's channel menu, with a rounded bottom bar holding a clock and
// two round buttons. Every channel opens its own screen first, large, with Menu and Start under it and arrows at its
// sides that step to the channel before or after, as the console did; Start goes into the map at that channel's part.
// The map channel is a live copy of the map's own canvas with the newest headlines crawling under it. Our own drawing
// and CSS only: no console maker's names, logos, sounds, characters or art.
//
// Only Console Menu shows any of this. It is a modal <dialog>, so focus stays in it, Escape steps back, and the page
// behind is inert; the Menu button on the map brings it back. Text goes in as text, never as HTML.

import { THEMES, type ThemeId } from "../themes.ts";
import { markPath, markRing } from "../map/marks.ts";
import { SITE_NAME, SITE_TAGLINE } from "../brand.ts";
import { h } from "./dom.ts";

/** The channels, in the grid's order: where each one leads in the map. */
export type Channel = "map" | "word" | "events" | "latest" | "earlier" | "topics" | "key" | "pins" | "replay" | "translate" | "designs" | "about";

export interface ChannelSource {
  theme(): ThemeId;
  /** The day's word with its label and date, or a line saying there is none. */
  word(): { kicker: string; word: string; date: string } | { none: string; date: string } | null;
  /** The scale's steps and the day's step, or null with no word. */
  scale(): { steps: string[]; on: number } | null;
  /** The lines of the events that shaped the day, as the word's view lists them. */
  events(): string[];
  /** The newest report as the panel shows it (its headline and meta line), or null. */
  latest(): Node[] | null;
  /** The words before today's, newest first, each with its date and step on the scale. */
  recent(): { date: string; word: string; step: string }[];
  /** Which topics are on, as a short line, and each topic with whether it is on. */
  topics(): string;
  topicList(): { label: string; on: boolean }[];
  /** The reader's pinned places, each with how many reports came out there since the reader last looked. */
  pins(): { names: string[]; news: number; each: { name: string; news: number }[] };
  /** The language headlines are translated into, by its own name, or a line saying they show as published. */
  language(): string;
  /** The design on show, by name. */
  design(): string;
  /** The newest headlines, each with its place's name, for the crawl on the map channel's screen. */
  headlines(): { place: string; title: string }[];
  /** Into the map, then to the part the channel names. */
  open(channel: Channel): void;
  about(): void;
}

const NS = "http://www.w3.org/2000/svg";
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

type Icon = "word" | "latest" | "key" | "topics" | "pins" | "about" | "globe" | "grid" | "replay" | "translate" | "events" | "earlier" | "designs" | "prev" | "next";

let src: ChannelSource;
let home: HTMLDialogElement;
let grid: HTMLElement;
let tileCanvas: HTMLCanvasElement;
let clock: HTMLElement;
let dateLine: HTMLElement;
let pv: HTMLElement;
let pvScreen: HTMLElement;
let pvBody: HTMLElement;
let pvMap: HTMLElement;
let pvCanvas: HTMLCanvasElement;
let pvCrawl: HTMLElement;
let pvStart: HTMLButtonElement;
let pvName: HTMLElement;
const tiles = new Map<Channel, HTMLButtonElement>();
/** The channel whose screen is open, while one is. */
let current: Channel | null = null;
let copyTimer = 0;
let clockTimer = 0;
let leaving = false;

function svg(tag: string, attrs: Record<string, string | number>): SVGElement {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** A small picture for a tile, drawn in the tile's own blue. */
function icon(kind: Icon): SVGElement {
  const s = svg("svg", { viewBox: "0 0 40 40", class: `x-ico x-ico-${kind}`, "aria-hidden": "true" });
  const line = { fill: "none", stroke: "currentColor", "stroke-width": 2.6, "stroke-linecap": "round", "stroke-linejoin": "round" };
  if (kind === "word") {
    // A dial with its needle: the word sits on a scale.
    s.append(
      svg("path", { d: "M5 29A15 15 0 0 1 35 29", ...line }),
      svg("path", { d: "M9.5 18.5L12 20.5M20 14V17M30.5 18.5L28 20.5", ...line, "stroke-width": 2 }),
      svg("path", { d: "M20 29L27 20", ...line }),
      svg("circle", { cx: 20, cy: 29, r: 3, fill: "currentColor" }),
    );
  } else if (kind === "latest") {
    // A folded page of news: a headline bar, two lines and a picture.
    s.append(
      svg("rect", { x: 4, y: 7, width: 32, height: 26, rx: 4, ...line }),
      svg("path", { d: "M10 14H30", ...line, "stroke-width": 3.4 }),
      svg("path", { d: "M10 21H19M10 27H19", ...line, "stroke-width": 2.2 }),
      svg("rect", { x: 23, y: 19.5, width: 7, height: 8, rx: 1.5, fill: "currentColor" }),
    );
  } else if (kind === "key") {
    // A key: a ring, its shaft and two teeth.
    s.append(svg("circle", { cx: 11, cy: 20, r: 7.5, ...line, "stroke-width": 3 }), svg("path", { d: "M18.5 20H36M29.5 20V27M35 20V26", ...line, "stroke-width": 3 }));
  } else if (kind === "topics") {
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
  } else if (kind === "replay") {
    // A turning arrow round a play triangle.
    s.append(svg("path", { d: "M33 20A13 13 0 1 1 29 10.6", ...line }), svg("path", { d: "M30.5 4.5V11.5H23.5", ...line }), svg("path", { d: "M16.5 14V26L26.5 20Z", fill: "currentColor" }));
  } else if (kind === "translate") {
    // Two speech bubbles, one over the other.
    s.append(
      svg("path", { d: "M5 7H23V20H13L8 24.5V20H5Z", ...line }),
      svg("path", { d: "M27 15H35V28H32V32.5L27 28H17V24", ...line }),
      svg("path", { d: "M10 13.5H18", ...line }),
    );
  } else if (kind === "events") {
    // A short list: three lines with a dot each.
    for (const y of [10, 20, 30]) s.append(svg("circle", { cx: 8, cy: y, r: 2.6, fill: "currentColor" }), svg("path", { d: `M15 ${y}H34`, ...line }));
  } else if (kind === "earlier") {
    // A clock face turning back.
    s.append(svg("path", { d: "M7 20A13 13 0 1 0 11 10.6", ...line }), svg("path", { d: "M9.5 4.5V11.5H16.5", ...line }), svg("path", { d: "M20 13V20L25 23", ...line }));
  } else if (kind === "designs") {
    // Four swatches, one filled.
    s.append(
      svg("rect", { x: 5, y: 5, width: 13, height: 13, rx: 4, fill: "currentColor" }),
      svg("rect", { x: 22, y: 5, width: 13, height: 13, rx: 4, ...line }),
      svg("rect", { x: 5, y: 22, width: 13, height: 13, rx: 4, ...line }),
      svg("rect", { x: 22, y: 22, width: 13, height: 13, rx: 4, ...line }),
    );
  } else if (kind === "prev" || kind === "next") {
    s.append(svg("path", { d: kind === "prev" ? "M24 9L13 20L24 31" : "M16 9L27 20L16 31", ...line, "stroke-width": 4 }));
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

const KEY_ROWS: [label: string, kind: "hollow" | "filled" | "ringed" | "fresh"][] = [
  ["Rated 4 or 5", "ringed"],
  ["Rated 2 or 3", "filled"],
  ["Rated 1, or a local story from GDELT", "hollow"],
  ["Reported in the last hour", "fresh"],
];

/** One mark of the design on show, drawn from the same outline as the map and the Key (src/map/marks.ts). */
function mark(kind: "hollow" | "filled" | "ringed" | "fresh", size = 32): SVGElement {
  const t = THEMES[src.theme()];
  const s = svg("svg", { viewBox: "-16 -16 32 32", width: size, height: size, class: "x-ch-mark", "aria-hidden": "true" });
  const path = (d: string, fill: string, stroke: string, width: number) => svg("path", { d, fill, stroke, "stroke-width": width });
  if (kind === "hollow") s.append(path(markPath(t.dotShape, 5.5), t.dotStroke, t.dot, 1.8));
  else if (kind === "fresh") s.append(path(markPath(t.dotShape, 7), t.fresh, t.dotStroke, 1.4));
  else s.append(path(markPath(t.dotShape, 7), t.dot, t.dotStroke, 1.4));
  if (kind === "ringed") s.append(path(markRing(t.dotShape, 7, 3), "none", t.dot, 1.6));
  return s;
}

const art = (kind: Icon) => h("span", { class: "x-ch-art" }, icon(kind));
const title = (text: string) => h("span", { class: "x-ch-title" }, text);
const note = (text: string) => h("span", { class: "x-ch-note" }, text);

/** Each channel: its name, what its tile shows in the grid, and what its own screen shows. */
const CHANNELS: { id: Channel; name: string; tile: () => Node[]; screen: () => Node[] }[] = [
  {
    id: "map",
    name: "The map",
    tile: () => [h("span", { class: "x-ch-screen" }, tileCanvas), h("span", { class: "x-ch-cap" }, icon("globe"), SITE_NAME)],
    screen: () => [],
  },
  {
    id: "word",
    name: "Today's word",
    tile: () => [art("word"), ...wordBlock(false)],
    screen: () => wordBlock(true),
  },
  {
    id: "events",
    name: "The day's events",
    tile: () => {
      const n = src.events().length;
      return [art("events"), title("The day's events"), note(n ? `${n} that shaped the word` : "None yet")];
    },
    screen: () => {
      const lines = src.events();
      return [
        h("p", { class: "x-pv-kicker" }, "What shaped the day"),
        lines.length ? h("ol", { class: "x-pv-list" }, ...lines.slice(0, 6).map((l) => h("li", {}, l))) : h("p", { class: "x-pv-text" }, "No events for this day."),
        h("p", { class: "x-pv-note" }, "Written by AI. Start shows every score and its source."),
      ];
    },
  },
  {
    id: "latest",
    name: "Latest report",
    tile: () => [art("latest"), h("span", { class: "x-ch-body" }, h("span", { class: "x-ch-kicker" }, "Latest report"), ...(src.latest() ?? [note("No reports in this window")]))],
    screen: () => [h("p", { class: "x-pv-kicker" }, "Latest report"), h("div", { class: "x-pv-latest" }, ...(src.latest() ?? [h("p", { class: "x-pv-text" }, "No reports in this window.")]))],
  },
  {
    id: "earlier",
    name: "Earlier words",
    tile: () => {
      const r = src.recent();
      return [art("earlier"), title("Earlier words"), note(r.length ? r.slice(0, 3).map((x) => x.word).join(" · ") : "None yet")];
    },
    screen: () => {
      const r = src.recent();
      return [
        h("p", { class: "x-pv-kicker" }, "Earlier words"),
        r.length
          ? h("ol", { class: "x-pv-rows" }, ...r.map((x) => h("li", {}, h("span", { class: "x-pv-date" }, x.date), h("b", {}, x.word), h("span", { class: "x-pv-step" }, x.step))))
          : h("p", { class: "x-pv-text" }, "No earlier words yet."),
        h("p", { class: "x-pv-note" }, "Each chosen by AI from its own day's news."),
      ];
    },
  },
  {
    id: "topics",
    name: "Topics",
    tile: () => [art("topics"), title("Topics"), note(src.topics())],
    screen: () => [
      h("p", { class: "x-pv-kicker" }, "Topics"),
      h("ul", { class: "x-pv-chips" }, ...src.topicList().map((t) => h("li", { class: t.on ? "on" : "" }, t.label))),
      h("p", { class: "x-pv-note" }, "Start opens the list to pick topics."),
    ],
  },
  {
    id: "key",
    name: "Key",
    tile: () => [art("key"), title("Key"), note("What the marks mean")],
    screen: () => [
      h("p", { class: "x-pv-kicker" }, "Key"),
      h("ul", { class: "x-pv-key" }, ...KEY_ROWS.map(([label, kind]) => h("li", {}, mark(kind, 40), h("span", {}, label)))),
      h("p", { class: "x-pv-note" }, "A bigger mark means more reports."),
    ],
  },
  {
    id: "pins",
    name: "Pinned",
    tile: () => {
      const p = src.pins();
      return [art("pins"), title("Pinned"), note(p.names.length ? [p.news ? `${p.news} new` : "", ...p.names].filter(Boolean).join(" · ") : "Pin a place from its list")];
    },
    screen: () => {
      const p = src.pins();
      return [
        h("p", { class: "x-pv-kicker" }, "Pinned places"),
        p.each.length
          ? h("ul", { class: "x-pv-rows" }, ...p.each.map((x) => h("li", {}, h("b", {}, x.name), h("span", { class: "x-pv-step" }, x.news ? `${x.news} new` : ""))))
          : h("p", { class: "x-pv-text" }, "Pin a place from its list on the map. Its new reports show here."),
      ];
    },
  },
  {
    id: "replay",
    name: "Replay",
    tile: () => [art("replay"), title("Replay"), note("The day as it came in")],
    screen: () => [art("replay"), h("h3", { class: "x-pv-title" }, "Replay"), h("p", { class: "x-pv-text" }, "Plays the day's reports on the map as they came in, a quarter hour at a time.")],
  },
  {
    id: "translate",
    name: "Translate",
    tile: () => [art("translate"), title("Translate"), note(src.language())],
    screen: () => [
      art("translate"),
      h("h3", { class: "x-pv-title" }, "Translate"),
      h("p", { class: "x-pv-text" }, src.language()),
      h("p", { class: "x-pv-note" }, "Headlines in a language you pick, machine translated and labelled."),
    ],
  },
  {
    id: "designs",
    name: "Designs",
    tile: () => [art("designs"), title("Designs"), note(src.design())],
    screen: () => [
      art("designs"),
      h("h3", { class: "x-pv-title" }, "Designs"),
      h("p", { class: "x-pv-text" }, `Now: ${src.design()}`),
      h("p", { class: "x-pv-note" }, `${Object.values(THEMES).filter((t) => !t.experimental).length} looks for the map. Start opens the list.`),
    ],
  },
  {
    id: "about",
    name: "About",
    tile: () => [art("about"), title("About"), note("How this works")],
    screen: () => [
      art("about"),
      h("h3", { class: "x-pv-title" }, "How this works"),
      h("p", { class: "x-pv-text" }, "The day's news on a map, where it happened, and one word for the day, chosen by AI and shown with its reasons."),
    ],
  },
];

/** The word as its tile and its screen show it: label, word, date and "Chosen by AI" (decision 40). */
function wordBlock(big: boolean): Node[] {
  const w = src.word();
  if (!w) return [h("span", { class: "x-ch-kicker" }, "Today's word"), note("Loading the word...")];
  if ("none" in w) return [h("span", { class: "x-ch-kicker" }, w.date), title(w.none)];
  const word = h("span", { class: big ? "x-pv-word" : "x-ch-word-text" }, w.word);
  word.style.setProperty("--len", String(Math.max(4, w.word.length)));
  const sc = big ? src.scale() : null;
  // The tile keeps the date and the label on one line, so the word stays large under the tile's icon.
  if (!big) return [h("span", { class: "x-ch-kicker" }, w.kicker), word, h("span", { class: "x-ch-date" }, h("span", {}, `${w.date} ·`), " ", h("span", {}, "Chosen by AI"))];
  return [
    h("span", { class: "x-ch-kicker" }, w.kicker),
    word,
    h("span", { class: "x-ch-date" }, w.date),
    sc ? h("span", { class: "x-pv-scale" }, ...sc.steps.map((st, i) => h("span", { class: i === sc.on ? "on" : "" }, st))) : null,
    note("Chosen by AI"),
  ].filter((n): n is HTMLElement => !!n);
}

/** Opens a channel's screen from its tile; About's tile and every other one alike. */
function tile(id: Channel, label: string): HTMLButtonElement {
  const b = h("button", { type: "button", class: `x-ch x-ch-${id}`, "aria-label": id === "map" ? `${label}: ${SITE_NAME}` : undefined });
  b.addEventListener("click", () => openPreview(id));
  tiles.set(id, b);
  return b;
}

export function mountChannels(source: ChannelSource): void {
  src = source;
  tileCanvas = h("canvas", { class: "x-ch-preview", "aria-hidden": "true" });
  clock = h("span", { class: "x-clock-time" });
  dateLine = h("span", { class: "x-clock-date" });

  grid = h("div", { class: "x-home-grid" }, ...CHANNELS.map((c) => tile(c.id, c.name)));
  grid.addEventListener("keydown", arrows);

  const about = h("button", { type: "button", class: "x-round x-round-l", "aria-label": "About", title: "About" }, icon("about"));
  about.addEventListener("click", () => src.about());
  const go = h("button", { type: "button", class: "x-round x-round-r", "aria-label": "Open the map", title: "Open the map" }, icon("globe"));
  go.addEventListener("click", () => enter("map", tiles.get("map")!));

  // A channel's own screen, before Start: the map's live picture for the map channel, the channel's own page otherwise.
  pvCanvas = h("canvas", { class: "x-ch-preview", "aria-hidden": "true" });
  pvCrawl = h("div", { class: "x-pv-crawl" });
  pvMap = h("div", { class: "x-pv-map" }, pvCanvas, h("p", { class: "x-pv-name" }, h("b", {}, SITE_NAME), h("span", {}, SITE_TAGLINE)), pvCrawl);
  pvBody = h("div", { class: "x-pv-body" });
  pvName = h("h2", { class: "sr" });
  pvScreen = h("div", { class: "x-pv-screen" }, pvName, pvMap, pvBody);
  const prev = h("button", { type: "button", class: "x-pv-arrow x-pv-prev", "aria-label": "Channel before" }, icon("prev"));
  prev.addEventListener("click", () => step(-1));
  const next = h("button", { type: "button", class: "x-pv-arrow x-pv-next", "aria-label": "Channel after" }, icon("next"));
  next.addEventListener("click", () => step(1));
  const back = h("button", { type: "button", class: "x-pv-btn" }, "Menu");
  back.addEventListener("click", closePreview);
  pvStart = h("button", { type: "button", class: "x-pv-btn" }, "Start");
  pvStart.addEventListener("click", start);
  pv = h("section", { class: "x-pv", hidden: "" }, h("div", { class: "x-pv-stage" }, prev, pvScreen, next), h("div", { class: "x-pv-buttons" }, back, pvStart));
  // Left and right step through the channels, as the console's arrows did; Tab reaches Menu and Start.
  pv.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    step(e.key === "ArrowLeft" ? -1 : 1);
  });

  home = h(
    "dialog",
    { class: "x-home", "aria-label": "Home menu" },
    h("div", { class: "x-home-bg" }),
    h("div", { class: "x-home-scroll" }, grid),
    pv,
    h("div", { class: "x-home-bar" }, about, h("p", { class: "x-clock" }, clock, dateLine), go),
  );
  // Escape steps back: from a channel's screen to the grid, and from the grid into the map.
  home.addEventListener("cancel", (e) => {
    e.preventDefault();
    if (!pv.hidden) closePreview();
    else enter("map", tiles.get("map")!);
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

/** Fills the tiles, and the open channel's screen, from the day's file. Called when the screen opens and when the file arrives. */
export function refreshChannels(): void {
  if (!src || !home.open) return;
  for (const c of CHANNELS) tiles.get(c.id)!.replaceChildren(...c.tile());
  if (current) fillScreen(current);
  fillCrawl();
}

/** The newest headlines under the map channel's picture, twice over so the crawl loops without a gap. */
function fillCrawl() {
  const items = src.headlines();
  const row = () =>
    h("span", { class: "x-pv-row" }, ...items.map((it) => h("span", { class: "x-pv-item" }, h("b", {}, it.place), " ", it.title)));
  if (!items.length) pvCrawl.replaceChildren();
  else if (reduced) pvCrawl.replaceChildren(h("span", { class: "x-pv-item" }, h("b", {}, items[0]!.place), " ", items[0]!.title));
  else pvCrawl.replaceChildren(h("span", { class: "x-pv-track" }, row(), row()));
  pvCrawl.classList.toggle("still", reduced);
}

function fillScreen(id: Channel) {
  const c = CHANNELS.find((x) => x.id === id)!;
  current = id;
  pvName.textContent = c.name;
  pv.setAttribute("aria-label", c.name);
  pvMap.hidden = id !== "map";
  pvBody.hidden = id === "map";
  pvBody.replaceChildren(...c.screen());
  pvScreen.dataset.channel = id;
}

/**
 * A tile grows into its channel's own screen, the grid and the bar fade, and Menu and Start appear under it. Start
 * is focused, so Enter goes in.
 */
function openPreview(id: Channel) {
  if (leaving || !pv.hidden) return;
  const from = tiles.get(id)!.getBoundingClientRect();
  home.classList.add("previewing");
  pv.hidden = false;
  fillScreen(id);
  copyPreview();
  pvStart.focus({ preventScroll: true });
  if (reduced) return;
  pv.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: "ease-out" });
  fly(ghost(id === "map" ? 1 : 0), from, pvScreen.getBoundingClientRect(), true);
}

/** The channel before or after, wrapping round, the new screen sliding in from that side. */
function step(dir: -1 | 1) {
  if (leaving || pv.hidden || !current) return;
  const i = CHANNELS.findIndex((c) => c.id === current);
  fillScreen(CHANNELS[(i + dir + CHANNELS.length) % CHANNELS.length]!.id);
  copyPreview();
  if (!reduced) pvScreen.animate([{ transform: `translateX(${dir * 48}px)`, opacity: 0.2 }, { transform: "none", opacity: 1 }], { duration: 260, easing: "cubic-bezier(.2,.7,.3,1)" });
}

/** Back to the grid, the screen shrinking into its channel's tile. */
function closePreview() {
  if (leaving || pv.hidden) return;
  const from = pvScreen.getBoundingClientRect();
  const id = current ?? "map";
  pv.hidden = true;
  current = null;
  home.classList.remove("previewing");
  refreshChannels();
  const t = tiles.get(id)!;
  t.focus({ preventScroll: true });
  copyPreview();
  if (reduced) return;
  fly(ghost(id === "map" ? 1 : 0), from, t.getBoundingClientRect(), true);
}

/** Start: About opens over the menu; every other channel goes into the map at its part. */
function start() {
  if (!current) return;
  if (current === "about") return src.about();
  enter(current, pvScreen);
}

export function channelsOpen(): boolean {
  return !!home?.open;
}

/** Opens the home screen. From the map, the map shrinks into its tile while the grid fades in. */
export function showChannels(animate: boolean): void {
  if (!src || home.open) return;
  leaving = false;
  home.classList.remove("leaving", "previewing");
  pv.hidden = true;
  current = null;
  home.showModal();
  refreshChannels();
  copyPreview();
  startTimers();
  const mapTile = tiles.get("map")!;
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
 * Into the map: the chosen screen zooms down to the map's place on the page and turns into the map's picture,
 * while the menu fades away; then the copy fades and the map itself is there. Nothing moves for reduced motion.
 */
function enter(channel: Channel, from: HTMLElement) {
  if (leaving) return;
  const done = () => {
    leaving = false;
    current = null;
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

/** The map tile, or the channel's screen, is the map's own picture, copied a few times a second while it shows. */
function copyPreview() {
  const c = document.querySelector<HTMLCanvasElement>("#map canvas");
  if (!c?.width || !c.height) return;
  if (!pv.hidden && current !== "map") return;
  const preview = pv.hidden ? tileCanvas : pvCanvas;
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
  const all = [...grid.querySelectorAll<HTMLElement>("button.x-ch")];
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
  for (const t of all) {
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
