import "@fontsource/unifrakturmaguntia";
import "@fontsource/old-standard-tt/400.css";
import "@fontsource/old-standard-tt/400-italic.css";
import "@fontsource/old-standard-tt/700.css";
import "@fontsource/im-fell-english/400.css";
import "@fontsource/im-fell-english/400-italic.css";
import "@fontsource/im-fell-english-sc/400.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/special-elite/400.css";
import "@fontsource/vt323/400.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans-condensed/500.css";
import "@fontsource/ibm-plex-sans-condensed/600.css";
import "@fontsource/architects-daughter/400.css";
import "@fontsource/barlow/400.css";
import "@fontsource/barlow/600.css";
import "./style.css";

import type { MapEvent, MapFile, MapItem } from "./types.ts";

type Item = MapItem;
type NewsFile = MapFile;
import {
  FILTERS,
  TOPIC_LABEL,
  formatCoords,
  formatRunDate,
  groupByPlace,
  hasTiers,
  languageName,
  loadNews,
  NO_DAY_YET,
  storyIndex,
  tierOf,
  timeAgo,
  type Filters,
  type TopicFilter,
} from "./data.ts";
import { THEMES, type ThemeId, type ViewMode } from "./themes.ts";
import { MapView, type Dot } from "./map/view.ts";
import { loadHigh, loadLow } from "./map/basemap.ts";
import { needsTranslation, targetLanguage, translate, translationSupported } from "./translate.ts";
import { loadPins, prefs, savePins, setPref, type Pin } from "./pins.ts";
import { h, safeUrl } from "./ui/dom.ts";
import { SITE_NAME, SITE_TAGLINE } from "./brand.ts";

const BASE = import.meta.env.BASE_URL;
const SLOTS = 96; // quarter hours in 24h
const REPLAY_WINDOW = 3 * 3600;
const THEME_IDS = Object.keys(THEMES) as ThemeId[];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---- state ----------------------------------------------------------------

const params = new URLSearchParams(location.search);
const urlTheme = params.get("theme") as ThemeId | null;
const urlView = params.get("view") as ViewMode | null;

const state = {
  file: null as NewsFile | null,
  byPlace: new Map<number, Item[]>(),
  stories: new Map<string, Item[]>(),
  theme: urlTheme && THEME_IDS.includes(urlTheme) ? urlTheme : prefs<ThemeId>("theme", "morning", THEME_IDS),
  view: null as ViewMode | null,
  topics: new Set<TopicFilter>(FILTERS),
  slot: SLOTS,
  live: true,
  translate: false,
  tuned: null as number[] | null,
  /** Zoom level from MapView.level(): which stories show (decision 30). */
  level: 0,
  /** False when the file has no event data, so every place shows at every zoom. */
  tiered: false,
  /** The reader asked to see every report at the tuned place, not only this zoom level's. */
  showAll: false,
  reader: null as Item | null,
  framed: false,
  /** The telegram panel: the word and the events it stands for (levels 0 and 1). */
  telegram: false,
  /** One event's explanation and sources (levels 2 and 3), and where Back returns to. */
  event: null as { id: number; back: "telegram" | "reader" } | null,
  pins: loadPins(),
  playing: 0,
};
state.view = urlView === "2d" || urlView === "3d" ? urlView : null;

const viewOf = () => state.view ?? THEMES[state.theme].defaultView;

function filters(): Filters {
  const gen = state.file?.generatedAt ?? Date.now() / 1000;
  if (state.live) return { topics: state.topics, from: gen - 24 * 3600, to: gen };
  const to = gen - (SLOTS - state.slot) * 900;
  return { topics: state.topics, from: to - REPLAY_WINDOW, to };
}

// ---- map --------------------------------------------------------------------

const IDLE_SPIN_MS = 60_000;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let idleTimer = 0;

/** After a minute without input, and nothing open to read, the map starts turning again. */
function armIdleSpin() {
  clearTimeout(idleTimer);
  if (reducedMotion) return;
  idleTimer = window.setTimeout(() => {
    const menuOpen = document.querySelector("details.menu[open], dialog[open]");
    if (state.reader || state.telegram || state.event || menuOpen || !state.live) return armIdleSpin();
    map.startSpin();
  }, IDLE_SPIN_MS);
}

