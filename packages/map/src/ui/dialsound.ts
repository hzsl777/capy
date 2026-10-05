// Shortwave's optional sound (src/ui/dial.ts): a soft click as the tuning knob passes a detent and a low thunk as a
// place locks in, made here from a burst of noise and a short falling tone, never a recording. It is off until the
// reader switches it on with the Sound key, never starts by itself, and plays only as an answer to something the
// reader just did, and never in a hidden tab.

import { CLICK_GAP_MS } from "../map/shortwave.ts";

let ctx: AudioContext | null = null;
let on = false;
let last = 0;

/** The sound in this browser, if it has one. */
function context(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    ctx = null;
  }
  return ctx;
}

/** Switch the sound on or off. Turning on must come from a click or key press; the result is what it is now. */
export function setSound(next: boolean): boolean {
  if (!next) {
    on = false;
    return false;
  }
  const c = context();
  if (!c) return false;
  void c.resume().catch(() => {});
  on = true;
  click(1);
  return true;
}

export function soundOn(): boolean {
  return on;
}

function ready(): AudioContext | null {
  if (!on || document.hidden || !ctx || ctx.state !== "running") return null;
  const now = performance.now();
  if (now - last < CLICK_GAP_MS) return null;
  last = now;
  return ctx;
}

/** A detent's click: a few milliseconds of noise through a band, a touch brighter the faster the knob turns. */
export function click(strength = 0.6) {
  const c = ready();
  if (!c) return;
  const n = Math.floor(c.sampleRate * 0.012);
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 2;
  const src = c.createBufferSource();
  src.buffer = buf;
  const band = c.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 1800 + 1400 * strength;
  band.Q.value = 1.2;
  const gain = c.createGain();
  gain.gain.value = 0.12 + 0.12 * strength;
  src.connect(band).connect(gain).connect(c.destination);
  src.start();
}

/** A place locking in: a low tone falling over a tenth of a second, soft at both ends. */
export function thunk() {
  const c = ready();
  if (!c) return;
  const t = c.currentTime;
  const osc = c.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(130, t);
  osc.frequency.exponentialRampToValueAtTime(58, t + 0.11);
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.26, t + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
  osc.connect(gain).connect(c.destination);
  osc.start(t);
  osc.stop(t + 0.16);
}
