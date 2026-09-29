// Postgres refuses the NUL character in text and in JSON, so one stray control character in a feed, a page or a
// model's answer used to fail the whole write. Tab, newline and carriage return are kept.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function noControl(s: string): string {
  return s.replace(CONTROL, "");
}

/** The same for every string inside a parsed JSON value. */
export function noControlDeep<T>(value: T): T {
  if (typeof value === "string") return noControl(value) as T;
  if (Array.isArray(value)) return value.map(noControlDeep) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, noControlDeep(v)])) as T;
  return value;
}

/** The encoding a response names: the Content-Type charset, then an XML declaration or HTML meta tag. */
function declared(bytes: Uint8Array, contentType: string | null): string[] {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 2048));
  const found = [
    /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType ?? "")?.[1],
    /<\?xml[^>]*encoding\s*=\s*["']([\w.:-]+)["']/i.exec(head)?.[1],
    /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(head)?.[1],
  ];
  return [...new Set(found.filter((l): l is string => !!l).map((l) => l.toLowerCase()))];
}

function decodeAs(bytes: Uint8Array, label: string): string | null {
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * A feed or page as text in the encoding it declares. Reading every response as UTF-8 turned each accented letter
 * of a Latin-1 feed into U+FFFD (decision 52). When the header and the document disagree, the reading with fewer
 * broken characters wins.
 */
export function decodeBody(bytes: Uint8Array, contentType: string | null): string {
  let best: string | null = null;
  for (const label of [...declared(bytes, contentType), "utf-8"]) {
    const text = decodeAs(bytes, label);
    if (text === null) continue;
    const broken = (s: string) => s.split("\uFFFD").length - 1;
    if (best === null || broken(text) < broken(best)) best = text;
    if (broken(best) === 0) break;
  }
  return best ?? new TextDecoder().decode(bytes);
}
