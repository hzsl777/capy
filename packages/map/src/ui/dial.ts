// Shortwave's radio front under the map (src/map/shortwave.ts lays it out). It is how a reader moves
// round the world in this design, and it is made to feel like tuning a set:
//  - the big knob is the main way to move. It clicks through fine detents, a little sticky under the finger, and let
//    go while turning it spins on like a flywheel and falls into the next detent; the world turns as the knob does,
//    and when it stops the nearest place glides under the reticle, as after any drag. Arrow keys on it turn it three
//    detents (one with Shift), and the mouse wheel over it turns it too.
//  - the needle stands at the reticle's longitude on every frame, riding a cord a little behind it, with the dial's
//    lamp behind it; the scale is longitude printed like a band's frequencies, with no station, place or country names.
//  - the eye and the grain over the dial window follow how near the reticle is to the nearest place drawn: the eye
//    closes and the grain thins as one comes under it, and a place locking in is a small mechanical clack. They say
//    only how near a place is, never which place or anything about its news.
//  - five band keys are the map's five zoom levels (Page Up and Page Down step them), and a second, smaller knob
//    scrubs the time bar's slider, the Replay's own control, a quarter hour a detent.
//  - a Sound key, off until pressed, adds a click for each detent and a thunk for each lock (src/ui/dialsound.ts).
// Nothing moves in a hidden tab, and reduced motion keeps all of it still: no spin, no easing, no animation, the eye
// showing only whether a place is tuned. Hidden by CSS in every other design.

import type { ThemeId } from "../themes.ts";
import { h } from "./dom.ts";
import { click, setSound, soundOn, thunk } from "./dialsound.ts";
import {
  angleOfSlot,
  atRest,
  BAND_COUNT,
  bandOf,
  bandStep,
  DETENT_DEG,
  detentAt,
  detentStep,
  dialAt,
  EYE_OPEN,
  EYE_R,
  flick,
  KEY_DETENTS,
  KNOB_PER_DEG,
  lockOf,
  lonAt,
  lonText,
  needleJumps,
  PX_PER_KNOB_DEG,
  scaleLabels,
  scaleStep,
  sectorPath,
  slotOfAngle,
  SLOT_DEG,
  smoothLock,
  spinStep,
  STATIC_DRIFT_S,
  STATIC_OPACITY,
  turnBetween,
  WING_TURN,
  lampLevel,
  LAMP_DIM,
  NEEDLE_EASE_MS,
} from "../map/shortwave.ts";

export interface DialSource {
  theme(): ThemeId;
  center(): [number, number];
  /** Whether a place is under the reticle. */
  tuned(): boolean;
  /** Screen pixels from the reticle to the nearest place drawn, or null when none is drawn. */
  nearest(): number | null;
  /** The map's zoom level, 0 for the whole world up. */
  level(): number;
  turnTo(lon: number): void;
  turnBy(px: number): void;
  /** Let the nearest place within reach glide under the reticle, as the end of a drag does. */
  snap(): void;
  /** Zoom to the start of a level. */
  band(level: number): void;
}

const NS = "http://www.w3.org/2000/svg";

function svg(
  tag: string,
  attrs: Record<string, string | number>,
  ...kids: SVGElement[]
): SVGElement {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  el.append(...kids);
  return el;
}

const reduced = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

let src: DialSource | null = null;
let radio: HTMLElement;
let scale: HTMLElement;
let nums: HTMLElement;
let needle: HTMLElement;
let sound: HTMLButtonElement;
let step = 0;
let lastLon = NaN;
let lastAt = -1;
let lastNow = "";
let wasTuned: boolean | null = null;
/** When the reader last turned something by hand, so the lock's thunk and the knob's gearing know what is theirs. */
let handAt = -1e9;
let clackTimer = 0;

