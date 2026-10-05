// Notebook (id paper, experimental): the panel and the About dialog are notebook pages that turn instead of scrolling.
// Whatever the panel shows (a place's stories, a story, the word's view, an event's explanation) is laid out in columns
// exactly one page wide and as tall as the panel, so text that does not fit one page flows on to the next and nothing
// is ever cut off; the panel shows one column at a time. A page turns with the Next and Previous buttons at its foot,
// a tap or click on the page's right or left side, a swipe, or the arrow and Page Up and Page Down keys. Each turn
// swings the page on its binding (the page goes edge-on, the next one swings back in, in a quarter of a second, with
// no change of colour or opacity, none at all for reduced motion), and the foot says "Page 2 of 3".
//
// Every other design never sees any of this: the parts are hidden by the stylesheet and the pages switch themselves
// off, so the panel scrolls as before. Lists keep their order (newest first); pages only cut them where a page ends.

import { FLIP_MS, flipFrames } from "../map/paper.ts";
import { h } from "./dom.ts";

const on = () => document.documentElement.dataset.theme === "paper";
const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

const SVG = "http://www.w3.org/2000/svg";

/** An outline chevron of our own, pointing back (left) or on (right). */
function chevron(dir: -1 | 1): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "pp-icon");
  const p = document.createElementNS(SVG, "path");
  p.setAttribute("d", dir < 0 ? "M10 3 L5 8 L10 13" : "M6 3 L11 8 L6 13");
  p.setAttribute("fill", "none");
  p.setAttribute("stroke", "currentColor");
  p.setAttribute("stroke-width", "1.6");
  p.setAttribute("stroke-linecap", "round");
  p.setAttribute("stroke-linejoin", "round");
  svg.append(p);
  return svg;
}

/** The foot of a paged view: Previous, "Page 2 of 3", Next. */
class PagerBar {
  readonly el: HTMLElement;
  private prev: HTMLButtonElement;
  private next: HTMLButtonElement;
  private label: HTMLElement;

  constructor(name: string, turn: (by: -1 | 1) => void) {
    this.prev = h("button", { type: "button", class: "pp-turn pp-prev", "aria-label": `Previous page of ${name}` }, chevron(-1) as unknown as Node, h("span", {}, "Previous"));
    this.next = h("button", { type: "button", class: "pp-turn pp-next", "aria-label": `Next page of ${name}` }, h("span", {}, "Next"), chevron(1) as unknown as Node);
    this.label = h("span", { class: "pp-count", "aria-live": "polite" }, "Page 1 of 1");
    this.prev.addEventListener("click", () => turn(-1));
    this.next.addEventListener("click", () => turn(1));
    this.el = h("nav", { class: "pp-pager", "aria-label": `Pages of ${name}` }, this.prev, this.label, this.next);
  }

  set(page: number, count: number) {
    this.label.textContent = `Page ${page + 1} of ${count}`;
    this.prev.disabled = page <= 0;
    this.next.disabled = page >= count - 1;
  }
}

/**
 * One paged box: the element laid out in columns one page wide (style.css gives it the columns, with a gap as wide
 * as its left and right padding together, so a page is exactly the box's own width), shown a page at a time by
 * scrolling it sideways. It can't be scrolled by hand; only a turn, a link inside it or focus moves it, and the page
 * always snaps whole.
 */
class Pages {
  page = 0;
  count = 1;
  private sign = "";
  private timer = 0;
  private anim: Animation | null = null;
  private turning = false;
  private queued = 0;
  readonly bar: PagerBar;

  constructor(
    readonly box: () => HTMLElement | null,
    name: string,
    /** The element that swings during a page turn. */
    private readonly face: () => HTMLElement | null,
    /** What identifies the view on show, so a redraw of the same view keeps its page and a new view starts at 1. */
    private readonly signature: () => string,
    /** Whether the box is paged at all just now (the panel isn't while it frames an outlet's page). */
    private readonly active: () => boolean = () => true,
  ) {
    this.bar = new PagerBar(name, (by) => this.turn(by));
  }

  private step(): number {
    return this.box()?.clientWidth ?? 0;
  }

  /** The page a node sits on, from where its first line falls among the columns. */
  pageOf(node: Element): number {
    const el = this.box();
    const step = this.step();
    if (!el || !step) return 0;
    const r = node.getClientRects()[0] ?? node.getBoundingClientRect();
    const x = r.left - el.getBoundingClientRect().left + el.scrollLeft;
    return Math.max(0, Math.min(this.count - 1, Math.floor((x + 1) / step)));
  }

