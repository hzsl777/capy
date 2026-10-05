// A reader's first visit: one short line at the top of the panel, which is where the reports show. It goes away for good
// after the first drag or tap on the map, a pick in search, or its close button. The rule for showing it once is in
// src/hint.ts. It sits in the panel's own flow, so it never covers the reticle, the Key, the zoom buttons or a place.
import { DRAG_PX, hintGate } from "../hint.ts";
import { h } from "./dom.ts";

export type HintHost = {
  /** The map's element, where a drag or a tap ends the hint. */
  map: () => HTMLElement;
  /** Puts the line where the reports show: the top of the panel, or wherever a design keeps them on screen. */
  mount: (line: HTMLElement) => void;
  /** True while the line belongs on screen: the panel lists a place's or the day's reports. */
  wanted: () => boolean;
};

export function mountHint(host: HintHost) {
  const gate = hintGate(() => {
    try {
      return localStorage;
    } catch {
      return null;
    }
  });
  let node: HTMLElement | null = null;

  function dismiss() {
    node?.remove();
    node = null;
  }

  /** Called once the day is loaded, with whether a shared link opened a place directly. */
  function start(sharedLink: boolean) {
    if (node || !gate.claim(sharedLink)) return;
    const close = h("button", { type: "button", class: "hint-close", "aria-label": "Close this tip" }, "×");
    close.addEventListener("click", dismiss);
    node = h("p", { id: "hint", class: "hint", role: "note" }, h("span", { class: "hint-text" }, "Drag the map to a place. Its reports show here."), close);
    attach();
    // The first drag or tap on the map, or a key that turns it, ends the hint.
    const map = host.map();
    let down: { x: number; y: number } | null = null;
    const end = () => {
      dismiss();
      map.removeEventListener("pointerdown", onDown, true);
      map.removeEventListener("pointermove", onMove, true);
      map.removeEventListener("pointerup", onUp, true);
      map.removeEventListener("keydown", onKey, true);
    };
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const onMove = (e: PointerEvent) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > DRAG_PX) end();
    };
    const onUp = () => {
      if (down) end();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key.startsWith("Arrow")) end();
    };
    map.addEventListener("pointerdown", onDown, true);
    map.addEventListener("pointermove", onMove, true);
    map.addEventListener("pointerup", onUp, true);
    map.addEventListener("keydown", onKey, true);
  }

  /** Puts the line at the top of the panel after the panel has been drawn; the panel's views replace their children. */
  function attach() {
    if (!node) return;
    if (host.wanted()) host.mount(node);
    else node.remove();
  }

  return { start, attach, dismiss };
}