/** The ticks every 5 degrees and the band markings under them, drawn once across the scale's 360 units. */
function ticks(): SVGElement {
  const lines: SVGElement[] = [];
  for (let d = 0; d <= 360; d += 5) {
    const major = d % 30 === 0;
    const mid = !major && d % 10 === 0;
    lines.push(
      svg("line", {
        x1: d,
        x2: d,
        y1: 0,
        y2: major ? 14 : mid ? 10 : 6,
        class: major ? "sw-tick sw-major" : "sw-tick",
      }),
    );
  }
  // Band markings of our own: six plain bars, alternately brass and dark, that mark nothing but the dial's sixths;
  // never red, so no stretch of the world reads as flagged.
  const bands = Array.from({ length: 6 }, (_, i) =>
    svg("rect", {
      x: i * 60 + 1.5,
      y: 18,
      width: 57,
      height: 3,
      class: i % 2 ? "sw-band sw-band-b" : "sw-band",
    }),
  );
  return svg(
    "svg",
    {
      class: "sw-ticks",
      viewBox: "0 0 360 22",
      preserveAspectRatio: "none",
      "aria-hidden": "true",
    },
    ...lines,
    ...bands,
  );
}

/** The green tuning eye: a lit green disc with a dark wedge, two wings that turn in over the wedge, and a dark cap. */
function eye(): SVGElement {
  const half = EYE_OPEN / 2;
  return svg(
    "svg",
    { class: "sw-eye-tube", viewBox: "0 0 40 40", "aria-hidden": "true" },
    svg(
      "defs",
      {},
      svg(
        "radialGradient",
        { id: "sw-eye-glow", cx: "50%", cy: "50%", r: "50%" },
        svg("stop", { offset: "0.25", "stop-color": "#c9ff9a" }),
        svg("stop", { offset: "0.7", "stop-color": "#4fd36a" }),
        svg("stop", { offset: "1", "stop-color": "#17703a" }),
      ),
    ),
    svg("circle", { cx: 20, cy: 20, r: 19.5, fill: "#0d1a10" }),
    svg(
      "g",
      { class: "sw-eye-lit" },
      svg("circle", { cx: 20, cy: 20, r: EYE_R, fill: "url(#sw-eye-glow)" }),
    ),
    svg("path", {
      d: sectorPath(-half, half),
      fill: "#0d1a10",
      class: "sw-eye-wedge",
    }),
    svg("path", {
      d: sectorPath(-half - WING_TURN, -half),
      fill: "url(#sw-eye-glow)",
      class: "sw-eye-wing sw-eye-left",
    }),
    svg("path", {
      d: sectorPath(half, half + WING_TURN),
      fill: "url(#sw-eye-glow)",
      class: "sw-eye-wing sw-eye-right",
    }),
    svg("circle", {
      cx: 20,
      cy: 20,
      r: 5.5,
      fill: "#1b120a",
      stroke: "#6b5326",
      "stroke-width": 0.8,
    }),
  );
}

/** A knob: a ridged Bakelite skirt, a domed cap and a pointer line. The gloss over it stays put as it turns. */
function knobDrawing(id: string, pointer: string): SVGElement {
  return svg(
    "svg",
    { class: "sw-knob-body", viewBox: "0 0 100 100", "aria-hidden": "true" },
    svg(
      "defs",
      {},
      svg(
        "radialGradient",
        { id, cx: "38%", cy: "34%", r: "70%" },
        svg("stop", { offset: "0", "stop-color": "#7a4a26" }),
        svg("stop", { offset: "0.55", "stop-color": "#46260f" }),
        svg("stop", { offset: "1", "stop-color": "#1e0f05" }),
      ),
    ),
    svg("circle", { cx: 50, cy: 50, r: 47, fill: "#2a160a" }),
    // The ridges round the skirt: a dashed ring, so a few hundred grooves cost one stroke.
    svg("circle", {
      cx: 50,
      cy: 50,
      r: 45,
      fill: "none",
      stroke: "#5a341a",
      "stroke-width": 4.5,
      "stroke-dasharray": "2.2 2.5",
    }),
    svg("circle", {
      cx: 50,
      cy: 50,
      r: 37,
      fill: `url(#${id})`,
      stroke: "#140a03",
      "stroke-width": 1.2,
    }),
    svg("circle", {
      cx: 50,
      cy: 50,
      r: 30,
      fill: "none",
      stroke: "rgba(255,226,180,0.12)",
      "stroke-width": 1,
    }),
    svg("rect", {
      x: 47.6,
      y: 9,
      width: 4.8,
      height: 26,
      rx: 2.4,
      fill: pointer,
    }),
  );
}