const map = new MapView($("map"), THEMES[state.theme], {
  onTune(indices) {
    state.tuned = indices;
    state.showAll = false;
    if (!state.reader && !state.telegram && !state.event) renderPanel();
    syncUrl();
  },
  onLevel(level) {
    state.level = level;
    if (state.tuned && !state.reader && !state.telegram && !state.event) renderPanel();
  },
  onInteract: armIdleSpin,
  onLand: armIdleSpin,
});
map.setMode(viewOf());

function refreshDots() {
  if (!state.file) return;
  const f = filters();
  state.byPlace = groupByPlace(state.file, f);
  const dots: Dot[] = [];
  for (const [index, items] of state.byPlace) {
    const p = state.file.places[index];
    const tier = Math.min(...items.map((it) => tierOf(it, state.tiered)));
    dots.push({ index, lon: p.lon, lat: p.lat, count: items.length, fresh: items[0].t >= f.to - 3600, tier });
  }
  map.setDots(dots);
  map.setPinned(pinnedIndices());
}

function pinnedIndices(): number[] {
  if (!state.file) return [];
  const ids = new Set(state.pins.map((p) => p.id));
  return state.file.places.flatMap((p, i) => (ids.has(p.id) ? [i] : []));
}

function flyToPlace(index: number) {
  const p = state.file?.places[index];
  if (p) map.flyTo(p.lon, p.lat);
}

// ---- masthead ---------------------------------------------------------------

function renderMasthead() {
  const t = THEMES[state.theme];
  // One row: the name and tagline on the left, the day's word on the right (renderTelegramStrip).
  $("mast-title").textContent = t.id === "wire" || t.id === "ops" ? SITE_NAME.toUpperCase() : SITE_NAME;
  $("mast-tag").textContent = SITE_TAGLINE;
}

// ---- toolbar ----------------------------------------------------------------

function segmented<T extends string>(el: HTMLElement, options: [T, string][], current: T, onPick: (v: T) => void) {
  el.replaceChildren(
    ...options.map(([value, label]) => {
      const b = h("button", { type: "button", role: "radio", "aria-checked": String(value === current) }, label);
      b.addEventListener("click", () => onPick(value));
      return b;
    }),
  );
}

function renderToolbar() {
  // Five designs sit in one menu, so the toolbar stays short.
  $("design-current").textContent = THEMES[state.theme].label;
  $("designs").replaceChildren(
    ...THEME_IDS.map((id) => {
      const b = h("button", { type: "button", class: "menu-item", role: "menuitemradio", "aria-checked": String(id === state.theme) }, THEMES[id].label);
      b.addEventListener("click", () => {
        closeMenus();
        state.theme = id;
        setPref("theme", id);
        applyTheme();
      });
      return b;
    }),
  );
  segmented(
    $("view-seg"),
    [
      ["2d", "Map"],
      ["3d", "Globe"],
    ],
    viewOf(),
    (v) => {
      state.view = v;
      map.setMode(v);
      renderToolbar();
      syncUrl();
    },
  );

  const chips = $("topics");
  chips.replaceChildren(
    ...FILTERS.map((f) => {
      const b = h("button", { type: "button", class: "chip", "aria-pressed": String(state.topics.has(f)) }, TOPIC_LABEL[f]);
      b.addEventListener("click", () => {
        if (state.topics.size === FILTERS.length) state.topics = new Set([f]);
        else if (state.topics.has(f)) state.topics.delete(f);
        else state.topics.add(f);
        if (state.topics.size === 0) state.topics = new Set(FILTERS);
        onFiltersChanged();
      });
      return b;
    }),
    (() => {
      const all = h("button", { type: "button", class: "chip chip-all" }, "Show all");
      all.addEventListener("click", () => {
        state.topics = new Set(FILTERS);
        onFiltersChanged();
      });
      return all;
    })(),
  );
  $("topics-count").textContent = state.topics.size === FILTERS.length ? "" : `(${state.topics.size})`;

  // Only offered where the browser can translate on the device.
  const tr = $("translate");
  // Shown only where the browser can translate and the day has a story in another language.
  tr.hidden = !translationSupported() || !state.file?.items.some((it) => needsTranslation(it.lang));
  tr.setAttribute("aria-pressed", String(state.translate));
  tr.title = `Translate headlines into ${languageName(targetLanguage) || targetLanguage}`;

  renderPins();
}

