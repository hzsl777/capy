// Postcards: the tuned place's panel is a postcard from the shop's wire rack. Its front is a picture
// of our own (sky, sea and land, never a real landmark or a flag) under the place's name in big lettering of our own,
// the city's name only; its back is the panel's own stories, typed on the ruled left side in the panel's own order,
// with a stamp of our own design (a globe, no country, no value) and a round postmark with the name and the date on
// the right. The Turn button, or a tap on the picture, turns the card over.
//
// When the tuned place changes, the next card slides out of the rack picture side up and, after a moment, turns over
// to its stories by itself, so the stories never need a tap. A reader who asks for reduced motion gets the stories
// side at once and no slide or turn. Timing is in src/map/postcard.ts, where the test checks it against the no-flash
// limit. Everything here is text through h() or SVG built with createElementNS; nothing goes in as HTML.

import { FLIP_MS, HOLD_MS } from "../map/postcard.ts";
import { h } from "./dom.ts";

export interface Postcard {
  /** Which places the card is for: their ids, so the same place keeps its card and its side. */
  key: string;
  /** The front's lettering: the place's name, or "3 places" for nearby places merged at this zoom. */
  title: string;
  /** Every place's name, for a merged card's front. */
  names: string[];
  /** The panel's own dateline (the name, the count and the Pin button) and its lists, as built for every design. */
  head: HTMLElement;
  body: HTMLElement[];
  /** The time the postmark dates, unix seconds: the newest report's. */
  when: number;
}

type Side = "front" | "back";

let shown = "";
let side: Side = "back";
let timer = 0;
let current: HTMLElement | null = null;

const reduce = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
const still = () => !!reduce?.matches;

const SVG = "http://www.w3.org/2000/svg";
function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, ...kids: (SVGElement | string)[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const k of kids) el.append(k);
  return el;
}

/** A fixed number in [0, 1) from text, so a place's picture is the same on every visit. It means nothing. */
function hashOf(text: string, salt: number): number {
  let x = 2166136261 ^ salt;
  for (let i = 0; i < text.length; i++) x = Math.imul(x ^ text.charCodeAt(i), 16777619);
  return ((x >>> 0) % 10007) / 10007;
}

/**
 * The front's picture: a flat printed band of sky, a low sun with its glow, clouds, a far ridge, the sea with its
 * wave marks, a sandy shore and a green headland, and a small sailing boat. Only the shapes vary from place to place,
 * by a fixed hash of its id, so no picture says anything about a place; the colours never change.
 */
function scene(key: string): SVGSVGElement {
  const r = (n: number) => hashOf(key, n);
  const W = 300, H = 200;
  const sunX = 70 + r(1) * 160;
  const ridge = (() => {
    const a = 96 + r(2) * 14, b = 88 + r(3) * 18, c = 100 + r(4) * 10;
    return `M0 ${a} C 60 ${b - 10}, 110 ${b + 6}, 160 ${b} S 260 ${c - 12}, 300 ${c} L300 126 L0 126 Z`;
  })();
  const left = r(5) < 0.5;
  const head = left
    ? `M0 128 C 40 ${108 - r(6) * 16}, 86 ${112 - r(7) * 12}, 120 140 C 132 156, 118 178, 0 186 Z`
    : `M300 128 C 260 ${108 - r(6) * 16}, 214 ${112 - r(7) * 12}, 180 140 C 168 156, 182 178, 300 186 Z`;
  const shore = left ? "M0 170 C 60 160, 150 176, 210 200 L0 200 Z" : "M300 170 C 240 160, 150 176, 90 200 L300 200 Z";
  const boatX = left ? 190 + r(8) * 60 : 40 + r(8) * 60;
  const waves: SVGElement[] = [];
  for (let i = 0; i < 9; i++) {
    const x = (i * 37 + r(9) * 30) % 280, y = 134 + ((i * 11) % 34);
    waves.push(s("path", { d: `M${x} ${y} q 5 -3 10 0 t 10 0`, class: "pc-wave" }));
  }
  const cloud = (x: number, y: number, k: number) =>
    s("path", { class: "pc-cloud", d: `M${x} ${y} c ${4 * k} ${-8 * k}, ${14 * k} ${-8 * k}, ${18 * k} ${-2 * k} c ${4 * k} ${-6 * k}, ${14 * k} ${-4 * k}, ${14 * k} ${2 * k} c ${6 * k} 0, ${8 * k} ${6 * k}, 0 ${6 * k} h ${-30 * k} c ${-6 * k} 0, ${-6 * k} ${-6 * k}, ${-2 * k} ${-6 * k} z` });
  return s(
    "svg",
    { class: "pc-scene", viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "xMidYMax slice", "aria-hidden": "true", focusable: "false" },
    s("rect", { class: "pc-sky", width: W, height: H }),
    s("circle", { class: "pc-glow", cx: sunX, cy: 92, r: 44 }),
    s("circle", { class: "pc-sun", cx: sunX, cy: 92, r: 17 }),
    cloud(30 + r(10) * 60, 40 + r(11) * 16, 1.1),
    cloud(170 + r(12) * 80, 30 + r(13) * 18, 0.85),
    s("path", { class: "pc-ridge", d: ridge }),
    s("rect", { class: "pc-sea", y: 124, width: W, height: 76 }),
    ...waves,
    s("path", { class: "pc-sand", d: shore }),
    s("path", { class: "pc-cape", d: head }),
    s("path", { class: "pc-boat", d: `M${boatX} 146 h 22 l -4 6 h -14 z M${boatX + 11} 144 v -22 l 10 20 z M${boatX + 9} 144 l -9 -2 l 9 -16 z` }),
    s("path", { class: "pc-birds", d: `M${sunX + 40} 60 q 4 -4 8 0 q 4 -4 8 0 M${sunX + 58} 50 q 3 -3 6 0 q 3 -3 6 0` }),
  );
}

