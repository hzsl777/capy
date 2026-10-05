// Desktop 95: the site as a mid-1990s desktop, after the feel only. No maker's or product's name,
// logo, sounds, icons or menu wording: the icons are our own pixel drawings and the menu button carries the site's name.
//
// A teal desktop of windows. The site's own elements move into window frames while the design is on and go back to
// their places when another design is picked, so main.ts renders exactly as in every design:
// - the map in a large window, with the Map or Globe choice and a button for the reports in a bar under its title,
//   and the time bar (Replay, the slider, Live) as its status bar;
// - the panel in a Reports window, or in the word's window while it shows the word's view or an explanation opened
//   from it, so the word reads as a window of its own;
// - the Key, Topics and Pinned in small windows; the Design menu and Translate in dialog boxes; About as a help window
//   (the page's own modal dialog, given a title bar);
// - the word, its date and "Chosen by AI" in a small window fixed at the top of the desktop.
// Windows move by their title bar, come to the front when touched, minimise to the taskbar and come back, maximise
// and close (closing the map only minimises it). A taskbar along the bottom holds a menu button, a button per open
// window and a tray with a clock and the date; icons on the desktop open the same things on a double-click or a tap.
// On a phone every window opens full screen, one at a time, under the word, and nothing needs dragging.
// Text goes in as text, never as HTML. Nothing here animates.

import { SITE_NAME } from "../brand.ts";
import type { ThemeId } from "../themes.ts";
import { h } from "./dom.ts";

export interface DesktopSource {
  theme(): ThemeId;
  /** Whether the panel shows the word's view, or an explanation opened from it. */
  wordView(): boolean;
  openWord(): void;
  /** Leaves the word's view, so the panel shows the place again. */
  closeWord(): void;
  /** Opens or closes the map's Key as the page knows it (its button's state). */
  setKey(open: boolean): void;
  replay(): void;
  about(): void;
}

type WinId = "map" | "reports" | "word" | "key" | "topics" | "pins" | "translate" | "designs";
export type Icon = "globe" | "word" | "reports" | "topics" | "key" | "pins" | "replay" | "translate" | "designs" | "about";
/** What the menu and the desktop icons open. */
type Launch = WinId | "replay" | "about";

interface Win {
  id: WinId;
  el: HTMLElement;
  titleText: HTMLElement;
  body: HTMLElement;
  task: HTMLButtonElement;
  maxBtn: HTMLButtonElement | null;
  label: string;
  icon: Icon;
  state: "closed" | "open" | "min";
  max: boolean;
  dialog: boolean;
  /** Has had a place on the desktop; the first opening sets one. */
  placed: boolean;
}

const NS = "http://www.w3.org/2000/svg";
/** Phones show one window at a time; asked for once the desktop mounts, so the drawings load anywhere (tests). */
let phone: MediaQueryList;

/** The sixteen-colour palette's letters for the pixel drawings. */
const INK: Record<string, string> = {
  k: "#000000",
  w: "#ffffff",
  s: "#c0c0c0",
  g: "#808080",
  n: "#000080",
  b: "#0000ff",
  G: "#008000",
  L: "#00ff00",
  y: "#ffff00",
  o: "#808000",
  r: "#ff0000",
  m: "#800000",
  t: "#008080",
};