function renderPins() {
  const box = $("pins");
  // The menu appears once there is something in it; the Pin button in a place's panel adds the first.
  $("pins-menu").hidden = state.pins.length === 0;
  $("pins-count").textContent = state.pins.length ? `(${state.pins.length})` : "";
  box.replaceChildren(
    ...state.pins.map((pin) => {
      const b = h("button", { type: "button", class: "menu-item" }, pin.name);
      b.addEventListener("click", () => {
        const idx = state.file?.places.findIndex((p) => p.id === pin.id) ?? -1;
        closeMenus();
        if (idx >= 0) flyToPlace(idx);
      });
      return b;
    }),
  );
}

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  map.setTheme(THEMES[state.theme]);
  map.setMode(viewOf());
  renderMasthead();
  renderToolbar();
  syncUrl();
}

function onFiltersChanged() {
  refreshDots();
  renderToolbar();
  renderTimeLabel();
  renderTicker();
  if (!state.reader) renderPanel();
}

// ---- panel ------------------------------------------------------------------

let renderToken = 0;

function metaLine(it: Item, now: number, showPublisher = true): HTMLElement {
  // A story placed where it happened says where its outlet is, so "Le Monde, Paris" reads right under Caracas.
  const parts = showPublisher ? [it.from ? `${it.publisher}, ${it.from}` : it.publisher, timeAgo(it.t, now)] : [timeAgo(it.t, now)];
  const lang = languageName(it.lang);
  if (lang && it.lang !== "en") parts.push(lang);
  // "Other" says nothing, so only named topics show.
  if (it.topics[0] && it.topics[0] !== "other") parts.push(TOPIC_LABEL[it.topics[0]]);
  return h("span", { class: "meta" }, parts.join(" · "));
}

/** With Translate on, swaps an element's text for the on-device translation and labels it. */
function translated<T extends HTMLElement>(el: T, text: string, lang: string): T {
  if (state.translate && needsTranslation(lang)) {
    const token = renderToken;
    translate(text, lang).then((out) => {
      if (!out || token !== renderToken || !el.isConnected) return;
      el.textContent = out;
      el.lang = targetLanguage;
      el.after(h("span", { class: "translated" }, `Translated from ${languageName(lang) || lang}`));
    });
  }
  return el;
}

function headline(it: Item, tag: "span" | "h2" = "span"): HTMLElement {
  return translated(h(tag, { class: tag === "h2" ? "reader-headline" : "headline", lang: it.lang !== "und" ? it.lang : undefined }, it.title), it.title, it.lang);
}

function storyButton(it: Item, now: number, showPlace = false, showPublisher = true): HTMLElement {
  const others = it.story ? new Set((state.stories.get(it.story) ?? []).map((s) => s.publisher)).size - 1 : 0;
  const b = h(
    "button",
    { type: "button", class: "story" },
    showPlace ? h("span", { class: "kicker" }, state.file!.places[it.place].name) : null,
    headline(it),
    metaLine(it, now, showPublisher),
    others > 0 ? h("span", { class: "related" }, `Also reported by ${others} other ${others === 1 ? "outlet" : "outlets"}`) : null,
  );
  b.addEventListener("click", () => openReader(it));
  return h("li", {}, b);
}

function renderPanel() {
  renderToken++;
  const panel = $("panel");
  panel.classList.toggle("reading", !!(state.reader || state.telegram || state.event));
  panel.classList.toggle("framed", state.framed);
  if (!state.file) {
    panel.replaceChildren(h("p", { class: "muted pad" }, "Loading reports..."));
    return;
  }
  const ev = state.event ? state.file.events[String(state.event.id)] : undefined;
  if (state.event && ev) return renderEvent(panel, ev);
  if (state.telegram) return renderTelegram(panel);
  if (state.reader) return renderReader(panel, state.reader);
  if (state.tuned === null) return renderIdle(panel);
  renderPlaces(panel, state.tuned);
}

function renderIdle(panel: HTMLElement) {
  const now = state.file!.generatedAt;
  const latest = [...state.byPlace.values()]
    .map((list) => list[0])
    .sort((a, b) => b.t - a.t)
    .slice(0, 12);
  panel.replaceChildren(
    h(
      "div",
      { class: "idle" },
      h("h2", { class: "panel-title" }, "Latest reports"),
      h("p", { class: "count" }, "The map stops on a place. Drag to pick one yourself."),
      h("ol", { class: "stories" }, ...latest.map((it) => storyButton(it, now, true))),
    ),
  );
}