/** A stamp of our own: a perforated edge round a small picture of a globe. No country, no value, no words. */
function stamp(): SVGSVGElement {
  // The perforations: small bites out of every edge, at an even pitch.
  const W = 60, H = 72, p = 6, b = 2.1;
  let d = `M0 0`;
  for (let x = 0; x < W; x += p) d += ` L${x + p / 2 - b} 0 A ${b} ${b} 0 0 0 ${x + p / 2 + b} 0 L${x + p} 0`;
  for (let y = 0; y < H; y += p) d += ` L${W} ${y + p / 2 - b} A ${b} ${b} 0 0 0 ${W} ${y + p / 2 + b} L${W} ${y + p}`;
  for (let x = W; x > 0; x -= p) d += ` L${x - p / 2 + b} ${H} A ${b} ${b} 0 0 0 ${x - p / 2 - b} ${H} L${x - p} ${H}`;
  for (let y = H; y > 0; y -= p) d += ` L0 ${y - p / 2 + b} A ${b} ${b} 0 0 0 0 ${y - p / 2 - b} L0 ${y - p}`;
  return s(
    "svg",
    { class: "pc-stamp", viewBox: `-2 -2 ${W + 4} ${H + 4}`, "aria-hidden": "true", focusable: "false" },
    s("path", { class: "pc-stamp-paper", d: d + " Z" }),
    s("rect", { class: "pc-stamp-frame", x: 6, y: 6, width: W - 12, height: H - 12 }),
    s("circle", { class: "pc-stamp-globe", cx: W / 2, cy: H / 2 - 2, r: 15 }),
    s("ellipse", { class: "pc-stamp-line", cx: W / 2, cy: H / 2 - 2, rx: 6, ry: 15 }),
    s("path", { class: "pc-stamp-line", d: `M${W / 2 - 15} ${H / 2 - 2} h 30 M${W / 2} ${H / 2 - 17} v 30 M${W / 2 - 13} ${H / 2 - 9} h 26 M${W / 2 - 13} ${H / 2 + 5} h 26` }),
    s("path", { class: "pc-stamp-line", d: `M12 ${H - 14} q 9 -5 18 0 t 18 0` }),
  );
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** The postmark: a ring with the place's name round its top, the date across the middle, and wavy cancel lines. */
function postmark(title: string, when: number): SVGSVGElement {
  const d = new Date(when * 1000);
  const date = `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  const name = title.toUpperCase();
  const id = `pc-arc-${Math.round(hashOf(title, 7) * 1e6)}`;
  // Courier's capitals are about 0.6 em wide; past what the arc holds, the name is fitted to it.
  const arc = Math.PI * 34;
  const est = name.length * 9 * 0.62;
  const text = s("textPath", { href: `#${id}`, startOffset: "50%" }, name);
  if (est > arc * 0.86) {
    text.setAttribute("textLength", String(Math.round(arc * 0.86)));
    text.setAttribute("lengthAdjust", "spacingAndGlyphs");
  }
  return s(
    "svg",
    { class: "pc-postmark", viewBox: "0 0 150 100", "aria-hidden": "true", focusable: "false" },
    s("path", { class: "pc-cancel", d: "M92 30 q 7 -5 14 0 t 14 0 t 14 0 t 14 0 M92 44 q 7 -5 14 0 t 14 0 t 14 0 t 14 0 M92 58 q 7 -5 14 0 t 14 0 t 14 0 t 14 0 M92 72 q 7 -5 14 0 t 14 0 t 14 0 t 14 0" }),
    s("circle", { class: "pc-ring", cx: 50, cy: 50, r: 46 }),
    s("defs", {}, s("path", { id, d: "M 16 50 A 34 34 0 0 1 84 50" })),
    s("text", { class: "pc-mark-name", "text-anchor": "middle" }, text),
    s("path", { class: "pc-ring thin", d: "M 14 40 h 72 M 14 62 h 72" }),
    s("text", { class: "pc-mark-date", x: 50, y: 55, "text-anchor": "middle", textLength: 64, lengthAdjust: "spacingAndGlyphs" }, date),
  );
}

function apply(card: HTMLElement, animate: boolean) {
  const front = card.querySelector<HTMLElement>(".pc-front");
  const back = card.querySelector<HTMLElement>(".pc-back");
  const turn = card.querySelector<HTMLButtonElement>(".pc-turn");
  if (!front || !back || !turn) return;
  card.dataset.side = side;
  // Only the side facing the reader can be reached by a keyboard or a screen reader.
  front.inert = side !== "front";
  back.inert = side !== "back";
  // A phone shows the short label, over the card's corner.
  turn.replaceChildren(h("span", { class: "pc-wide" }, side === "front" ? "Read the stories" : "See the picture"), h("span", { class: "pc-narrow" }, "Turn over"));
  turn.setAttribute("aria-label", side === "front" ? "Turn the card over to its stories" : "Turn the card over to its picture");
  // Once the picture is up, the stories' side steps out of the layout, so a long list leaves no empty card below.
  delete card.dataset.rest;
  if (side === "front") {
    const rest = () => {
      if (current === card && side === "front") card.dataset.rest = "front";
    };
    if (animate && !still()) window.setTimeout(rest, FLIP_MS);
    else rest();
  }
}

function turnTo(next: Side) {
  clearTimeout(timer);
  side = next;
  if (current?.isConnected) apply(current, true);
}

/** Builds the tuned place's postcard into the panel. Called whenever the panel shows a place. */
export function renderPostcard(panel: HTMLElement, c: Postcard) {
  const fresh = c.key !== shown;
  if (fresh) {
    shown = c.key;
    clearTimeout(timer);
    if (still()) side = "back";
    else {
      side = "front";
      const key = c.key;
      timer = window.setTimeout(() => {
        if (shown === key && side === "front") turnTo("back");
      }, HOLD_MS);
    }
  }
  const lettering = h("span", { class: "pc-name", "data-name": c.title }, c.title);
  // The lettering's size follows the longest word, so a long name still fits the card without being cut.
  const longest = Math.max(4, ...c.title.split(/\s+/).map((w) => [...w].length));
  lettering.style.setProperty("--len", String(longest));
  const front = h(
    "button",
    { type: "button", class: "pc-front", "aria-label": `${c.title}: turn the card over to its stories` },
    scene(c.key),
    h("span", { class: "pc-front-in" }, lettering, c.names.length > 1 ? h("span", { class: "pc-names" }, c.names.join(" · ")) : null),
  );
  front.addEventListener("click", () => {
    turnTo("back");
    // The picture can no longer be reached once it faces away, so the keyboard stays on the card's Turn button.
    current?.querySelector<HTMLElement>(".pc-turn")?.focus({ preventScroll: true });
  });
  const back = h(
    "section",
    { class: "pc-back", "aria-label": "Stories" },
    h("p", { class: "pc-printed", "aria-hidden": "true" }, "Post card"),
    h("div", { class: "pc-head" }, c.head),
    h("div", { class: "pc-addr", "aria-hidden": "true" }, stamp(), postmark(c.title, c.when), h("span", { class: "pc-line" }), h("span", { class: "pc-line" }), h("span", { class: "pc-line" })),
    h("div", { class: "pc-msg" }, ...c.body),
  );
  const turn = h("button", { type: "button", class: "tool pc-turn" }, "");
  turn.addEventListener("click", () => turnTo(side === "front" ? "back" : "front"));
  const card = h(
    "div",
    { class: `pc${fresh && !still() ? " pc-in" : ""}` },
    h("div", { class: "pc-bar" }, h("span", { class: "pc-label" }, "Postcard"), turn),
    h("div", { class: "pc-card" }, h("div", { class: "pc-flip" }, front, back)),
  );
  current = card;
  apply(card, false);
  panel.replaceChildren(card);
}
