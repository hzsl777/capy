type Child = Node | string | null | undefined | false;

/**
 * Tiny element builder. Text always goes in as text nodes, never as HTML:
 * headlines and previews come from third parties.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | undefined> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) el.setAttribute(k, v);
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return el;
}

/** Returns the URL only if it is http(s) (https only when `httpsOnly`). */
export function safeUrl(url: string | undefined, httpsOnly = false): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol === "https:" || (!httpsOnly && u.protocol === "http:")) return u.href;
  } catch {
    /* fall through */
  }
  return null;
}