/** One place, or nearby places merged at this zoom: their reports together, newest first. */
function renderPlaces(panel: HTMLElement, indices: number[]) {
  const file = state.file!;
  const all = indices.flatMap((i) => state.byPlace.get(i) ?? []).sort((a, b) => b.t - a.t);
  const items = state.showAll ? all : all.filter((it) => tierOf(it, state.tiered) <= state.level);
  const hidden = all.length - items.length;
  const place = file.places[indices[0]];
  // One outlet at this place: name it once in the header instead of under every headline.
  const publishers = new Set(all.map((it) => it.publisher));
  const onePublisher = publishers.size === 1 ? [...publishers][0] : null;
  const count = `${all.length} ${all.length === 1 ? "report" : "reports"}`;
  let head: HTMLElement;
  if (indices.length === 1) {
    const pinned = state.pins.some((p) => p.id === place.id);
    const pin = h("button", { type: "button", class: "tool pin", "aria-pressed": String(pinned) }, pinned ? "Pinned" : "Pin");
    pin.addEventListener("click", () => {
      state.pins = pinned ? state.pins.filter((p) => p.id !== place.id) : [...state.pins, { id: place.id, name: place.name } as Pin];
      savePins(state.pins);
      renderPins();
      map.setPinned(pinnedIndices());
      renderPanel();
    });
    head = h(
      "div",
      { class: "dateline" },
      h("h2", { class: "place-name", title: formatCoords(place.lat, place.lon) }, place.name),
      h("span", { class: "coords" }, [onePublisher, count].filter(Boolean).join(" · ")),
      pin,
    );
  } else {
    const names = indices.map((i) => file.places[i].name);
    head = h("div", { class: "dateline" }, h("h2", { class: "place-name" }, `${names.length} places`), h("span", { class: "coords" }, `${names.join(" · ")} · ${count}`));
  }
  const more = hidden
    ? (() => {
        const b = h("button", { type: "button", class: "link" }, "show");
        b.addEventListener("click", () => {
          state.showAll = true;
          renderPanel();
        });
        return h("p", { class: "count" }, `${hidden} more when zoomed in: `, b);
      })()
    : null;
  panel.replaceChildren(
    head,
    h("ol", { class: "stories" }, ...items.map((it) => storyButton(it, file.generatedAt, indices.length > 1, !onePublisher))),
    ...(more ? [more] : []),
  );
}

function renderReader(panel: HTMLElement, it: Item) {
  const file = state.file!;
  const place = file.places[it.place];
  const url = safeUrl(it.url);
  const back = h("button", { type: "button", class: "tool back" }, state.framed ? "Back to preview" : `Back to ${place.name}`);
  back.addEventListener("click", () => {
    if (state.framed) state.framed = false;
    else closeReader();
    renderPanel();
  });

  if (state.framed && url) {
    const frame = h("iframe", {
      class: "reader-frame",
      src: url,
      title: it.title,
      sandbox: "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms",
      referrerpolicy: "no-referrer",
      loading: "eager",
    });
    panel.replaceChildren(
      h(
        "div",
        { class: "frame-bar" },
        back,
        h("span", { class: "meta" }, it.domain),
        h("a", { class: "tool", href: url, target: "_blank", rel: "noopener noreferrer" }, `Read at ${it.publisher}`),
      ),
      frame,
    );
    return;
  }

  const related = it.story ? (state.stories.get(it.story) ?? []).filter((s) => s.publisher !== it.publisher) : [];
  const image = safeUrl(it.image, true);
  const actions = h("div", { class: "actions" });
  const explained = it.event !== undefined ? file.events[String(it.event)] : undefined;
  if (explained) {
    const open = h("button", { type: "button", class: "tool primary" }, "Explanation and sources");
    open.addEventListener("click", () => openEvent(explained.id, "reader"));
    actions.append(open);
  }
  if (it.embed && url) {
    const here = h("button", { type: "button", class: explained ? "tool" : "tool primary" }, "Read it here");
    here.addEventListener("click", () => {
      state.framed = true;
      renderPanel();
    });
    actions.append(here);
  }
  if (url) {
    actions.append(
      h("a", { class: it.embed || explained ? "tool" : "tool primary", href: url, target: "_blank", rel: "noopener noreferrer" }, `Read at ${it.publisher}`),
    );
  }

  const fig = image
    ? h("figure", { class: "lead" }, h("img", { src: image, alt: "", loading: "lazy", referrerpolicy: "no-referrer" }))
    : null;
  fig?.querySelector("img")?.addEventListener("error", () => fig.remove());

  panel.replaceChildren(
    h(
      "article",
      { class: "reader" },
      back,
      h(
        "p",
        { class: "kicker" },
        [place.name, it.topics[0] ? TOPIC_LABEL[it.topics[0]] : "", timeAgo(it.t, file.generatedAt)].filter(Boolean).join(" · "),
      ),
      headline(it, "h2"),
      h("p", { class: "byline" }, [it.from ? `${it.publisher}, ${it.from}` : it.publisher, it.domain, languageName(it.lang)].filter(Boolean).join(" · ")),
      fig,
      // A story without a feed summary shows its headline and the link, with no note about what is missing.
      it.excerpt ? translated(h("p", { class: "excerpt", lang: it.lang !== "und" ? it.lang : undefined }, it.excerpt), it.excerpt, it.lang) : null,
      it.excerpt || it.embed
        ? h("p", { class: "fine" }, [it.excerpt ? "Preview from the outlet's own feed." : "", it.embed ? `The outlet allows its full page to open inside ${SITE_NAME}.` : ""].filter(Boolean).join(" "))
        : null,
      actions,
      related.length
        ? h(
            "section",
            { class: "elsewhere" },
            h("h3", { class: "rule-head" }, `Also reported by ${new Set(related.map((r) => r.publisher)).size} other ${new Set(related.map((r) => r.publisher)).size === 1 ? "outlet" : "outlets"}`),
            h("ol", { class: "stories" }, ...related.slice(0, 20).map((r) => storyButton(r, file.generatedAt, r.place !== it.place))),
          )
        : null,
    ),
  );
}

