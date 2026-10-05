// Find a place: the control in the toolbar (or the masthead's corner on a phone), the popover it opens and its keys.
// The popover is a `.menu-body` on the page, set in place by script like the Design picker's, so every design's own menu
// look applies and no design's clipping or transforms can hide it. What it matches is src/search.ts. The names of the
// towns in tiles not loaded yet come from one small file, fetched the first time search opens and never before.
import type { MapFile } from "../types.ts";
import { entriesFromFile, entriesFromNames, MAX_RESULTS, namesUrl, reportsLabel, searchPlaces, tellApart, type PlaceEntry } from "../search.ts";
import { h } from "./dom.ts";

export type SearchHost = {
  file: () => MapFile | null;
  tiered: () => boolean;
  /** The places the page holds, by id, so a town the names index repeats is listed once. */
  known: () => ReadonlyMap<string, number>;
  phone: () => boolean;
  dataBase: string;
  /** The reader chose a place: fly there and show its panel. */
  pick: (place: PlaceEntry) => void;
};

const NS = "http://www.w3.org/2000/svg";

/** A magnifier of our own, drawn with the text colour, so every design's button colours it. */
function glass(): SVGSVGElement {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "search-glass");
  const ring = document.createElementNS(NS, "circle");
  ring.setAttribute("cx", "6.5");
  ring.setAttribute("cy", "6.5");
  ring.setAttribute("r", "4.6");
  const handle = document.createElementNS(NS, "path");
  handle.setAttribute("d", "M10 10 L14.2 14.2");
  for (const el of [ring, handle]) {
    el.setAttribute("fill", "none");
    el.setAttribute("stroke", "currentColor");
    el.setAttribute("stroke-width", "1.8");
    el.setAttribute("stroke-linecap", "round");
  }
  svg.append(ring, handle);
  return svg;
}