/** The printed ring of detent marks round a knob, on the cabinet: `n` short brass lines, one a detent. */
function ring(n: number, major: number): SVGElement {
  const lines = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * 2 * Math.PI;
    const big = i % major === 0;
    const r0 = big ? 43 : 45.5;
    return svg("line", {
      x1: (50 + r0 * Math.sin(a)).toFixed(2),
      y1: (50 - r0 * Math.cos(a)).toFixed(2),
      x2: (50 + 49 * Math.sin(a)).toFixed(2),
      y2: (50 - 49 * Math.cos(a)).toFixed(2),
      class: big ? "sw-ring-tick sw-ring-major" : "sw-ring-tick",
    });
  });
  return svg(
    "svg",
    { class: "sw-ring", viewBox: "0 0 100 100", "aria-hidden": "true" },
    ...lines,
  );
}

/**
 * A knob that turns by hand. It keeps its own angle, writes it to the picture, and says when a detent goes by. The
 * angle it shows follows the world (or the slider) when the reader isn't turning it.
 */
interface Wheel {
  el: HTMLElement;
  angle: number;
  /** Put the knob at an angle. `tick` is whether a detent passed counts as a click (the reader turned it). */
  set(angle: number, tick?: boolean): void;
  /** Whether it eases to where it is told (the time knob settling into its slot) or follows at once. */
  ease(on: boolean): void;
}

function wheel(
  el: HTMLElement,
  body: SVGElement,
  detent: number,
  onDetent: () => void,
  lo = -Infinity,
  hi = Infinity,
): Wheel {
  let idx = 0;
  const w: Wheel = {
    el,
    angle: 0,
    set(angle, tick = false) {
      angle = clamp(angle, lo, hi);
      if (angle === w.angle) return;
      w.angle = angle;
      body.style.transform = `rotate(${angle.toFixed(1)}deg)`;
      const i = detentAt(angle, detent);
      if (i !== idx) {
        idx = i;
        if (tick) onDetent();
      }
    },
    ease(on) {
      body.style.transition =
        on && !reduced() ? "transform 150ms ease-out" : "none";
    },
  };
  return w;
}

/** The angle of a pointer round a knob's centre, in degrees clockwise from straight up. */
function angleOf(el: HTMLElement, e: PointerEvent): number {
  const r = el.getBoundingClientRect();
  return (
    (Math.atan2(
      e.clientX - (r.left + r.width / 2),
      -(e.clientY - (r.top + r.height / 2)),
    ) *
      180) /
    Math.PI
  );
}

let tune: Wheel;
let timeKnob: Wheel;
let pawl: HTMLElement;
let lastPawl = 0;
/** The tuning knob's hand: under the finger, or flying on after it, or gliding to a key's target. */
let hand: "none" | "drag" | "fly" | "glide" = "none";
let flyFrame = 0;
let speed = 0;
let slider: HTMLInputElement | null = null;
let bandKeys: HTMLButtonElement[] = [];
let wantBand = -1;
let wantUntil = 0;
let lockLevel = 0;
let lockTarget = 0;
let lockShown = -1;
let lockFrame = 0;
let lockAt = 0;

