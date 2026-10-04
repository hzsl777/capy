// The Design picker (decision 131): a popover of cards instead of the browser's long dropdown. Each card shows the
// design's own sea, land, coast and marks, so a reader sees what a design looks like before choosing it; a search
// box and filter chips narrow the list; starred and recently used designs come first. Picking a card applies the
// design at once and leaves the popover open, so trying several is quick; Escape, the close button or a click
// outside closes it. On a phone it is a sheet from the bottom, and a sideways swipe on the masthead steps to the next
// or previous design. The select stays in the toolbar, as every design styles it, and shows the design on; it only
// opens this popover instead of its own list.
import { h } from "./dom.ts";
import { DESIGN_GROUPS, THEMES, designMenu, type ThemeId } from "../themes.ts";
import { rawPref, setPref } from "../pins.ts";

export type DesignPickerHost = {
  /** The design on now. */
  current: () => ThemeId;
  /** The designs the menu lists, the one on included even when it is an experiment. */
  ids: () => ThemeId[];
  /** Applies a design, as choosing it from the select did. */
  pick: (id: ThemeId) => void;
  /** Whether the page is laid out for a phone. */
  phone: () => boolean;
};

const RECENT_MAX = 6;
const STARS = "designStars";
const RECENT = "designRecent";

/** Saved lists of design ids, keeping only designs that exist. */
export function readIds(raw: string): ThemeId[] {
  const out: ThemeId[] = [];
  for (const id of raw.split(",")) if (id in THEMES && !out.includes(id as ThemeId)) out.push(id as ThemeId);
  return out;
}

/** The recent list after using `id`: it goes first, and the list keeps its newest few. */
export function withRecent(recent: readonly ThemeId[], id: ThemeId): ThemeId[] {
  return [id, ...recent.filter((r) => r !== id)].slice(0, RECENT_MAX);
}