/** Our own 16 by 16 pixel drawings, one letter per pixel ("." is clear). */
export const ICONS: Record<Icon, readonly string[]> = {
  globe: [
    "....kkkkkkkk....",
    "..kkbbbbbbbbkk..",
    ".kbbbGGbbbbbbbk.",
    ".kbbGGGGbbbbGbk.",
    "kbbbGGGGGbbGGbbk",
    "kbbbbGGGbbbGGGbk",
    "kbbbbbGGbbbbGGbk",
    "kbbbbbbGbbbbbbbk",
    "kbbbbbbbbbGGbbbk",
    "kbbbbbbbbGGGGbbk",
    "kbbbbbbbbbGGGbbk",
    "kbbbbbbbbbbGbbbk",
    ".kbbbbbbbbbbbbk.",
    ".kbbbbbbbbbbbbk.",
    "..kkbbbbbbbbkk..",
    "....kkkkkkkk....",
  ],
  // A card with the word as a bold bar and the five-step scale under it.
  word: [
    "................",
    "................",
    "................",
    "kkkkkkkkkkkkkkkk",
    "knnnnnnnnnnnnnnk",
    "kwwwwwwwwwwwwwwk",
    "kwwkkkkkkkkkkwwk",
    "kwwkkkkkkkkkkwwk",
    "kwwwwwwwwwwwwwwk",
    "kwwggssrrssggwwk",
    "kwwggssrrssggwwk",
    "kwwwwwwwwwwwwwwk",
    "kkkkkkkkkkkkkkkk",
    "................",
    "................",
    "................",
  ],
  // A page of news over the page behind it: a headline, a picture and lines of text.
  reports: [
    "..kkkkkkkkkkk...",
    "..kwwwwwwwwwkk..",
    "..kwkkkkkkkwkwk.",
    "..kwwwwwwwwwkwk.",
    "..kwssswnnnwkwk.",
    "..kwwwwwnnnwkwk.",
    "..kwssswnnnwkwk.",
    "..kwwwwwwwwwkwk.",
    "..kwssssssswkwk.",
    "..kwwwwwwwwwkwk.",
    "..kwssssssswkwk.",
    "..kwwwwwwwwwkwk.",
    "..kwssssssswkwk.",
    "..kwwwwwwwwwkwk.",
    "..kkkkkkkkkkkwk.",
    "....kkkkkkkkkkk.",
  ],
  // Three topic chips, the first one on.
  topics: [
    "................",
    "................",
    ".kkkkkkkkkk.....",
    ".kbbbbbbbbk.....",
    ".kbwwwwwbbk.....",
    ".kbbbbbbbbk.....",
    ".kkkkkkkkkk.....",
    "....kkkkkkkkkkk.",
    "....kwwwwwwwwwk.",
    "....kwsssssswwk.",
    "....kwwwwwwwwwk.",
    "....kkkkkkkkkkk.",
    ".kkkkkkkkk......",
    ".kwwwwwwwk......",
    ".kkkkkkkkk......",
    "................",
  ],
  // The key's three marks, hollow, filled and fresh, each with its line.
  key: [
    "................",
    "kkkkkkkkkkkkkkkk",
    "kwwwwwwwwwwwwwwk",
    "kwkkkwwwwwwwwwwk",
    "kwkwkwssssssswwk",
    "kwkkkwwwwwwwwwwk",
    "kwwwwwwwwwwwwwwk",
    "kwkkkwwwwwwwwwwk",
    "kwkkkwssssssswwk",
    "kwkkkwwwwwwwwwwk",
    "kwwwwwwwwwwwwwwk",
    "kwrrrwwwwwwwwwwk",
    "kwrrrwssssssswwk",
    "kwrrrwwwwwwwwwwk",
    "kwwwwwwwwwwwwwwk",
    "kkkkkkkkkkkkkkkk",
  ],
  pins: [
    "................",
    ".....kkkkk......",
    "....krrrrrk.....",
    "...krrwrrrrk....",
    "...krwrrrrrk....",
    "...krrrrrrrk....",
    "....krrrrrk.....",
    ".....kmmmk......",
    "......kmk.......",
    "......kgk.......",
    "......kgk.......",
    ".......g........",
    ".......g........",
    ".......g........",
    "................",
    "................",
  ],
  // A clock face: Replay runs back through the day.
  replay: [
    "................",
    ".....kkkkkk.....",
    "...kkwwwwwwkk...",
    "..kwwwwkwwwwwk..",
    ".kwwwwwkwwwwwwk.",
    ".kwwwwwkwwwwwwk.",
    "kwwwwwwkwwwwwwwk",
    "kwwwwwwkkkkkwwwk",
    "kwwwwwwwwwwwwwwk",
    "kwwwwwwwwwwwwwwk",
    ".kwwwwwwwwwwwwk.",
    ".kwwwwwwwwwwwwk.",
    "..kwwwwwwwwwwk..",
    "...kkwwwwwwkk...",
    ".....kkkkkk.....",
    "................",
  ],
  // Two notes, one over the other: the same lines in two languages.
  translate: [
    "................",
    "kkkkkkkkkk......",
    "kwwwwwwwwk......",
    "kwnnnnnnwk......",
    "kwwwwwwwwk......",
    "kwnnnnwwwk......",
    "kwwwwkkkkkkkkkk.",
    "kkwkkkyyyyyyyyk.",
    "..k..kykkkkkkyk.",
    ".....kyyyyyyyyk.",
    ".....kykkkkyyyk.",
    ".....kyyyyyyyyk.",
    ".....kkkkkkkkkk.",
    "............kk..",
    "................",
    "................",
  ],
  // A painter's palette with four colours.
  designs: [
    "................",
    ".....kkkkkk.....",
    "...kkssssssskk..",
    "..ksrrssbbsssk..",
    ".kssrrssbbssssk.",
    ".kssssssssyysk..",
    "kssGGsssssyyssk.",
    "kssGGsssssssssk.",
    "kssssskkkssssk..",
    "kssssk...ksssk..",
    "ksssssk..ksssk..",
    ".kssssskkssssk..",
    "..ksssssssssk...",
    "...kkkkkkkkkk...",
    "................",
    "................",
  ],
  // A round sign with a bar and a dot: how this works.
  about: [
    "................",
    ".....kkkkkk.....",
    "...kknnnnnnkk...",
    "..knnnnwwnnnnk..",
    ".knnnnnwwnnnnnk.",
    ".knnnnnnnnnnnnk.",
    "knnnnnwwwnnnnnnk",
    "knnnnnnwwnnnnnnk",
    "knnnnnnwwnnnnnnk",
    "knnnnnnwwnnnnnnk",
    ".knnnnnwwnnnnnk.",
    ".knnnnwwwwnnnnk.",
    "..knnnnnnnnnnk..",
    "...kknnnnnnkk...",
    ".....kkkkkk.....",
    "................",
  ],
};

