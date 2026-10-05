// Burger Joint's Topics menu: a small burger beside the topic chips, built from the topics that are on. Each topic is
// one thin layer between the two buns; turning a topic off takes its layer out and the stack settles. It only shows
// which topics are on, the way the count in the button does: the colours are arbitrary toppings and mean nothing, and
// every layer is the same height, in the topics' fixed order. Nothing here moves, and the figure is drawn, not read.

const NS = "http://www.w3.org/2000/svg";

/** The toppings' colours, one per topic in the topics' own order; arbitrary, never a rating of any topic. */
export const TOPPINGS = ["#7cc243", "#df4c30", "#f1b23a", "#5f7f23", "#a25ec0", "#46281a", "#e08a3a", "#ece2c0", "#3fa7ab", "#d9b46a"] as const;

const W = 64;
const BUN_TOP = 16;
const BUN_BOTTOM = 9;
const LAYER = 5;
const MAX_LAYERS = TOPPINGS.length;

export interface Layer {
  /** The topic's index in the full list. */
  index: number;
  y: number;
  color: string;
}

/**
 * The layers a stack of the topics that are on holds, bottom bun excluded, from the top bun down: one per topic that
 * is on, in the topics' order, each LAYER pixels tall.
 */
export function stackOf(on: readonly boolean[]): Layer[] {
  const out: Layer[] = [];
  let y = BUN_TOP;
  on.forEach((isOn, index) => {
    if (!isOn) return;
    out.push({ index, y, color: TOPPINGS[index % TOPPINGS.length]! });
    y += LAYER;
  });
  return out;
}

/** The figure's total height for this many layers. */
export const heightOf = (layers: number) => BUN_TOP + layers * LAYER + BUN_BOTTOM + 2;

function el(tag: string, attrs: Record<string, string | number>): SVGElement {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

/** The burger for these topics (true is on), as an SVG that is hidden from screen readers. */
export function burgerFigure(on: readonly boolean[]): SVGElement {
  const layers = stackOf(on);
  const H = heightOf(layers.length);
  const svg = el("svg", { viewBox: `0 0 ${W} ${heightOf(MAX_LAYERS)}`, class: "bg-stack", "aria-hidden": "true", focusable: "false" });
  svg.setAttribute("preserveAspectRatio", "xMidYMax meet");
  const shift = heightOf(MAX_LAYERS) - H;
  const g = el("g", { transform: `translate(0 ${shift})` });
  // The top bun: a dome.
  g.append(el("path", { d: `M4 ${BUN_TOP} C4 2 ${W - 4} 2 ${W - 4} ${BUN_TOP} Z`, fill: "#e0a043", stroke: "#7a4312", "stroke-width": 1.5, "stroke-linejoin": "round" }));
  g.append(el("path", { d: "M18 8 C22 5 30 4 36 5", fill: "none", stroke: "#f8d796", "stroke-width": 1.6, "stroke-linecap": "round" }));
  for (const l of layers) g.append(el("rect", { x: 2, y: l.y, width: W - 4, height: LAYER, rx: 2, fill: l.color, stroke: "#2a1d14", "stroke-width": 1, "data-topic": l.index }));
  const by = BUN_TOP + layers.length * LAYER;
  g.append(el("path", { d: `M4 ${by} H${W - 4} V${by + BUN_BOTTOM - 4} Q${W - 4} ${by + BUN_BOTTOM} ${W - 10} ${by + BUN_BOTTOM} H14 Q4 ${by + BUN_BOTTOM} 4 ${by + BUN_BOTTOM - 4} Z`, fill: "#d58f33", stroke: "#7a4312", "stroke-width": 1.5, "stroke-linejoin": "round" }));
  svg.append(g);
  return svg;
}

/**
 * Puts the figure first inside the Topics menu's chips, replacing the last one. `on` says for each topic, in order,
 * whether it is on. Called after the chips are rebuilt, and removes the figure in every other design.
 */
export function syncBurger(box: HTMLElement, active: boolean, on: readonly boolean[]) {
  box.querySelector(".bg-stack")?.remove();
  if (!active) return;
  box.prepend(burgerFigure(on));
}