/** Relative luminance of a #rrggbb colour, 0 to 1; anything else counts as mid grey. */
export function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0.5;
  const n = parseInt(m[1]!, 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/** Whether a design reads as dark: its sea and land together, as the map shows them. */
export function isDark(id: ThemeId): boolean {
  const t = THEMES[id];
  return (luminance(t.ocean) + luminance(t.land)) / 2 < 0.18;
}

/** The order the menu lists designs in, featured first: what the phone's swipe steps through. */
export function menuOrder(ids: ThemeId[]): ThemeId[] {
  return designMenu(ids).flatMap((g) => g.ids);
}

/** The design `step` places away in the menu's order, wrapping round at either end. */
export function stepDesign(ids: ThemeId[], current: ThemeId, step: number): ThemeId {
  const order = menuOrder(ids);
  const i = Math.max(0, order.indexOf(current));
  return order[(((i + step) % order.length) + order.length) % order.length]!;
}

type Filter = { label: string; test: (id: ThemeId) => boolean };

export function mountDesignPicker(select: HTMLSelectElement, host: DesignPickerHost): { open: () => void; close: () => void } {
  let stars = readIds(rawPref(STARS));
  let recent = readIds(rawPref(RECENT));
  let filter = "All";
  let query = "";
  let pop: HTMLElement | null = null;
  let grid: HTMLElement | null = null;
  let chipRow: HTMLElement | null = null;

  const groupOf = new Map<string, string>();
  for (const g of DESIGN_GROUPS) for (const id of g.ids) groupOf.set(id, g.label);
  const filters = (): Filter[] => [
    { label: "All", test: () => true },
    { label: "Starred", test: (id) => stars.includes(id) },
    { label: "Light", test: (id) => !isDark(id) },
    { label: "Dark", test: (id) => isDark(id) },
    ...DESIGN_GROUPS.map((g) => ({ label: g.label, test: (id: ThemeId) => groupOf.get(id) === g.label })),
  ];

  const swatch = (id: ThemeId): HTMLElement => {
    const t = THEMES[id];
    const land = h("span", { class: "dsw-land" });
    land.style.background = t.land;
    land.style.borderColor = t.coast;
    const isle = h("span", { class: "dsw-land dsw-isle" });
    isle.style.background = t.land;
    isle.style.borderColor = t.coast;
    const dot = h("span", { class: "dsw-dot" });
    dot.style.background = t.dot;
    dot.style.borderColor = t.dotStroke;
    const fresh = h("span", { class: "dsw-dot dsw-fresh" });
    fresh.style.background = t.fresh;
    fresh.style.borderColor = t.dotStroke;
    const sw = h("span", { class: "dsw", "aria-hidden": "true" }, land, isle, dot, fresh);
    sw.style.background = t.ocean;
    return sw;
  };

  // A picture of the design itself (decision 132): the whole page in its default view, made by scripts/thumbs.ts. Until
  // it loads, or if it is missing, the design's own sea, land and marks stand in.
  const picture = (id: ThemeId): HTMLElement => {
    const img = h("img", { class: "dthumb", src: `${import.meta.env.BASE_URL}thumbs/${id}.jpg`, alt: "", width: "320", height: "200", loading: "lazy", decoding: "async" }) as HTMLImageElement;
    img.addEventListener("error", () => img.replaceWith(swatch(id)), { once: true });
    return img;
  };

  const card = (id: ThemeId): HTMLElement => {
    const on = id === host.current();
    const pickBtn = h("button", { type: "button", class: "dcard-pick", "aria-pressed": String(on), "data-id": id }, picture(id), h("span", { class: "dcard-name" }, THEMES[id].label, on ? h("span", { class: "dcard-on" }, "On") : null));
    pickBtn.addEventListener("click", () => {
      recent = withRecent(recent, id);
      setPref(RECENT, recent.join(","));
      host.pick(id);
      render();
      grid?.querySelector<HTMLElement>(`[data-id="${id}"]`)?.focus();
    });
    // The star is its own wide button under the picture, never on it, so picking a design and starring it can't be
    // mistaken for each other.
    const starred = stars.includes(id);
    const star = h(
      "button",
      { type: "button", class: "dcard-star", "aria-pressed": String(starred), "aria-label": `${starred ? "Remove the star from" : "Star"} ${THEMES[id].label}` },
      h("span", { class: "dstar-icon", "aria-hidden": "true" }, starred ? "\u2605" : "\u2606"),
      h("span", {}, starred ? "Starred" : "Star"),
    );
    star.addEventListener("click", () => {
      stars = stars.includes(id) ? stars.filter((s) => s !== id) : [...stars, id];
      setPref(STARS, stars.join(","));
      render();
      grid?.querySelector<HTMLElement>(`[data-id="${id}"]`)?.parentElement?.querySelector<HTMLElement>(".dcard-star")?.focus();
    });
    return h("div", { class: on ? "dcard on" : "dcard" }, pickBtn, star);
  };

  const section = (label: string, ids: ThemeId[]): HTMLElement[] =>
    ids.length ? [h("h3", { class: "dgroup" }, label), h("div", { class: "dgrid", role: "group", "aria-label": label }, ...ids.map(card))] : [];

  function render() {
    if (!grid || !chipRow) return;
    const ids = host.ids();
    const f = filters().find((x) => x.label === filter) ?? filters()[0]!;
    chipRow.replaceChildren(
      ...filters()
        .filter((x) => x.label !== "Starred" || stars.length > 0)
        .map((x) => {
          const b = h("button", { type: "button", class: "chip", "aria-pressed": String(x.label === f.label) }, x.label);
          b.addEventListener("click", () => {
            filter = x.label;
            render();
          });
          return b;
        }),
    );
    const q = query.trim().toLowerCase();
    if (q || f.label !== "All") {
      // A search or a filter shows one flat list, in the menu's order.
      const hits = menuOrder(ids).filter((id) => f.test(id) && (!q || THEMES[id].label.toLowerCase().includes(q) || (groupOf.get(id) ?? "").toLowerCase().includes(q)));
      grid.replaceChildren(...(hits.length ? section(`${hits.length} ${hits.length === 1 ? "design" : "designs"}`, hits) : [h("p", { class: "muted dnone" }, "No design matches.")]));
      return;
    }
    const have = new Set(ids);
    const starred = stars.filter((id) => have.has(id));
    const recentOnly = recent.filter((id) => have.has(id) && !starred.includes(id));
    grid.replaceChildren(
      ...section("Starred", starred),
      ...section("Recently used", recentOnly),
      ...designMenu(ids).flatMap((g) => section(g.label, g.ids)),
    );
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      select.focus();
      return;
    }
    // Arrow keys move between the cards in reading order.
    if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(e.key) || !grid) return;
    const cards = [...grid.querySelectorAll<HTMLElement>(".dcard-pick")];
    const at = cards.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    e.preventDefault();
    const cols = Math.max(1, Math.round(grid.querySelector(".dgrid")!.clientWidth / (cards[0]!.parentElement!.offsetWidth || 1)));
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "ArrowDown" ? cols : -cols;
    cards[Math.min(cards.length - 1, Math.max(0, at + step))]!.focus();
  };
  const onOutside = (e: PointerEvent) => {
    if (pop && !pop.contains(e.target as Node) && !select.closest(".pick")!.contains(e.target as Node)) close();
  };
  const place = () => {
    if (!pop) return;
    if (host.phone()) {
      pop.classList.add("sheet");
      pop.style.left = pop.style.top = "";
      return;
    }
    pop.classList.remove("sheet");
    const r = select.getBoundingClientRect();
    const w = pop.offsetWidth;
    pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`;
    // Under the select, or over it when the select sits low (Dual Screen's shell) and there is more room above.
    const below = innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const down = below >= 360 || below >= above;
    const room = Math.max(160, Math.min(640, down ? below : above));
    pop.style.maxHeight = `${room}px`;
    pop.style.top = down ? `${r.bottom + 4}px` : `${Math.max(8, r.top - 4 - Math.min(pop.scrollHeight, room))}px`;
  };

  function open() {
    if (pop) return;
    const search = h("input", { type: "search", class: "dsearch", placeholder: "Search designs", "aria-label": "Search designs", value: query }) as HTMLInputElement;
    search.addEventListener("input", () => {
      query = search.value;
      render();
    });
    const closeBtn = h("button", { type: "button", class: "dclose", "aria-label": "Close" }, "×");
    closeBtn.addEventListener("click", () => {
      close();
      select.focus();
    });
    chipRow = h("div", { class: "chips dchips" });
    grid = h("div", { class: "dbody" });
    pop = h(
      "div",
      { id: "design-pop", class: "menu-body", role: "dialog", "aria-label": "Designs" },
      // The title, search and filters stay at the top while the cards scroll under them.
      h("div", { class: "dtop" }, h("div", { class: "dhead" }, h("h2", { class: "dtitle" }, "Designs"), search, closeBtn), chipRow),
      grid,
      host.phone() ? h("p", { class: "muted dtip" }, "Swipe the masthead sideways to change design.") : null,
    );
    document.body.appendChild(pop);
    render();
    place();
    select.setAttribute("aria-expanded", "true");
    pop.addEventListener("keydown", onKey);
    addEventListener("pointerdown", onOutside, true);
    addEventListener("resize", place);
    // The card on now, so Enter keeps it and the arrows start from it.
    (grid.querySelector<HTMLElement>('.dcard-pick[aria-pressed="true"]') ?? search).focus({ preventScroll: true });
    grid.querySelector('.dcard-pick[aria-pressed="true"]')?.scrollIntoView({ block: "nearest" });
  }

  function close() {
    if (!pop) return;
    pop.remove();
    pop = grid = chipRow = null;
    select.setAttribute("aria-expanded", "false");
    removeEventListener("pointerdown", onOutside, true);
    removeEventListener("resize", place);
  }

  // The select opens the popover instead of its own list: a press on it, or Enter, Space or Alt+Down on the keyboard.
  select.setAttribute("aria-haspopup", "dialog");
  select.setAttribute("aria-expanded", "false");
  const label = select.closest(".pick") as HTMLElement;
  label.addEventListener("click", (e) => {
    e.preventDefault();
    if (pop) close();
    else open();
  });
  select.addEventListener("mousedown", (e) => e.preventDefault());
  select.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " " || (e.altKey && e.key === "ArrowDown") || e.key === "F4") {
      e.preventDefault();
      open();
    }
  });
  // Typing a letter into the closed select still changes it; the recent list notes the design.
  select.addEventListener("change", () => {
    recent = withRecent(recent, select.value as ThemeId);
    setPref(RECENT, recent.join(","));
  });

  // A sideways swipe on the phone's masthead steps through the designs in the menu's order.
  const mast = document.getElementById("masthead");
  let start: { x: number; y: number; t: number } | null = null;
  mast?.addEventListener(
    "touchstart",
    (e) => {
      start = host.phone() && e.touches.length === 1 ? { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY, t: e.timeStamp } : null;
    },
    { passive: true },
  );
  mast?.addEventListener(
    "touchend",
    (e) => {
      if (!start) return;
      const t = e.changedTouches[0]!;
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      const quick = e.timeStamp - start.t < 700;
      start = null;
      if (!quick || Math.abs(dx) < 60 || Math.abs(dy) > 40) return;
      const next = stepDesign(host.ids(), host.current(), dx < 0 ? 1 : -1);
      recent = withRecent(recent, next);
      setPref(RECENT, recent.join(","));
      host.pick(next);
      toast(THEMES[next].label);
    },
    { passive: true },
  );

  return { open, close };
}

/** A short note of the design a swipe changed to, read out to screen readers too. */
function toast(text: string) {
  const el = document.getElementById("design-toast") ?? document.body.appendChild(h("p", { id: "design-toast", role: "status", "aria-live": "polite" }));
  el.textContent = text;
  el.classList.remove("show");
  void el.offsetWidth;
  el.classList.add("show");
}