/** The title bar's buttons, 8 by 7 pixels. */
export const GLYPHS: Record<"min" | "max" | "restore" | "close", readonly string[]> = {
  min: ["........", "........", "........", "........", "........", "kkkkkk..", "kkkkkk.."],
  max: ["kkkkkkkk", "kkkkkkkk", "k......k", "k......k", "k......k", "k......k", "kkkkkkkk"],
  restore: ["..kkkkkk", "..kkkkkk", "..k....k", "kkkkkk.k", "kkkkkkkk", "k....k..", "kkkkkk.."],
  close: ["kk....kk", ".kk..kk.", "..kkkk..", "...kk...", "..kkkk..", ".kk..kk.", "kk....kk"],
};

/** A pixel drawing as an SVG of one rectangle per run of a colour in a row. */
export function pixelSvg(rows: readonly string[], cls: string): SVGSVGElement {
  const w = rows[0]?.length ?? 0;
  const s = document.createElementNS(NS, "svg");
  s.setAttribute("viewBox", `0 0 ${w} ${rows.length}`);
  s.setAttribute("class", cls);
  s.setAttribute("aria-hidden", "true");
  s.setAttribute("shape-rendering", "crispEdges");
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x]!;
      let end = x + 1;
      while (end < row.length && row[end] === ch) end++;
      const fill = ch === "k" && cls.includes("dk-glyph") ? "currentColor" : INK[ch];
      if (fill) {
        const r = document.createElementNS(NS, "rect");
        r.setAttribute("x", String(x));
        r.setAttribute("y", String(y));
        r.setAttribute("width", String(end - x));
        r.setAttribute("height", "1");
        r.setAttribute("fill", fill);
        s.append(r);
      }
      x = end;
    }
  });
  return s;
}

const iconSvg = (kind: Icon, cls = "dk-ico") => pixelSvg(ICONS[kind], cls);

/** What the menu and the desktop icons list, in order; Pinned and Translate only when they have something. */
const LAUNCHERS: readonly { id: Launch; label: string; icon: Icon }[] = [
  { id: "map", label: "Map", icon: "globe" },
  { id: "word", label: "Today's word", icon: "word" },
  { id: "reports", label: "Reports", icon: "reports" },
  { id: "topics", label: "Topics", icon: "topics" },
  { id: "key", label: "Key", icon: "key" },
  { id: "pins", label: "Pinned", icon: "pins" },
  { id: "replay", label: "Replay", icon: "replay" },
  { id: "translate", label: "Translate", icon: "translate" },
  { id: "designs", label: "Designs", icon: "designs" },
  { id: "about", label: "About", icon: "about" },
];