  /** Counts the pages again (after new content, a resize, a font or an image) and keeps the page on show whole. */
  measure() {
    const el = this.box();
    if (!el) return;
    if (!on() || !this.active()) {
      this.page = 0;
      this.count = 1;
      el.scrollLeft = 0;
      this.bar.set(0, 1);
      return;
    }
    const sign = this.signature();
    if (sign !== this.sign) {
      this.sign = sign;
      this.page = 0;
    }
    const step = this.step();
    // The last column ends a padding short of a whole page, which rounding up takes care of.
    this.count = step ? Math.max(1, Math.ceil(el.scrollWidth / step - 0.02)) : 1;
    this.page = Math.min(this.page, this.count - 1);
    this.show();
  }

  private show() {
    const el = this.box();
    if (!el) return;
    this.turning = true;
    el.scrollLeft = this.page * this.step();
    this.bar.set(this.page, this.count);
    // Scroll events from our own move arrive after this; they find the page already whole.
    requestAnimationFrame(() => (this.turning = false));
  }

  /** Goes to a page, with the page's swing unless the reader asked for reduced motion. */
  go(page: number, refresh = true) {
    const target = Math.max(0, Math.min(this.count - 1, page));
    if (target === this.page) return;
    this.anim?.cancel();
    clearTimeout(this.timer);
    const face = this.face();
    if (!refresh || reduced() || !face || typeof face.animate !== "function") {
      this.page = target;
      this.show();
      return;
    }
    // Forward, the page swings on its left edge, the binding; back, on its right. It is edge-on at the middle, where
    // the new page takes its place and swings back in.
    const forward = target > this.page;
    face.style.transformOrigin = forward ? "0% 50%" : "100% 50%";
    this.anim = face.animate(flipFrames(forward), { duration: FLIP_MS, easing: "linear" });
    this.timer = window.setTimeout(() => {
      this.page = target;
      this.show();
    }, FLIP_MS / 2);
  }

  turn(by: -1 | 1) {
    // Several quick presses still turn one page each, after the turn already under way.
    if (this.anim && this.anim.playState === "running") {
      this.queued += by;
      this.anim.onfinish = () => {
        const q = this.queued;
        this.queued = 0;
        if (q) this.go(this.page + Math.sign(q), true);
      };
      return;
    }
    this.go(this.page + by);
  }

  /** After the browser scrolled the box itself (focus moved inside it, a link inside it): snap to a whole page. */
  snap() {
    const el = this.box();
    if (!el || this.turning || !on() || !this.active()) return;
    const step = this.step();
    if (!step) return;
    const active = document.activeElement;
    this.page = active && el.contains(active) && active !== el ? this.pageOf(active) : Math.round(el.scrollLeft / step);
    this.page = Math.max(0, Math.min(this.count - 1, this.page));
    this.show();
  }
}

/**
 * Turns a page from a tap, a click or a swipe on it: the right side goes on, the left side back. Never when the tap
 * lands on something that does its own thing (a story, a link, a button), or ends a text selection.
 */
function bindTouch(pages: Pages, el: HTMLElement) {
  let start: { x: number; y: number; id: number } | null = null;
  let swiped = false;
  el.addEventListener("pointerdown", (e) => {
    if (!on() || e.pointerType === "mouse") return;
    start = { x: e.clientX, y: e.clientY, id: e.pointerId };
    swiped = false;
  });
  el.addEventListener("pointerup", (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    start = null;
    if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      swiped = true;
      pages.turn(dx < 0 ? 1 : -1);
    }
  });
  el.addEventListener("pointercancel", () => (start = null));
  el.addEventListener(
    "click",
    (e) => {
      if (!on()) return;
      // A swipe that ended on a story turned the page; it doesn't open the story too.
      if (swiped) {
        swiped = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const target = e.target as Element;
      // A citation goes to its source's page with the same page turn, instead of the browser sliding the columns.
      const cite = target.closest<HTMLAnchorElement>("a.cite");
      if (cite) {
        const dest = document.getElementById(decodeURIComponent((cite.getAttribute("href") ?? "").slice(1)));
        if (dest && el.contains(dest)) {
          e.preventDefault();
          e.stopPropagation();
          pages.go(pages.pageOf(dest));
        }
        return;
      }
      if (target.closest("a, button, input, select, textarea, summary, label, iframe, details, [tabindex]:not(.panel)")) return;
      if (!(getSelection()?.isCollapsed ?? true)) return;
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      if (x > 0.6) pages.turn(1);
      else if (x < 0.4) pages.turn(-1);
    },
    true,
  );
}