export function mountDial(source: DialSource) {
  src = source;
  const mapEl = document.getElementById("map")!;
  slider = document.getElementById("time") as HTMLInputElement | null;
  nums = h("div", { class: "sw-nums", "aria-hidden": "true" });
  needle = h("div", { class: "sw-needle", "aria-hidden": "true" });
  scale = h("div", { class: "sw-scale" }, nums, needle);
  scale.prepend(ticks());
  const staticEl = h("div", { class: "sw-static", "aria-hidden": "true" });
  // The lamp behind the glass, under the printing, and the glass's own sheen over everything, both still pictures.
  const lamp = h("div", { class: "sw-lamp", "aria-hidden": "true" });
  const sheen = h("div", { class: "sw-sheen", "aria-hidden": "true" });
  const glass = h("div", { class: "sw-glass" }, lamp, scale, staticEl, sheen);
  const dial = h(
    "div",
    { class: "sw-dial", title: "Drag along the dial to turn the world" },
    glass,
  );

  // The tuning knob and the time knob.
  const tuneEl = h(
    "div",
    {
      class: "sw-knob",
      role: "slider",
      tabindex: "0",
      "aria-label": "Tuning. Turns the world east and west",
      "aria-valuemin": "-180",
      "aria-valuemax": "180",
    },
    h("span", { class: "sw-knob-gloss", "aria-hidden": "true" }),
  );
  const tuneBody = knobDrawing("sw-knob-cap", "#efe2c0");
  tuneEl.prepend(tuneBody);
  pawl = h("span", { class: "sw-pawl", "aria-hidden": "true" });
  tune = wheel(tuneEl, tuneBody, DETENT_DEG, onDetent);
  const timeEl = h(
    "div",
    {
      class: "sw-knob",
      role: "slider",
      tabindex: "0",
      "aria-label": "Time. Moves back through the last 24 hours",
      "aria-valuemin": "0",
      "aria-valuemax": String(slider?.max ?? 96),
    },
    h("span", { class: "sw-knob-gloss", "aria-hidden": "true" }),
  );
  const timeBody = knobDrawing("sw-knob-cap-b", "#e8c779");
  timeEl.prepend(timeBody);
  timeKnob = wheel(
    timeEl,
    timeBody,
    SLOT_DEG,
    () => click(0.3),
    0,
    angleOfSlot(Number(slider?.max ?? 96)),
  );

  // The band switch: one key for each of the map's zoom levels, and the Sound key.
  bandKeys = Array.from({ length: BAND_COUNT }, (_, i) =>
    h(
      "button",
      {
        type: "button",
        class: "sw-bandkey",
        "aria-pressed": "false",
        "aria-label": `Band ${i + 1} of ${BAND_COUNT}, zoom level`,
      },
      String(i + 1),
    ),
  );
  bandKeys.forEach((k, i) => {
    k.addEventListener("click", () => setBand(i));
    k.addEventListener("keydown", (e) => {
      const to =
        e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : null;
      if (to === null || to < 0 || to >= BAND_COUNT) return;
      e.preventDefault();
      setBand(to);
      bandKeys[to]!.focus();
    });
  });
  sound = h(
    "button",
    {
      type: "button",
      class: "sw-sound",
      "aria-pressed": "false",
      title:
        "Clicks as the knob turns and when a place locks in. Off until you press it.",
    },
    "Sound ",
    h("b", {}, "off"),
  );
  sound.addEventListener("click", () => {
    const on = setSound(!soundOn());
    sound.setAttribute("aria-pressed", String(on));
    sound.querySelector("b")!.textContent = on ? "on" : "off";
  });

  radio = h(
    "div",
    { class: "sw-radio", role: "group", "aria-label": "Tuning dial" },
    h("div", { class: "sw-grille", "aria-hidden": "true" }),
    h("div", { class: "sw-eye", "aria-hidden": "true" }, eye()),
    dial,
    h(
      "div",
      { class: "sw-strip" },
      h(
        "div",
        {
          class: "sw-bands",
          role: "group",
          "aria-label": "Band. Zoom level, from the whole world in",
        },
        h("span", { class: "sw-label", "aria-hidden": "true" }, "Band"),
        ...bandKeys,
      ),
      sound,
    ),
    // Small printed labels under the knobs, as a radio's front names its controls; each knob's own name is for screen readers.
    h(
      "div",
      { class: "sw-time" },
      h("div", { class: "sw-knobwrap" }, ring(16, 4), timeEl),
      h("span", { class: "sw-tune-label", "aria-hidden": "true" }, "Time"),
    ),
    h(
      "div",
      { class: "sw-tune" },
      h("div", { class: "sw-knobwrap" }, ring(36, 3), pawl, tuneEl),
      h("span", { class: "sw-tune-label", "aria-hidden": "true" }, "Tuning"),
    ),
  );
  radio.style.setProperty("--sw-static", String(STATIC_OPACITY));
  radio.style.setProperty("--sw-drift", `${STATIC_DRIFT_S}s`);
  radio.style.setProperty("--sw-wing", `${WING_TURN}deg`);
  radio.style.setProperty("--sw-dim", String(LAMP_DIM));
  radio.style.setProperty("--sw-needle-ease", `${NEEDLE_EASE_MS}ms`);
  radio.style.setProperty("--sw-lock", "0");
  mapEl.after(radio);

  // The window: the needle goes where it is pressed and follows the pointer, as if it were picked up. Letting go lets
  // the nearest place glide under it.
  const fromPointer = (e: PointerEvent) => {
    const r = scale.getBoundingClientRect();
    if (r.width > 0) src?.turnTo(lonAt((e.clientX - r.left) / r.width));
  };
  dial.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    dial.setPointerCapture(e.pointerId);
    radio.classList.add("dragging");
    cancelFly();
    handAt = performance.now();
    fromPointer(e);
  });
  dial.addEventListener("pointermove", (e) => {
    if (!dial.hasPointerCapture(e.pointerId)) return;
    handAt = performance.now();
    fromPointer(e);
  });
  const dropDial = () => {
    if (!radio.classList.contains("dragging")) return;
    radio.classList.remove("dragging");
    src?.snap();
  };
  dial.addEventListener("pointerup", dropDial);
  dial.addEventListener("pointercancel", dropDial);

  mountTuning(tuneEl);
  mountTime(timeEl);

  // Page Up and Page Down change band wherever the reader is on the radio or on the map itself, and the arrows tune
  // when nothing at all has focus. In a field, a menu or a dialog the keys are left to them, and the panel keeps its own
  // scrolling.
  // It listens before the map does (capture), because the map's own Page keys tilt it and here they change band.
  document.addEventListener(
    "keydown",
    (e) => {
      if (
        !src ||
        src.theme() !== "shortwave" ||
        e.defaultPrevented ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey
      )
        return;
      const t = e.target as HTMLElement;
      const onMap = t.closest("#map") !== null && t.tagName === "CANVAS";
      const onRadio = t.closest(".sw-radio") !== null;
      if (e.key === "PageUp" || e.key === "PageDown") {
        if (!(onMap || onRadio || t === document.body)) return;
        e.preventDefault();
        e.stopPropagation();
        setBand(bandStep(shownBand(), e.key === "PageUp" ? 1 : -1));
      } else if (
        (e.key === "ArrowLeft" || e.key === "ArrowRight") &&
        t === document.body
      ) {
        e.preventDefault();
        glide(
          (e.key === "ArrowRight" ? 1 : -1) *
            (e.shiftKey ? 1 : KEY_DETENTS) *
            DETENT_DEG,
        );
      }
    },
    true,
  );
  // Nothing runs in a hidden tab: a spin or a glide stops where it is, and the eye takes its resting state.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) return;
    cancelFly();
    if (lockFrame) cancelAnimationFrame(lockFrame);
    lockFrame = 0;
    setLock(lockTarget);
  });

  new ResizeObserver(() => layoutScale()).observe(scale);
  moveDial();
}