let src: DesktopSource;
let active = false;
let built = false;
let desk: HTMLElement;
let icons: HTMLElement;
let strip: HTMLElement;
let stripTitle: HTMLElement;
let taskbar: HTMLElement;
let tasks: HTMLElement;
let menu: HTMLElement;
let menuBtn: HTMLButtonElement;
let clock: HTMLElement;
let dateEl: HTMLElement;
let reportsBtn: HTMLButtonElement;
let aboutBar: HTMLElement | null = null;
let clockTimer = 0;
let z = 10;
let front: Win | null = null;
/** The reports window was open when the word's view took the panel, so it comes back when the word closes. */
let reportsHeld = false;
const wins = new Map<WinId, Win>();
/** Where each moved element came from: a marker left in its place. */
const homes: { el: Element; mark: Comment }[] = [];
const observers: MutationObserver[] = [];
let stripSize: ResizeObserver | null = null;

const $ = (id: string) => document.getElementById(id);

function button(cls: string, label: string, ...children: (Node | string)[]): HTMLButtonElement {
  return h("button", { type: "button", class: cls, "aria-label": label, title: label }, ...children);
}

/** Moves an element into a window, leaving a marker where it was so it can go back. */
function adopt(el: Element | null, into: HTMLElement) {
  if (!el) return;
  const mark = document.createComment("desktop");
  el.before(mark);
  homes.push({ el, mark });
  into.append(el);
}

function makeWin(id: WinId, label: string, icon: Icon, opts: { dialog?: boolean; noMax?: boolean } = {}): Win {
  const titleText = h("span", { class: "dk-title-text", id: `dk-title-${id}` }, label);
  const minBtn = button("dk-tbtn dk-min", "Minimise", pixelSvg(GLYPHS.min, "dk-glyph"));
  const maxBtn = opts.dialog || opts.noMax ? null : button("dk-tbtn dk-max", "Maximise", pixelSvg(GLYPHS.max, "dk-glyph"));
  const closeBtn = button("dk-tbtn dk-close", id === "map" ? "Close (minimises the map)" : "Close", pixelSvg(GLYPHS.close, "dk-glyph"));
  const bar = h(
    "div",
    { class: "dk-title" },
    iconSvg(icon, "dk-ico dk-ico-small"),
    titleText,
    h("span", { class: "dk-tbtns" }, ...(opts.dialog ? [] : [minBtn]), ...(maxBtn ? [maxBtn] : []), closeBtn),
  );
  const body = h("div", { class: "dk-body" });
  const el = h("section", { class: `dk-win dk-win-${id}${opts.dialog ? " dk-dialog" : ""}`, "aria-labelledby": `dk-title-${id}`, tabindex: "-1", hidden: "" }, bar, body);
  const task = h("button", { type: "button", class: "dk-task" }, iconSvg(icon, "dk-ico dk-ico-small"), h("span", { class: "dk-task-label" }, label));
  const win: Win = { id, el, titleText, body, task, maxBtn, label, icon, state: "closed", max: false, dialog: !!opts.dialog, placed: false };
  minBtn.addEventListener("click", () => minimise(win));
  maxBtn?.addEventListener("click", () => setMax(win, !win.max));
  closeBtn.addEventListener("click", () => close(win));
  task.addEventListener("click", () => {
    if (win.state === "min") restore(win);
    else if (front === win) minimise(win);
    else raise(win);
  });
  el.addEventListener("pointerdown", () => raise(win), true);
  el.addEventListener("focusin", () => raise(win));
  bar.addEventListener("dblclick", (e) => {
    if (win.maxBtn && !(e.target as Element).closest("button")) setMax(win, !win.max);
  });
  dragBy(bar, win);
  wins.set(id, win);
  desk.append(el);
  return win;
}