let panelPages: Pages | null = null;
let aboutPages: Pages | null = null;

/**
 * Wraps the About dialog's text in a paged box with its own foot while the design is on, and unwraps it after. Its
 * title and the close button stay above the pages as a running head, so no page's text runs under the button.
 */
function syncAbout() {
  const dialog = document.getElementById("about") as HTMLDialogElement | null;
  if (!dialog || !aboutPages) return;
  const box = dialog.querySelector<HTMLElement>(":scope > .pp-pages");
  const head = dialog.querySelector<HTMLElement>(":scope > .pp-head");
  if (on() && !box) {
    const close = dialog.querySelector(":scope > form");
    const title = dialog.querySelector(":scope > h2");
    const top = h("div", { class: "pp-head" }, title, close);
    const wrap = h("div", { class: "pp-pages" });
    for (const n of [...dialog.childNodes]) wrap.append(n);
    dialog.append(top, wrap, aboutPages.bar.el);
    bindTouch(aboutPages, wrap);
    new ResizeObserver(() => aboutPages?.measure()).observe(wrap);
  } else if (!on() && box) {
    // Back in the page's own order: the close button, the title, then the text.
    const close = head?.querySelector(":scope > form");
    const title = head?.querySelector(":scope > h2");
    dialog.append(...[close, title].filter((n): n is Element => !!n), ...box.childNodes);
    head?.remove();
    box.remove();
    aboutPages.bar.el.remove();
  }
}

/** Sets up the pages once; they switch on and off with the design. */
export function mountPaper() {
  const panel = document.getElementById("panel");
  const about = document.getElementById("about") as HTMLDialogElement | null;
  if (!panel) return;
  panelPages = new Pages(
    () => panel,
    "the panel",
    () => panel,
    () => `${panel.className}|${panel.querySelector("h2")?.textContent ?? ""}|${panel.firstElementChild?.className ?? ""}`,
    () => !panel.classList.contains("framed"),
  );
  const pp = panelPages;
  panel.after(pp.bar.el);
  bindTouch(pp, panel);

  let soon = 0;
  const later = () => {
    cancelAnimationFrame(soon);
    soon = requestAnimationFrame(() => pp.measure());
  };
  new MutationObserver(later).observe(panel, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class"] });
  new ResizeObserver(later).observe(panel);
  // A lead image or a web font arriving changes how much fits on a page.
  panel.addEventListener("load", later, true);
  document.fonts?.addEventListener?.("loadingdone", later);
  panel.addEventListener("scroll", () => requestAnimationFrame(() => pp.snap()));

  if (about) {
    aboutPages = new Pages(
      () => about.querySelector<HTMLElement>(":scope > .pp-pages"),
      "About",
      () => about.querySelector<HTMLElement>(":scope > .pp-pages"),
      () => (about.open ? "open" : "closed"),
    );
    const ap = aboutPages;
    // The dialog lays out only once it opens; each opening starts at its first page.
    new MutationObserver(() => requestAnimationFrame(() => ap.measure())).observe(about, { attributes: true, attributeFilter: ["open"] });
    about.addEventListener("scroll", () => requestAnimationFrame(() => ap.snap()), true);
  }

  const sync = () => {
    syncAbout();
    later();
    aboutPages?.measure();
  };
  new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  sync();

  document.addEventListener("keydown", (e) => {
    if (!on() || e.altKey || e.ctrlKey || e.metaKey) return;
    const by = e.key === "ArrowRight" || e.key === "PageDown" ? 1 : e.key === "ArrowLeft" || e.key === "PageUp" ? -1 : 0;
    if (!by) return;
    const target = e.target as Element;
    // Fields, the map (whose arrows move it) and open menus keep their own keys.
    if (target.closest("input, textarea, select, canvas, details[open], [contenteditable]")) return;
    const pages = about?.open ? aboutPages : document.querySelector("dialog[open]") ? null : panelPages;
    if (!pages) return;
    e.preventDefault();
    pages.turn(by);
  });
}