// ---- the tuning knob --------------------------------------------------------

function onDetent() {
  const now = performance.now();
  click(clamp(Math.abs(speed) / 700, 0.2, 1));
  // A small pawl taps the knob's rim as each detent goes by: a nudge of two pixels, never a change of light, and not
  // more than twenty-five times a second so a fast spin costs nothing.
  if (reduced() || now - lastPawl < 40) return;
  lastPawl = now;
  pawl.animate(
    [
      { transform: "translateY(0)" },
      { transform: "translateY(2.5px)" },
      { transform: "translateY(0)" },
    ],
    { duration: 70 },
  );
}

/** The knob turned `d` degrees by the hand, or by a spin or a glide: its detents shape the turn, and the world follows. */
function turnKnob(d: number, fromHand: boolean) {
  const s = fromHand ? detentStep(tune.angle, d) : d;
  tune.set(tune.angle + s, true);
  handAt = performance.now();
  src?.turnBy(s * PX_PER_KNOB_DEG);
  return s;
}

function cancelFly() {
  if (flyFrame) cancelAnimationFrame(flyFrame);
  flyFrame = 0;
  if (hand === "fly" || hand === "glide") hand = "none";
  radio?.classList.remove("turning");
}

/** Let go while turning: the knob spins on at `omega` degrees a second, slows, and falls into a detent, then the place glides under. */
function fly(omega: number) {
  cancelFly();
  hand = "fly";
  radio.classList.add("turning");
  let s = { angle: tune.angle, speed: omega };
  const start = performance.now();
  let last = start;
  const tick = (now: number) => {
    const dt = Math.min(0.04, (now - last) / 1000);
    last = now;
    const before = s.angle;
    // Small steps keep the detents' pull stable however long a frame was.
    const n = Math.max(1, Math.ceil(dt / 0.004));
    for (let i = 0; i < n; i++) s = spinStep(s, dt / n);
    speed = s.speed;
    // A knob let go exactly on the crest between two detents would wait there; after two and a half seconds it rests.
    if (atRest(s) || now - start > 2500) {
      s = { angle: detentAt(s.angle) * DETENT_DEG, speed: 0 };
      turnKnob(s.angle - tune.angle, false);
      endTurn();
      return;
    }
    turnKnob(s.angle - before, false);
    flyFrame = requestAnimationFrame(tick);
  };
  flyFrame = requestAnimationFrame(tick);
}