function openReader(it: Item) {
  state.reader = it;
  state.framed = false;
  state.telegram = false;
  state.event = null;
  applyHighlight();
  const file = state.file!;
  const from = file.places[it.place];
  const to = it.story
    ? [...new Set((state.stories.get(it.story) ?? []).map((s) => s.place))]
        .filter((p) => p !== it.place)
        .map((p) => [file.places[p].lon, file.places[p].lat] as [number, number])
    : [];
  map.setArcs([from.lon, from.lat], to);
  if (!state.tuned?.includes(it.place)) flyToPlace(it.place);
  renderPanel();
  $("panel").scrollTop = 0;
}

function closeReader() {
  state.reader = null;
  state.framed = false;
  map.setArcs(null);
}

// ---- telegram and explanations (2DayAI) ---------------------------------------

/** Places behind whatever the panel shows, ringed on the map. */
function applyHighlight() {
  const file = state.file;
  if (!file) return map.setHighlight([]);
  const ev = state.event ? file.events[String(state.event.id)] : undefined;
  if (ev) return map.setHighlight(ev.places);
  if (state.telegram && file.telegram) {
    return map.setHighlight(file.telegram.items.flatMap((i) => file.events[String(i.eventId)]?.places ?? []));
  }
  map.setHighlight([]);
}

const BAND_LABEL: Record<number, string> = { [-2]: "Grave", [-1]: "Hard", 0: "Mixed", 1: "Hopeful", 2: "Good" };

function signed(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `\u2212${-n}` : "0";
}

/** The five-step scale with the day's step marked. Text labels, so it reads without colour. */
function scale(band: number): HTMLElement {
  return h(
    "div",
    { class: "scale", role: "img", "aria-label": `The day scored ${BAND_LABEL[band]}, on a scale from Grave to Good` },
    ...[-2, -1, 0, 1, 2].map((b) => h("span", { class: b === band ? "step on" : "step" }, BAND_LABEL[b]!)),
  );
}

function renderTelegramStrip() {
  const el = $("telegram");
  const file = state.file;
  if (!file) {
    el.replaceChildren(h("span", { class: "telegram-kicker" }, "Loading today's word..."));
    return;
  }
  const t = file.telegram;
  const date = h("span", { class: "telegram-kicker" }, formatRunDate(file.runDate));
  if (!t) {
    el.replaceChildren(h("div", { class: "telegram-side" }, h("div", { class: "telegram-meta" }, date, h("span", { class: "telegram-note" }, "No word yet for this day"))));
    return;
  }
  const word = h("button", { type: "button", class: "telegram-word", "aria-label": `Today's word: ${t.word}. See why.` }, t.word);
  word.addEventListener("click", openTelegram);
  // The word is the page's headline. Its size follows its length, so "Joy" and "Encouragement" both fill the
  // space without overflowing a phone.
  word.style.setProperty("--len", String(Math.max(4, t.word.length)));
  const n = t.scores.length;
  el.replaceChildren(
    word,
    h("div", { class: "telegram-side" }, h("div", { class: "telegram-meta" }, date, h("span", { class: "telegram-note" }, `Chosen by AI from ${n} ${n === 1 ? "event" : "events"}`)), scale(t.band)),
  );
}