/** Moving a window by its title bar; never on a phone, where windows fill the screen, nor while maximised. */
function dragBy(bar: HTMLElement, win: Win) {
  let start: { x: number; y: number; left: number; top: number } | null = null;
  bar.addEventListener("pointerdown", (e) => {
    if (phone.matches || win.max || e.button !== 0 || (e.target as Element).closest("button")) return;
    start = { x: e.clientX, y: e.clientY, left: win.el.offsetLeft, top: win.el.offsetTop };
    bar.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  bar.addEventListener("pointermove", (e) => {
    if (!start) return;
    place(win, start.left + e.clientX - start.x, start.top + e.clientY - start.y);
  });
  const end = () => (start = null);
  bar.addEventListener("pointerup", end);
  bar.addEventListener("pointercancel", end);
}

/** Puts a window at a point, kept where its title bar can still be reached. */
function place(win: Win, left: number, top: number, width?: number, height?: number) {
  const s = win.el.style;
  if (width !== undefined) s.width = `${Math.round(width)}px`;
  if (height !== undefined) s.height = `${Math.round(height)}px`;
  const dw = desk.clientWidth, dh = desk.clientHeight;
  const w = win.el.offsetWidth || width || 200;
  const minTop = workTop();
  s.left = `${Math.round(Math.min(Math.max(left, 64 - w), dw - 64))}px`;
  s.top = `${Math.round(Math.min(Math.max(top, minTop), dh - 28))}px`;
}

/** The top of the work area: under the word's window. */
function workTop(): number {
  return strip.offsetTop + strip.offsetHeight + 8;
}

/** The first place a window opens at on a wide screen, fitted to the desktop. */
function firstPlace(win: Win) {
  const dw = desk.clientWidth, dh = desk.clientHeight;
  const top = workTop();
  const left = Math.min(104, Math.max(8, dw * 0.08));
  const reportsW = Math.min(440, Math.max(300, dw * 0.3));
  const mapW = Math.max(320, dw - left - reportsW - 24);
  const tall = Math.max(240, dh - top - 8);
  const at = (x: number, y: number, w: number, hgt?: number) => place(win, x, y, Math.min(w, dw - 16), hgt === undefined ? undefined : Math.min(hgt, dh - top - 8));
  switch (win.id) {
    case "map":
      return at(left, top, mapW, tall);
    case "reports":
      return at(dw - reportsW - 8, top, reportsW, tall);
    case "word":
      return at(Math.max(left + 40, dw - reportsW - 8 - 140), top + 18, Math.min(560, reportsW + 140), tall - 18);
    case "key":
      return at(left + 24, Math.max(top, top + tall - 330), 300, 320);
    case "topics":
      return at(left + 48, top + 48, 340, 300);
    case "pins":
      return at(left + 80, top + 80, 320, 280);
    default:
      // A dialog box takes the height its text needs, a little above the middle.
      return at((dw - Math.min(400, dw - 16)) / 2, top + Math.max(0, (dh - top) / 2 - 160), 400);
  }
}

function raise(win: Win) {
  if (front === win && win.el.style.zIndex) return;
  win.el.style.zIndex = String(++z);
  front = win;
  syncActive();
}

function syncActive() {
  for (const w of wins.values()) {
    const on = w === front && w.state === "open";
    w.el.classList.toggle("dk-active", on);
    w.task.setAttribute("aria-pressed", String(on));
  }
}

/** The top window still showing, for when the front one goes. */
function nextFront(): Win | null {
  let best: Win | null = null;
  for (const w of wins.values()) if (w.state === "open" && (!best || Number(w.el.style.zIndex) > Number(best.el.style.zIndex))) best = w;
  return best;
}

function open(win: Win, focus = false) {
  if (win.state === "closed") tasks.append(win.task);
  win.state = "open";
  win.el.hidden = false;
  if (!win.placed) {
    win.placed = true;
    if (!phone.matches) firstPlace(win);
  }
  raise(win);
  if (focus) win.el.focus({ preventScroll: true });
}

function restore(win: Win) {
  open(win, true);
}

function minimise(win: Win) {
  if (win.state !== "open") return;
  win.state = "min";
  win.el.hidden = true;
  if (front === win) front = nextFront();
  syncActive();
}

function close(win: Win) {
  if (win.id === "map") return minimise(win);
  if (win.id === "word") {
    // Leaving the word's view hands the panel back to the reports window (placePanel).
    src.closeWord();
    return;
  }
  hide(win);
  if (win.id === "key") src.setKey(false);
}

function hide(win: Win) {
  win.state = "closed";
  win.el.hidden = true;
  win.task.remove();
  if (front === win) front = nextFront();
  syncActive();
}

function setMax(win: Win, on: boolean) {
  if (!win.maxBtn) return;
  win.max = on;
  win.el.classList.toggle("dk-maxed", on);
  win.maxBtn.replaceChildren(pixelSvg(on ? GLYPHS.restore : GLYPHS.max, "dk-glyph"));
  win.maxBtn.setAttribute("aria-label", on ? "Restore" : "Maximise");
  win.maxBtn.title = on ? "Restore" : "Maximise";
}

/** Opens what a menu entry or desktop icon names. */
function launch(id: Launch) {
  closeMenu();
  if (id === "about") return src.about();
  if (id === "replay") {
    restore(wins.get("map")!);
    src.replay();
    return;
  }
  if (id === "word") {
    if (!src.wordView()) src.openWord();
    const w = wins.get("word")!;
    if (src.wordView()) restore(w);
    return;
  }
  if (id === "reports" && src.wordView()) src.closeWord();
  if (id === "key") src.setKey(true);
  restore(wins.get(id)!);
}

// ---- the panel: the reports window, or the word's -----------------------------------

/** Puts the panel in the window its view belongs to and names that window after what it shows. */
function placePanel() {
  const panel = $("panel");
  if (!panel) return;
  const reports = wins.get("reports")!, word = wins.get("word")!;
  const toWord = src.wordView();
  const target = toWord ? word : reports;
  if (panel.parentElement !== target.body) {
    target.body.append(panel);
    if (toWord) {
      reportsHeld = reports.state !== "closed";
      if (reportsHeld) hide(reports);
      open(word);
    } else {
      if (word.state !== "closed") hide(word);
      if (reportsHeld) open(reports);
      reportsHeld = false;
    }
  }
  // The window's title says what the panel shows: the word's view, an explanation, a story, or a place.
  const text = (sel: string) => panel.querySelector(sel)?.textContent?.trim() ?? "";
  if (toWord) word.titleText.textContent = panel.querySelector(".event-view") ? "Explanation and sources" : `How the word was chosen`;
  else {
    const name = text(".place-name");
    reports.titleText.textContent = panel.querySelector(".reader") ? "Story" : name || text(".panel-title") || "Reports";
  }
  // The map's bar names the place its reports button opens.
  const place = !toWord && !panel.querySelector(".reader") ? text(".place-name") : "";
  reportsBtn.lastElementChild!.textContent = place ? `Reports: ${place}` : "Reports";
}

// ---- the taskbar ---------------------------------------------------------------------

function menuItems(): HTMLElement[] {
  return LAUNCHERS.filter((l) => available(l.id)).map((l) => {
    const b = h("button", { type: "button", class: "dk-menu-item", role: "menuitem" }, iconSvg(l.icon), h("span", {}, l.label));
    b.addEventListener("click", () => launch(l.id));
    return b;
  });
}

/** Pinned shows once something is pinned, and Translate once the day has a story in a known language. */
function available(id: Launch): boolean {
  if (id === "pins") return !$("pins-menu")?.hidden;
  if (id === "translate") return !$("translate-pick")?.hidden;
  return true;
}

function openMenu() {
  menu.replaceChildren(...menuItems());
  menu.hidden = false;
  menuBtn.setAttribute("aria-expanded", "true");
  menu.querySelector<HTMLElement>("button")?.focus();
}

function closeMenu() {
  if (menu.hidden) return;
  menu.hidden = true;
  menuBtn.setAttribute("aria-expanded", "false");
}

let iconsFor = "";
function renderIcons() {
  const key = LAUNCHERS.filter((l) => available(l.id)).map((l) => l.id).join();
  if (key === iconsFor && icons.childElementCount) return;
  iconsFor = key;
  icons.replaceChildren(
    ...LAUNCHERS.filter((l) => available(l.id)).map((l) => {
      const b = h("button", { type: "button", class: "dk-icon" }, iconSvg(l.icon, "dk-ico dk-ico-big"), h("span", { class: "dk-icon-label" }, l.label));
      // A double-click opens, as on the old desktops; a tap, a pen or the keyboard opens at once.
      b.addEventListener("click", (e) => {
        if (e.detail === 0 || (e as PointerEvent).pointerType !== "mouse") launch(l.id);
        else {
          for (const other of icons.children) other.classList.remove("dk-picked");
          b.classList.add("dk-picked");
        }
      });
      b.addEventListener("dblclick", () => launch(l.id));
      return b;
    }),
  );
}

function tick() {
  const now = new Date();
  clock.textContent = now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  dateEl.textContent = now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  clock.parentElement!.setAttribute("title", now.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" }));
  clearTimeout(clockTimer);
  // Next at the turn of the minute, and only while the design shows.
  if (active) clockTimer = window.setTimeout(tick, 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 50);
}

// ---- building and taking down ---------------------------------------------------------

function build() {
  built = true;
  desk = h("div", { class: "dk-desk" });
  icons = h("nav", { class: "dk-icons", "aria-label": "Desktop" });
  stripTitle = h("span", { class: "dk-title-text", id: "dk-title-strip" }, "Today's Word");
  strip = h("section", { class: "dk-win dk-strip", "aria-labelledby": "dk-title-strip" }, h("div", { class: "dk-title" }, iconSvg("word", "dk-ico dk-ico-small"), stripTitle), h("div", { class: "dk-body" }));
  desk.append(icons, strip);

  menuBtn = h("button", { type: "button", class: "dk-menu-btn", "aria-haspopup": "menu", "aria-expanded": "false" }, iconSvg("globe", "dk-ico dk-ico-small"), h("span", {}, SITE_NAME));
  menu = h("div", { class: "dk-menu", role: "menu", "aria-label": SITE_NAME, hidden: "" });
  menuBtn.addEventListener("click", () => (menu.hidden ? openMenu() : closeMenu()));
  menu.addEventListener("keydown", (e) => {
    const items = [...menu.querySelectorAll<HTMLElement>("button")];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    } else if (e.key === "Escape") {
      closeMenu();
      menuBtn.focus();
    }
  });
  tasks = h("div", { class: "dk-tasks", role: "group", "aria-label": "Open windows" });
  clock = h("span", { class: "dk-clock" });
  dateEl = h("span", { class: "dk-date" });
  taskbar = h("div", { class: "dk-taskbar" }, menuBtn, tasks, h("div", { class: "dk-tray" }, clock, dateEl), menu);

  makeWin("map", SITE_NAME, "globe");
  makeWin("reports", "Reports", "reports");
  makeWin("word", "How the word was chosen", "word");
  makeWin("key", "Map key", "key", { noMax: true });
  makeWin("topics", "Topics", "topics", { noMax: true });
  makeWin("pins", "Pinned places", "pins", { noMax: true });
  makeWin("translate", "Translate", "translate", { dialog: true });
  makeWin("designs", "Designs", "designs", { dialog: true });
  wins.get("map")!.task.querySelector(".dk-task-label")!.textContent = "Map";

  reportsBtn = h("button", { type: "button", class: "dk-button dk-reports-btn" }, iconSvg("reports", "dk-ico dk-ico-small"), h("span", {}, "Reports"));
  reportsBtn.addEventListener("click", () => launch("reports"));

  // Outside clicks close the menu; the map's Key button opens the Key's window instead of a pop-up.
  desk.addEventListener(
    "click",
    (e) => {
      const target = e.target as Element;
      if (target.closest("#key-btn")) {
        e.stopPropagation();
        launch("key");
      } else if (target.closest(".telegram-word, .note-link")) {
        // The word opens its window, even one minimised; the page renders the view first.
        setTimeout(() => {
          if (src.wordView()) restore(wins.get("word")!);
        });
      }
    },
    true,
  );
  document.addEventListener("pointerdown", (e) => {
    if (active && !menu.hidden && !e.composedPath().some((n) => n === menu || n === menuBtn)) closeMenu();
  });
  window.addEventListener("resize", () => {
    if (!active || phone.matches) return;
    // Keep every window's title bar on the desktop.
    for (const w of wins.values()) if (w.placed) place(w, w.el.offsetLeft, w.el.offsetTop);
  });
}

/** OK and a line under a dialog's control. */
function dialogBody(win: Win, intro: string, ...rest: (Node | null)[]) {
  const ok = h("button", { type: "button", class: "dk-button dk-ok" }, "OK");
  ok.addEventListener("click", () => close(win));
  win.body.append(h("div", { class: "dk-dialog-row" }, iconSvg(win.icon, "dk-ico dk-ico-big"), h("div", { class: "dk-dialog-text" }, h("p", {}, intro), ...rest)), h("div", { class: "dk-dialog-buttons" }, ok));
}

function activate() {
  if (!built) build();
  active = true;
  document.body.append(desk, taskbar);
  const map = wins.get("map")!;
  const bar = h("div", { class: "dk-menubar" });
  map.body.append(bar);
  adopt($("view-select")?.closest(".pick") ?? null, bar);
  // Find a place sits in the map window's menu bar with Map or Globe.
  adopt($("search-btn"), bar);
  bar.append(reportsBtn);
  adopt($("banner"), map.body);
  adopt($("map"), map.body);
  adopt(document.querySelector(".timebar"), map.body);
  adopt($("telegram"), strip.querySelector<HTMLElement>(".dk-body")!);
  adopt($("key-pop"), wins.get("key")!.body);
  adopt($("topics"), wins.get("topics")!.body);
  adopt($("pins"), wins.get("pins")!.body);
  const tr = wins.get("translate")!;
  dialogBody(tr, "Show headlines in another language. Machine translations are labelled and can be wrong.");
  adopt($("translate-pick"), tr.body.querySelector<HTMLElement>(".dk-dialog-text")!);
  tr.body.querySelector(".dk-dialog-text")!.append(h("p", { class: "dk-none" }, "Nothing to translate yet."));
  const ds = wins.get("designs")!;
  dialogBody(ds, "Choose how the site looks. Your choice is kept in this browser.");
  adopt($("design-select")?.closest(".pick") ?? null, ds.body.querySelector<HTMLElement>(".dk-dialog-text")!);
  // The word's view and the reports share the panel; it starts in the reports window.
  wins.get("reports")!.body.append($("panel")!);

  // About becomes a help window: a title bar of our own over the page's dialog.
  const about = $("about") as HTMLDialogElement | null;
  if (about) {
    const closeBtn = button("dk-tbtn dk-close", "Close", pixelSvg(GLYPHS.close, "dk-glyph"));
    closeBtn.addEventListener("click", () => about.close());
    aboutBar = h("div", { class: "dk-title dk-about-title" }, iconSvg("about", "dk-ico dk-ico-small"), h("span", { class: "dk-title-text" }, `${SITE_NAME} Help`), h("span", { class: "dk-tbtns" }, closeBtn));
    about.prepend(aboutBar);
  }

  observers.push(new MutationObserver(placePanel));
  observers[observers.length - 1]!.observe($("panel")!, { childList: true, subtree: true });
  const stripTitleSync = () => {
    stripTitle.textContent = $("telegram")?.querySelector(".telegram-kicker")?.textContent?.trim() || "The word";
  };
  observers.push(new MutationObserver(stripTitleSync));
  observers[observers.length - 1]!.observe($("telegram")!, { childList: true, subtree: true });
  // Pinned and Translate come and go with the day's data.
  observers.push(new MutationObserver(renderIcons));
  for (const id of ["pins-menu", "translate-pick"]) {
    const el = $(id);
    if (el) observers[observers.length - 1]!.observe(el, { attributes: true, attributeFilter: ["hidden"] });
  }
  stripSize = new ResizeObserver(() => {
    desk.style.setProperty("--dk-top", `${workTop()}px`);
    // The word arrives after the first paint and its window grows: windows under it step down to stay clear of it.
    if (phone.matches) return;
    const top = workTop();
    for (const w of wins.values()) {
      if (!w.placed || w.el.offsetTop >= top) continue;
      const bottom = w.el.offsetTop + w.el.offsetHeight;
      place(w, w.el.offsetLeft, top, undefined, Math.max(160, Math.min(w.el.offsetHeight, bottom - top)));
    }
  });
  stripSize.observe(strip);
  desk.style.setProperty("--dk-top", `${workTop()}px`);

  renderIcons();
  stripTitleSync();
  open(map);
  // A phone shows one window at a time: the map first, the reports a tap away.
  if (!phone.matches) open(wins.get("reports")!);
  else wins.get("reports")!.placed = true;
  placePanel();
  raise(map);
  tick();
}

function deactivate() {
  active = false;
  clearTimeout(clockTimer);
  closeMenu();
  for (const o of observers) o.disconnect();
  observers.length = 0;
  stripSize?.disconnect();
  stripSize = null;
  // Everything back where it came from, the last moved first, so neighbours land in order.
  const panel = $("panel");
  const keyPop = $("key-pop");
  for (const { el, mark } of homes.reverse()) {
    mark.replaceWith(el);
  }
  homes.length = 0;
  // The panel goes back beside the map, before the key.
  if (panel && keyPop) keyPop.before(panel);
  aboutBar?.remove();
  aboutBar = null;
  const about = $("about");
  if (about) about.style.translate = "";
  for (const w of wins.values()) {
    hide(w);
    w.body.replaceChildren();
    w.placed = false;
    setMax(w, false);
  }
  reportsHeld = false;
  front = null;
  desk.remove();
  taskbar.remove();
}

/** Turns the desktop on or off to match the design on show. */
function sync() {
  const on = src.theme() === "desktop";
  if (on && !active) activate();
  else if (!on && active) deactivate();
}

export function mountDesktop(source: DesktopSource) {
  src = source;
  phone = window.matchMedia("(max-width: 760px)");
  new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  phone.addEventListener("change", () => {
    if (!active) return;
    // A wide screen places windows that opened full screen on a phone.
    if (!phone.matches) for (const w of wins.values()) if (w.state !== "closed") firstPlace(w);
  });
  sync();
}