function endTurn() {
  flyFrame = 0;
  hand = "none";
  speed = 0;
  radio.classList.remove("turning");
  src?.snap();
}

/** An arrow key's turn: the knob eases `deg` further round (keys held add up) and then the nearest place glides under. */
let glideTo = 0;
function glide(deg: number) {
  const base = hand === "glide" ? glideTo : detentAt(tune.angle) * DETENT_DEG;
  cancelFly();
  glideTo = base + deg;
  handAt = performance.now();
  if (reduced() || document.hidden) {
    turnKnob(glideTo - tune.angle, false);
    src?.snap();
    return;
  }
  hand = "glide";
  radio.classList.add("turning");
  const tick = () => {
    const left = glideTo - tune.angle;
    const part = Math.abs(left) < 0.4 ? left : left * 0.3;
    speed = part * 60;
    turnKnob(part, false);
    if (Math.abs(glideTo - tune.angle) > 0.01)
      flyFrame = requestAnimationFrame(tick);
    else endTurn();
  };
  flyFrame = requestAnimationFrame(tick);
}

function mountTuning(el: HTMLElement) {
  let prev = 0;
  let lastT = 0;
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    el.setPointerCapture(e.pointerId);
    cancelFly();
    hand = "drag";
    prev = angleOf(el, e);
    lastT = performance.now();
    speed = 0;
    radio.classList.add("turning");
    el.focus({ preventScroll: true });
  });
  el.addEventListener("pointermove", (e) => {
    if (hand !== "drag" || !el.hasPointerCapture(e.pointerId)) return;
    const a = angleOf(el, e);
    const d = turnBetween(prev, a);
    prev = a;
    if (!d) return;
    const now = performance.now();
    const s = turnKnob(d, true);
    const dt = now - lastT;
    lastT = now;
    if (dt > 0) speed = flick(0.6 * ((s / dt) * 1000) + 0.4 * speed);
  });
  const drop = () => {
    if (hand !== "drag") return;
    const idle = performance.now() - lastT > 90;
    hand = "none";
    if (reduced() || document.hidden) {
      // No spin: the knob rests where the nearest detent is and the nearest place glides under.
      turnKnob(detentAt(tune.angle) * DETENT_DEG - tune.angle, false);
      radio.classList.remove("turning");
      src?.snap();
    } else fly(idle ? 0 : speed);
  };
  el.addEventListener("pointerup", drop);
  el.addEventListener("pointercancel", drop);
  // The wheel turns it too: a notch is a few detents, and the place glides under a moment after the last notch.
  let wheelTimer = 0;
  el.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      cancelFly();
      handAt = performance.now();
      turnKnob(clamp(-e.deltaY, -120, 120) * 0.12, true);
      clearTimeout(wheelTimer);
      wheelTimer = window.setTimeout(() => src?.snap(), 220);
    },
    { passive: false },
  );
  el.addEventListener("keydown", (e) => {
    const dir =
      e.key === "ArrowRight" || e.key === "ArrowUp"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowDown"
          ? -1
          : 0;
    if (!dir) return;
    e.preventDefault();
    glide(dir * (e.shiftKey ? 1 : KEY_DETENTS) * DETENT_DEG);
  });
}