function openTelegram() {
  if (!state.file?.telegram) return;
  state.telegram = true;
  state.event = null;
  state.reader = null;
  state.framed = false;
  map.setArcs(null);
  applyHighlight();
  renderPanel();
  $("panel").scrollTop = 0;
}

function closeTelegram() {
  state.telegram = false;
  state.event = null;
  applyHighlight();
}

function placesText(ev: MapEvent): string {
  const names = [...new Set(ev.places.map((p) => state.file!.places[p]?.name).filter(Boolean))];
  return names.length ? `Reported from ${names.join(", ")}` : "";
}

function scoreChip(score: number): HTMLElement {
  return h("span", { class: `score-chip s${score + 2}`, title: BAND_LABEL[score] }, signed(score));
}

function renderTelegram(panel: HTMLElement) {
  const file = state.file!;
  const t = file.telegram!;
  const back = h("button", { type: "button", class: "tool back" }, "Back to the map");
  back.addEventListener("click", () => {
    closeTelegram();
    renderPanel();
  });
  const scoreOf = new Map(t.scores.map((sc) => [sc.eventId, sc]));
  const eventButton = (eventId: number, text: string, extra: HTMLElement | null) => {
    const ev = file.events[String(eventId)];
    if (!ev) return [];
    const sc = scoreOf.get(eventId);
    const b = h(
      "button",
      { type: "button", class: "story" },
      h("span", { class: "headline" }, sc ? scoreChip(sc.score) : null, " ", text),
      extra,
      h("span", { class: "meta" }, [placesText(ev), `${ev.sources.length} ${ev.sources.length === 1 ? "source" : "sources"}`].filter(Boolean).join(" · ")),
    );
    b.addEventListener("click", () => openEvent(ev.id, "telegram"));
    return [h("li", {}, b)];
  };
  panel.replaceChildren(
    h(
      "article",
      { class: "reader telegram-view" },
      back,
      h("p", { class: "kicker" }, `The world's reporting · ${formatRunDate(t.runDate)}`),
      h("h2", { class: "telegram-big" }, t.word),
      scale(t.band),
      h(
        "p",
        { class: "fine" },
        "An AI model scored each event from \u22122 to +2 by what happened to people, quoting the sentence each score rests on. A formula, not the model, set the day: the worst significant event decides a bad day.",
      ),
      h("h3", { class: "rule-head" }, "What shaped the day"),
      h("ol", { class: "stories" }, ...t.items.flatMap((item) => eventButton(item.eventId, item.line, null))),
      h("h3", { class: "rule-head" }, "Every event's score"),
      h(
        "ol",
        { class: "stories" },
        ...t.scores.flatMap((sc) => eventButton(sc.eventId, file.events[String(sc.eventId)]?.title ?? "", h("blockquote", { class: "excerpt-quote" }, sc.because))),
      ),
    ),
  );
}

function openEvent(id: number, back: "telegram" | "reader") {
  const ev = state.file?.events[String(id)];
  if (!ev) return;
  state.event = { id, back };
  applyHighlight();
  const first = ev.places[0];
  if (first !== undefined && !state.tuned?.includes(first) && back === "telegram") flyToPlace(first);
  renderPanel();
  $("panel").scrollTop = 0;
}

