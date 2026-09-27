/**
 * Fetches the small preview an outlet publishes for social cards (og:description,
 * og:image) and checks whether the outlet allows its page to be framed.
 * This is what powers the in-app reader. It never stores article body text:
 * republishing full articles is a copyright problem, and outlets already choose
 * what goes in their preview tags.
 *
 * Polite by default: identifies itself, honours robots.txt, reads at most 256 KB
 * of each page, and caches results so each URL is fetched once.
 */
import { decodeEntities } from "./gkg.ts";

export const USER_AGENT =
  "CapyNewsMap/0.1 (+https://github.com/hzsl777/capy; preview metadata only)";

export interface Meta {
  excerpt?: string;
  image?: string;
  embed: boolean;
  /** Unix seconds when fetched, for cache pruning. */
  at: number;
}

type Fetch = typeof fetch;

export function parseMeta(html: string): { description?: string; image?: string } {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  const found: Record<string, string> = {};
  for (const tag of tags) {
    const attrs: Record<string, string> = {};
    for (const m of tag.matchAll(/([a-z:_-]+)\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
      attrs[m[1].toLowerCase()] = m[3] ?? m[4] ?? "";
    }
    const key = (attrs.property ?? attrs.name ?? "").toLowerCase();
    if (key && attrs.content && !(key in found)) found[key] = attrs.content;
  }
  const description = found["og:description"] ?? found["twitter:description"] ?? found["description"];
  const image = found["og:image"] ?? found["twitter:image"];
  return {
    description: description ? clip(decodeEntities(description).replace(/\s+/g, " ").trim(), 300) : undefined,
    image: image && /^https:\/\//.test(image) ? image : undefined,
  };
}

export function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.4 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, "") + "...";
}

/** False when X-Frame-Options or CSP frame-ancestors would block us from framing the page. */
export function allowsEmbedding(headers: Headers, finalUrl: string): boolean {
  if (!finalUrl.startsWith("https://")) return false; // mixed content would be blocked anyway
  if (headers.get("x-frame-options")) return false;
  const csp = headers.get("content-security-policy") ?? "";
  const fa = /frame-ancestors([^;]*)/i.exec(csp);
  if (fa && !/(^|\s)\*(\s|$)/.test(fa[1])) return false;
  return true;
}

export function robotsAllows(robots: string, path: string, agent = "capynewsmap"): boolean {
  // Minimal robots.txt reading: groups for our agent, else "*"; longest match wins.
  const groups: { agents: string[]; rules: [boolean, string][] }[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === "user-agent") {
      if (!lastWasAgent || !current) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else if ((key === "allow" || key === "disallow") && current) {
      if (val) current.rules.push([key === "allow", val]);
      lastWasAgent = false;
    } else {
      lastWasAgent = false;
    }
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && agent.includes(a)));
  const applicable = mine.length ? mine : groups.filter((g) => g.agents.includes("*"));
  let best: [boolean, string] | null = null;
  for (const g of applicable) {
    for (const rule of g.rules) {
      if (path.startsWith(rule[1].replace(/\*$/, "")) && (!best || rule[1].length > best[1].length)) best = rule;
    }
  }
  return best ? best[0] : true;
}

async function readCapped(res: Response, limit: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  await reader.cancel().catch(() => {});
  return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
}

export interface EnrichOptions {
  limit: number;
  concurrency: number;
  timeoutMs: number;
  fetchImpl?: Fetch;
}

export async function enrich(
  urls: string[],
  cache: Map<string, Meta>,
  opts: EnrichOptions,
): Promise<number> {
  const f = opts.fetchImpl ?? fetch;
  const robots = new Map<string, Promise<string>>();
  const todo = urls.filter((u) => !cache.has(u)).slice(0, opts.limit);
  const now = Math.floor(Date.now() / 1000);

  const get = (url: string) =>
    f(url, {
      headers: { "user-agent": USER_AGENT, accept: "text/html,*/*;q=0.5" },
      redirect: "follow",
      signal: AbortSignal.timeout(opts.timeoutMs),
    });

  async function one(url: string) {
    let origin: string;
    let path: string;
    try {
      const u = new URL(url);
      origin = u.origin;
      path = u.pathname + u.search;
    } catch {
      return;
    }
    if (!robots.has(origin)) {
      robots.set(
        origin,
        get(`${origin}/robots.txt`)
          .then((r) => (r.ok ? readCapped(r, 64_000) : ""))
          .catch(() => ""),
      );
    }
    if (!robotsAllows(await robots.get(origin)!, path)) {
      cache.set(url, { embed: false, at: now });
      return;
    }
    try {
      const res = await get(url);
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok || !type.includes("html")) {
        cache.set(url, { embed: false, at: now });
        await res.body?.cancel().catch(() => {});
        return;
      }
      const meta = parseMeta(await readCapped(res, 256_000));
      cache.set(url, {
        excerpt: meta.description,
        image: meta.image,
        embed: allowsEmbedding(res.headers, res.url || url),
        at: now,
      });
    } catch {
      cache.set(url, { embed: false, at: now });
    }
  }

  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(opts.concurrency, todo.length) }, async () => {
      while (next < todo.length) await one(todo[next++]);
    }),
  );
  return todo.length;
}