// ---- the time knob ----------------------------------------------------------

function mountTime(el: HTMLElement) {
  let prev = 0;
  let dragging = false;
  const slotNow = () => Number(slider?.value ?? 0);
  /** Put the time bar's slider at a slot, the way the reader's own drag on it would. */
  const goSlot = (slot: number) => {
    if (!slider || slot === slotNow()) return;
    slider.value = String(slot);
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  };
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    el.setPointerCapture(e.pointerId);
    dragging = true;
    timeKnob.ease(false);
    prev = angleOf(el, e);
    el.focus({ preventScroll: true });
  });
  el.addEventListener("pointermove", (e) => {
    if (!dragging || !el.hasPointerCapture(e.pointerId)) return;
    const a = angleOf(el, e);
    const d = turnBetween(prev, a);
    prev = a;
    if (!d) return;
    timeKnob.set(
      timeKnob.angle + detentStep(timeKnob.angle, d, SLOT_DEG),
      true,
    );
    goSlot(slotOfAngle(timeKnob.angle));
  });
  const drop = () => {
    if (!dragging) return;
    dragging = false;
    // It settles into its slot's detent.
    timeKnob.ease(true);
    timeKnob.set(angleOfSlot(slotNow()));
  };
  el.addEventListener("pointerup", drop);
  el.addEventListener("pointercancel", drop);
  el.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      timeKnob.ease(true);
      goSlot(
        clamp(
          slotNow() + (e.deltaY < 0 ? 1 : -1),
          0,
          Number(slider?.max ?? 96),
        ),
      );
      timeKnob.set(angleOfSlot(slotNow()), true);
    },
    { passive: false },
  );
  el.addEventListener("keydown", (e) => {
    const to: Record<string, number> = {
      ArrowRight: slotNow() + 1,
      ArrowUp: slotNow() + 1,
      ArrowLeft: slotNow() - 1,
      ArrowDown: slotNow() - 1,
      Home: 0,
      End: Number(slider?.max ?? 96),
    };
    const slot = to[e.key];
    if (slot === undefined) return;
    e.preventDefault();
    timeKnob.ease(true);
    goSlot(clamp(slot, 0, Number(slider?.max ?? 96)));
    timeKnob.set(angleOfSlot(slotNow()), true);
  });
  // A knob that is being turned is left alone; otherwise it stands where the slider is (Replay moves it, so does Live).
  timeSync = () => {
    if (dragging || !slider) return;
    const v = slotNow();
    if (angleOfSlot(v) !== timeKnob.angle) {
      timeKnob.ease(true);
      timeKnob.set(angleOfSlot(v));
    }
    const label = document.getElementById("time-label")?.textContent ?? "";
    if (label !== timeLabel) {
      timeLabel = label;
      el.setAttribute("aria-valuetext", label);
    }
    if (String(v) !== el.getAttribute("aria-valuenow"))
      el.setAttribute("aria-valuenow", String(v));
  };
  timeSync();
}
let timeSync: () => void = () => {};
let timeLabel = "";

// ---- the bands --------------------------------------------------------------

function shownBand(): number {
  return performance.now() < wantUntil && wantBand >= 0
    ? wantBand
    : bandOf(src?.level() ?? 0);
}

function setBand(band: number) {
  band = bandOf(band);
  wantBand = band;
  wantUntil = performance.now() + 700;
  handAt = performance.now();
  src?.band(band);
  showBand();
}

let lastBand = -1;
function showBand() {
  const b = shownBand();
  if (b === lastBand) return;
  lastBand = b;
  bandKeys.forEach((k, i) => {
    k.setAttribute("aria-pressed", String(i === b));
    k.classList.toggle("on", i === b);
  });
}

// ---- the dial's scale and needle --------------------------------------------