function renderEvent(panel: HTMLElement, ev: MapEvent) {
  const file = state.file!;
  const backTo = state.event!.back;
  const back = h("button", { type: "button", class: "tool back" }, backTo === "telegram" ? `Back to "${file.telegram?.word ?? "today"}"` : "Back to the article");
  const sc = file.telegram?.scores.find((x) => x.eventId === ev.id);
  back.addEventListener("click", () => {
    state.event = null;
    applyHighlight();
    renderPanel();
  });
  const section = (label: string, list: MapEvent["whatHappened"]) =>
    list.length
      ? h(
          "section",
          { class: "explain-part" },
          h("h3", { class: "rule-head" }, label),
          h(
            "p",
            { class: "explain-text" },
            ...list.flatMap((s) => [
              s.text,
              ...s.cites.map((i) => {
                const a = h("a", { class: "cite", href: `#src-${ev.id}-${i + 1}`, "aria-label": `Source ${i + 1}` }, String(i + 1));
                a.addEventListener("click", (e) => {
                  e.preventDefault();
                  document.getElementById(`src-${ev.id}-${i + 1}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
                });
                return a;
              }),
              " ",
            ]),
          ),
        )
      : null;
  const sources = ev.sources.map((src, i) => {
    const url = safeUrl(src.url);
    return h(
      "li",
      { id: `src-${ev.id}-${i + 1}`, class: "source" },
      h("span", { class: "source-num" }, String(i + 1)),
      h(
        "div",
        {},
        h("p", { class: "meta" }, `${src.publisher} · ${new Date(src.publishedAt * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`),
        url ? h("a", { class: "source-title", href: url, target: "_blank", rel: "noopener noreferrer" }, src.title) : h("span", { class: "source-title" }, src.title),
        ...src.excerpts.map((x) => h("blockquote", { class: "excerpt-quote" }, x)),
      ),
    );
  });
  panel.replaceChildren(
    h(
      "article",
      { class: "reader event-view" },
      back,
      h("p", { class: "kicker" }, [TOPIC_LABEL[ev.topic], placesText(ev)].filter(Boolean).join(" · ")),
      h("h2", { class: "reader-headline" }, ev.title),
      sc ? h("p", { class: "event-score" }, scoreChip(sc.score), ` Scored ${BAND_LABEL[sc.score]} for today's word, because: `, h("q", {}, sc.because)) : null,
      section("What happened", ev.whatHappened),
      section("Why it matters", ev.whyItMatters),
      section("What changes next", ev.whatChangesNext),
      h("h3", { class: "rule-head" }, "Sources"),
      h("ol", { class: "sources" }, ...sources),
      h("p", { class: "fine" }, "Written by an AI model, title included. Each sentence links to the passage it quotes, and any sentence without a matching passage was removed."),
    ),
  );
}

// ---- time bar ---------------------------------------------------------------

function renderTimeLabel() {
  const label = $("time-label");
  const slider = $("time") as HTMLInputElement;
  slider.value = String(state.slot);
  $("live").hidden = state.live;
  if (state.live) {
    label.textContent = "Last 24 hours";
    return;
  }
  const f = filters();
  const fmt = (t: number) => new Date(t * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const ago = Math.round((state.file!.generatedAt - f.to) / 3600);
  label.textContent = `${fmt(f.from)} to ${fmt(f.to)}${ago > 0 ? ` (${ago} h ago)` : ""}`;
}

function setSlot(slot: number, live = false) {
  state.slot = slot;
  state.live = live;
  onFiltersChanged();
}

function stopReplay() {
  clearInterval(state.playing);
  state.playing = 0;
  $("play").textContent = "Replay";
}

function bindTimebar() {
  $("time").addEventListener("input", (e) => {
    stopReplay();
    setSlot(+(e.target as HTMLInputElement).value, false);
  });
  $("live").addEventListener("click", () => {
    stopReplay();
    setSlot(SLOTS, true);
  });
  $("play").addEventListener("click", () => {
    if (state.playing) return stopReplay();
    $("play").textContent = "Pause";
    let slot = state.live || state.slot >= SLOTS ? REPLAY_WINDOW / 900 : state.slot;
    setSlot(slot);
    state.playing = window.setInterval(() => {
      slot += 1;
      if (slot > SLOTS) {
        stopReplay();
        setSlot(SLOTS, true);
        return;
      }
      setSlot(slot);
    }, 220);
  });
}

// ---- ticker -----------------------------------------------------------------

function renderTicker() {
  const track = $("ticker-track");
  if (!state.file || state.theme !== "wire") {
    track.replaceChildren();
    return;
  }
  const latest = [...state.byPlace.values()]
    .flat()
    .sort((a, b) => b.t - a.t)
    .slice(0, 30);
  const make = () =>
    latest.map((it) => {
      const b = h(
        "button",
        { type: "button", class: "tick" },
        h("b", {}, state.file!.places[it.place].name.toUpperCase()),
        " ",
        it.title,
      );
      b.addEventListener("click", () => openReader(it));
      return b;
    });
  // Two copies so the CSS loop is seamless.
  track.replaceChildren(...make(), ...make());
  track.style.animationDuration = `${Math.max(40, latest.length * 6)}s`;
}

// ---- misc -------------------------------------------------------------------

function syncUrl() {
  const p = new URLSearchParams();
  p.set("theme", state.theme);
  if (state.view) p.set("view", state.view);
  const place = state.tuned ? state.file?.places[state.tuned[0]] : null;
  if (place) p.set("place", place.id);
  history.replaceState(null, "", `${location.pathname}?${p}`);
}

/** S: turn the map until it lands somewhere new. */
function spin() {
  closeReader();
  closeTelegram();
  renderPanel();
  map.startSpin();
}

function closeMenus() {
  for (const d of document.querySelectorAll<HTMLDetailsElement>("details.menu[open]")) d.open = false;
}

/**
 * A phone's toolbar keeps the view and topics in the row; design, translate, pins and about move into More
 * instead of scrolling sideways. The elements move, so their listeners come with them.
 */
function fitToolbar(phone: boolean) {
  const rest = ["translate", "pins-menu", "about-btn"].map($);
  if (phone) $("more").append($("design-menu"), ...rest);
  else {
    $("view-seg").after($("design-menu"));
    $("more-menu").before(...rest);
  }
  $("more-menu").hidden = !phone;
  closeMenus();
}

function bindGlobal() {
  const phone = matchMedia("(max-width: 760px)");
  fitToolbar(phone.matches);
  phone.addEventListener("change", (e) => fitToolbar(e.matches));
  $("zoom-in").addEventListener("click", () => map.zoomBy(1.6));
  $("zoom-out").addEventListener("click", () => map.zoomBy(1 / 1.6));
  $("about-btn").addEventListener("click", () => {
    closeMenus();
    ($("about") as HTMLDialogElement).showModal();
  });
  $("translate").addEventListener("click", () => {
    state.translate = !state.translate;
    renderToolbar();
    renderPanel();
  });
  document.addEventListener("keydown", (e) => {
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, select, dialog")) return;
    if (e.key === "Escape" && (state.event || state.telegram || state.reader)) {
      if (state.event) state.event = null;
      else if (state.telegram) closeTelegram();
      else closeReader();
      applyHighlight();
      renderPanel();
    } else if (e.key === "s" || e.key === "S") {
      spin();
    }
  });
  // Close open menus when clicking elsewhere.
  document.addEventListener("click", (e) => {
    // composedPath is fixed at dispatch, so it still holds chips that re-rendered mid-click.
    const path = e.composedPath();
    for (const d of document.querySelectorAll<HTMLDetailsElement>("details.menu[open]")) {
      if (!path.includes(d)) d.open = false;
    }
  });
}

async function start() {
  document.title = SITE_NAME;
  for (const el of document.querySelectorAll("[data-site-name]")) el.textContent = SITE_NAME;
  document.documentElement.dataset.theme = state.theme;
  renderMasthead();
  renderToolbar();
  renderTelegramStrip();
  renderPanel();
  bindTimebar();
  bindGlobal();

  loadLow(BASE).then((low) => map.setBasemap(low));
  loadHigh(BASE)
    .then(({ map: high, relief }) => map.setBasemap(undefined, high, relief))
    .catch((e) => console.warn("Detailed basemap failed to load", e));

  try {
    state.file = await loadNews(BASE);
  } catch (err) {
    const first = err instanceof Error && err.message === NO_DAY_YET;
    $("panel").replaceChildren(
      h("p", { class: "pad" }, first ? "The first day's map is being made. It appears after the daily run at 09:00 UTC." : "The news couldn't be loaded. Try again in a few minutes."),
    );
    return;
  }
  state.stories = storyIndex(state.file);
  state.tiered = hasTiers(state.file);
  if (state.file.source !== "live") {
    const banner = $("banner");
    banner.hidden = false;
    banner.textContent =
      state.file.source === "demo"
        ? (state.file.note ?? "Demo: real headlines gathered outside the daily run.")
        : "Sample: fictional outlets and places. Not real news.";
  }
  refreshDots();
  renderTelegramStrip();
  renderMasthead();
  renderTimeLabel();
  renderTicker();
  renderPanel();

  const start = params.get("place");
  const idx = start ? state.file.places.findIndex((p) => p.id === start) : -1;
  if (idx >= 0) flyToPlace(idx);
  // Like a radio dial: the map turns on its own until a place lands under the cross.
  else if (!reducedMotion) {
    // A different stretch of the world each visit, a little north of the equator where most places are.
    map.setCenter(Math.random() * 360 - 180, 18);
    map.startSpin();
  }
  armIdleSpin();
}

start();