export function mountSearch(host: SearchHost) {
  const triggers = ["search-btn", "search-icon"].map((id) => document.getElementById(id) as HTMLButtonElement | null).filter((b): b is HTMLButtonElement => !!b);
  if (!triggers.length) return { open() {}, close() {} };
  // The toolbar's button (a label and the glass) and the masthead's corner icon (the glass alone).
  for (const b of triggers) {
    b.prepend(glass());
    b.setAttribute("aria-haspopup", "dialog");
    b.setAttribute("aria-expanded", "false");
    b.setAttribute("aria-controls", "search-pop");
    b.setAttribute("aria-keyshortcuts", "/");
  }

  let pop: HTMLElement | null = null;
  let input: HTMLInputElement;
  let list: HTMLElement;
  let note: HTMLElement;
  let shown: PlaceEntry[] = [];
  let active = 0;
  let from: HTMLElement | null = null;

  // ---- what can be found --------------------------------------------------------------------------------------------
  let fileKey = "";
  let fromFile: PlaceEntry[] = [];
  let names: PlaceEntry[] | null = null;
  let loading = false;
  let failed = false;
  let combined: PlaceEntry[] = [];
  let combinedFor: unknown[] = [];

  /** The day's places and, once loaded, the names index's towns; rebuilt only when tiles or the index have changed what is there. */
  function entries(): PlaceEntry[] {
    const file = host.file();
    if (!file) return [];
    const key = `${file.places.length}:${file.items.length}`;
    if (key !== fileKey) {
      fileKey = key;
      fromFile = entriesFromFile(file, host.tiered());
    }
    if (combinedFor[0] !== fromFile || combinedFor[1] !== names) {
      combinedFor = [fromFile, names];
      combined = names ? fromFile.concat(names) : fromFile;
    }
    return combined;
  }

  /** The names index, asked for once search is opened. A failed load is tried again the next time it opens. */
  function loadNames() {
    const url = namesUrl(host.dataBase, host.file()?.local);
    if (!url || names || loading) return;
    loading = true;
    failed = false;
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json();
      })
      .then((json) => {
        names = entriesFromNames(json);
      })
      .catch(() => {
        failed = true;
      })
      .finally(() => {
        loading = false;
        if (pop) render();
      });
  }

  // ---- the popover --------------------------------------------------------------------------------------------------
  /** The button the reader can see: the toolbar's, or the corner icon on a phone. */
  const anchor = (): HTMLElement => triggers.find((b) => b.getClientRects().length > 0) ?? triggers[0]!;

  function place() {
    if (!pop) return;
    const phone = host.phone();
    pop.classList.toggle("sheet", phone);
    const s = pop.style;
    s.position = "fixed";
    s.right = s.bottom = "auto";
    s.transform = "none";
    if (phone) {
      // Across the top, clear of the on-screen keyboard that comes up from below.
      s.left = "8px";
      s.right = "8px";
      s.top = "max(8px, env(safe-area-inset-top))";
      s.width = "auto";
      s.maxHeight = `${Math.max(200, innerHeight - 16)}px`;
      return;
    }
    const r = anchor().getBoundingClientRect();
    const w = Math.min(340, innerWidth - 16);
    s.width = `${w}px`;
    s.left = `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`;
    // Under the button; when the button sits low (Dual Screen's shell) the popover slides up so it fits and covers it.
    const room = Math.min(460, innerHeight - 16);
    s.maxHeight = `${room}px`;
    s.top = `${Math.max(8, Math.min(r.bottom + 4, innerHeight - room - 8))}px`;
  }

  function status(text: string) {
    note.textContent = text;
    note.hidden = !text;
  }

  function render() {
    if (!pop) return;
    const q = input.value;
    const known = host.known();
    // A town the page already holds (a tile has loaded since) is its own entry, not the index's.
    const result = searchPlaces(entries(), q, MAX_RESULTS, (e) => e.index === undefined && known.has(e.id));
    shown = result.shown;
    active = Math.min(active, Math.max(0, shown.length - 1));
    const apart = tellApart(shown);
    list.replaceChildren(
      ...shown.map((e, i) =>
        h(
          "li",
          { role: "option", id: `search-opt-${i}`, class: "menu-item search-opt", "aria-selected": String(i === active), "data-i": String(i) },
          h("span", { class: "search-name" }, e.name),
          h("span", { class: "search-meta" }, reportsLabel(e.reports)),
          apart[i] ? h("span", { class: "search-where" }, apart[i]!) : null,
        ),
      ),
    );
    input.setAttribute("aria-expanded", String(shown.length > 0));
    if (shown.length) input.setAttribute("aria-activedescendant", `search-opt-${active}`);
    else input.removeAttribute("aria-activedescendant");
    const waiting = loading && !names;
    if (!q.trim()) status("Type a place name. Only places with reports today are listed.");
    else if (!shown.length) status(waiting ? "Looking through more places..." : `No place with reports today matches “${q.trim()}”.${failed ? " Some places could not be loaded to search." : ""}`);
    else if (result.more) status(`${result.more} more ${result.more === 1 ? "place matches" : "places match"}. Keep typing to narrow it down.${waiting ? " Looking through more places..." : ""}`);
    else status(waiting ? "Looking through more places..." : failed ? "Some places could not be loaded to search." : "");
    place();
  }

  function mark(next: number) {
    if (!shown.length) return;
    active = (next + shown.length) % shown.length;
    list.querySelectorAll<HTMLElement>(".search-opt").forEach((el, i) => el.setAttribute("aria-selected", String(i === active)));
    input.setAttribute("aria-activedescendant", `search-opt-${active}`);
    list.children[active]?.scrollIntoView({ block: "nearest" });
  }

  function choose(i: number) {
    const e = shown[i];
    if (!e) return;
    close(false);
    host.pick(e);
  }

  const onOutside = (e: PointerEvent) => {
    const t = e.target as Node;
    if (pop && !pop.contains(t) && !triggers.some((b) => b.contains(t))) close(false);
  };

  function open() {
    if (pop) {
      input.focus();
      input.select();
      return;
    }
    from = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    input = h("input", {
      type: "text",
      class: "search-input",
      role: "combobox",
      placeholder: "Find a place",
      "aria-label": "Find a place",
      "aria-autocomplete": "list",
      "aria-controls": "search-list",
      "aria-expanded": "false",
      autocomplete: "off",
      autocapitalize: "off",
      spellcheck: "false",
      enterkeyhint: "go",
    });
    list = h("ul", { id: "search-list", class: "search-list", role: "listbox", "aria-label": "Places" });
    note = h("p", { class: "search-note muted", role: "status" });
    const closeBtn = h("button", { type: "button", class: "search-close", "aria-label": "Close search" }, "×");
    closeBtn.addEventListener("click", () => close(true));
    pop = h("div", { id: "search-pop", class: "menu-body", role: "dialog", "aria-label": "Find a place" }, h("div", { class: "search-head" }, glass(), input, closeBtn), list, note);
    document.body.append(pop);
    active = 0;
    input.addEventListener("input", () => {
      active = 0;
      render();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        mark(active + (e.key === "ArrowDown" ? 1 : -1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        choose(active);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close(true);
      }
    });
    // A press on a result must not take focus from the field, or the popover would close before the click lands.
    list.addEventListener("mousedown", (e) => e.preventDefault());
    list.addEventListener("click", (e) => {
      const i = (e.target as HTMLElement).closest<HTMLElement>(".search-opt")?.dataset.i;
      if (i !== undefined) choose(Number(i));
    });
    list.addEventListener("mousemove", (e) => {
      const i = (e.target as HTMLElement).closest<HTMLElement>(".search-opt")?.dataset.i;
      if (i !== undefined && Number(i) !== active) mark(Number(i));
    });
    pop.addEventListener("focusout", (e) => {
      const to = e.relatedTarget as Node | null;
      if (to && pop && !pop.contains(to) && !triggers.some((b) => b.contains(to))) close(false);
    });
    for (const b of triggers) b.setAttribute("aria-expanded", "true");
    addEventListener("pointerdown", onOutside, true);
    addEventListener("resize", place);
    loadNames();
    render();
    input.focus();
  }

  function close(restore: boolean) {
    if (!pop) return;
    pop.remove();
    pop = null;
    for (const b of triggers) b.setAttribute("aria-expanded", "false");
    removeEventListener("pointerdown", onOutside, true);
    removeEventListener("resize", place);
    if (restore) (from?.isConnected && from !== document.body ? from : anchor()).focus();
    from = null;
  }

  for (const b of triggers)
    b.addEventListener("click", (e) => {
      e.preventDefault();
      if (pop) close(true);
      else open();
    });

  // "/" focuses search from anywhere a letter would not be typed, as many sites do.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest("input, textarea, select, dialog, [contenteditable]") || document.querySelector("dialog[open]")) return;
    e.preventDefault();
    open();
  });

  return { open, close: () => close(false) };
}