/** The printed numbers: as many as fit the window's width, each centred on its longitude. */
function layoutScale() {
  const w = scale.clientWidth;
  if (!w) return;
  const s = scaleStep(w);
  if (s === step) return;
  step = s;
  nums.replaceChildren(
    ...scaleLabels(s).map((l) => {
      const el = h(
        "span",
        {
          class:
            l.lon === -180
              ? "sw-num sw-first"
              : l.lon === 180
                ? "sw-num sw-last"
                : "sw-num",
        },
        l.num,
        l.side ? h("small", {}, l.side) : null,
      );
      el.style.left = `${(dialAt(l.lon) * 100).toFixed(3)}%`;
      if (l.lon === 180) el.style.left = "100%";
      return el;
    }),
  );
}

/** The eye and the static read one number, 0 with no place near to 1 with one tuned. */
function setLock(v: number) {
  lockLevel = v;
  const q = Math.round(v * 100) / 100;
  if (q === lockShown) return;
  lockShown = q;
  radio.style.setProperty("--sw-lock", String(q));
  radio.style.setProperty("--sw-glow", lampLevel(q).toFixed(3));
}

function aimLock(target: number) {
  lockTarget = target;
  // Reduced motion, or a hidden tab: no easing, the eye shows where it is going at once.
  if (reduced() || document.hidden) {
    if (lockFrame) cancelAnimationFrame(lockFrame);
    lockFrame = 0;
    setLock(target);
    return;
  }
  if (lockFrame || Math.abs(lockLevel - target) < 0.004) return;
  lockAt = performance.now();
  lockFrame = requestAnimationFrame(stepLock);
}

function stepLock(now: number) {
  lockFrame = 0;
  const dt = Math.min(0.1, (now - lockAt) / 1000);
  lockAt = now;
  setLock(smoothLock(lockLevel, lockTarget, dt));
  if (Math.abs(lockLevel - lockTarget) > 0.004)
    lockFrame = requestAnimationFrame(stepLock);
  else setLock(lockTarget);
}

/** A place has just come under the reticle: a small mechanical clack, and with the sound on, a thunk if the reader caused it. */
function lockedIn() {
  radio.classList.remove("clack");
  void radio.offsetWidth;
  radio.classList.add("clack");
  clearTimeout(clackTimer);
  clackTimer = window.setTimeout(() => radio.classList.remove("clack"), 360);
  if (performance.now() - handAt < 2500) thunk();
}

/** On every frame the map draws: the needle to the reticle's longitude, the knob after it, the eye, the bands and the time. */
export function moveDial() {
  if (!src || src.theme() !== "shortwave") {
    lastLon = NaN;
    return;
  }
  const lon = src.center()[0];
  if (lon !== lastLon) {
    // Something other than the knob turned the world (the dial's window, a flight to a place, the idle spin): the
    // knob follows through its gearing.
    if (
      hand === "none" &&
      performance.now() - handAt > 160 &&
      Number.isFinite(lastLon)
    )
      tune.set(tune.angle + turnBetween(lastLon, lon) * KNOB_PER_DEG);
    lastLon = lon;
    const at = Math.round(dialAt(lon) * 10000) / 10000;
    if (at !== lastAt) {
      // The needle eases a little behind the reticle, but a jump across the date line or a press at the far end
      // goes at once, so it never whips across the whole dial.
      const jump = lastAt >= 0 && needleJumps(lastAt, at);
      if (jump) {
        radio.classList.add("jump");
        radio.style.setProperty("--sw-at", String(at));
        void needle.offsetWidth;
        radio.classList.remove("jump");
      } else radio.style.setProperty("--sw-at", String(at));
      lastAt = at;
    }
    const now = String(Math.round(lon));
    if (now !== lastNow) {
      lastNow = now;
      tune.el.setAttribute("aria-valuenow", now);
      tune.el.setAttribute("aria-valuetext", lonText(lon));
    }
  }
  const tuned = src.tuned();
  if (tuned !== wasTuned) {
    if (tuned && wasTuned !== null) lockedIn();
    wasTuned = tuned;
    radio.classList.toggle("tuned", tuned);
  }
  aimLock(reduced() ? (tuned ? 1 : 0) : lockOf(src.nearest(), tuned));
  showBand();
  timeSync();
  if (!step) layoutScale();
}
