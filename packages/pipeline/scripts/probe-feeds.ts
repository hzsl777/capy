// Probes many candidate feed addresses per outlet from wherever it runs (Preflight on GitHub's servers), for fixing
// sources that fail `sources check`. Input: a TSV of `id<TAB>url` lines (the configured address and any candidates).
// For each id it tries those URLs, the usual feed paths at the site's root (with and without www), and every feed a
// fetched page links to. Prints one line per distinct feed found, the feed links pages declare, and a summary.
// Usage: npx tsx packages/pipeline/scripts/probe-feeds.ts probe.tsv
import { readFileSync } from "node:fs";
import Parser from "rss-parser";
import { ingestWindow } from "@2dayai/core";
import { feedLinksIn, USER_AGENT } from "../src/stages/ingest.js";
import { decodeBody } from "../src/text.js";

const PATHS = [
  "/", "/feed/", "/feed", "/rss", "/rss/", "/rss.xml", "/feed.xml", "/atom.xml", "/index.xml", "/index.rss", "/?feed=rss2",
  "/feed/rss2/", "/feed/atom/", "/rss/news", "/rss/all", "/rss/latest", "/rss/index.xml", "/rss/home.xml", "/rss.php",
  "/feeds/posts/default?alt=rss", "/index.php?format=feed&type=rss", "/arc/outboundfeeds/rss/?outputType=xml",
  "/news/feed/", "/noticias/feed/", "/actualites/feed/", "/latest.rss", "/rss/rss.xml", "/feeds/all.rss", "/rssfeed",
];
const parser = new Parser({ customFields: { item: [["dc:date", "dcDate"]] } });
const { from, to } = ingestWindow("2026-09-30" as never);
const clip = (s: unknown, n: number) => String(s ?? "").replace(/\s+/g, " ").replace(/"/g, "'").trim().slice(0, n);

async function get(url: string): Promise<{ status: number; text?: string; error?: string }> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, text/html;q=0.8, */*;q=0.5" },
      signal: AbortSignal.timeout(12_000),
      redirect: "follow",
    });
    if (!res.ok) return { status: res.status };
    return { status: res.status, text: decodeBody(new Uint8Array(await res.arrayBuffer()), res.headers.get("content-type")) };
  } catch (err) {
    return { status: 0, error: clip(err instanceof Error ? (err.cause as Error)?.message ?? err.message : err, 40) };
  }
}

async function probe(id: string, given: string[]): Promise<void> {
  const queue: string[] = [...given];
  for (const u of given) {
    let url: URL;
    try { url = new URL(u); } catch { continue; }
    const bare = url.hostname.replace(/^www\./, "");
    for (const host of [url.hostname, url.hostname.startsWith("www.") ? bare : `www.${bare}`]) for (const p of PATHS) queue.push(`https://${host}${p}`);
  }
  const seen = new Set<string>();
  const feeds = new Set<string>();
  const codes = new Map<string, number>();
  let netFails = 0;
  for (let i = 0; i < queue.length && seen.size < 90; i++) {
    const url = queue[i]!;
    if (seen.has(url)) continue;
    seen.add(url);
    if (netFails >= 6 && i >= given.length) break;
    const r = await get(url);
    const key = r.error ?? String(r.status);
    if (!r.text) {
      codes.set(key, (codes.get(key) ?? 0) + 1);
      if (r.status === 0) netFails++;
      continue;
    }
    const text = r.text;
    if (/<(rss|feed|rdf:RDF)[\s>]/i.test(text.slice(0, 4000))) {
      try {
        const f = await parser.parseString(text);
        const items = f.items ?? [];
        const dates = items.map((it) => new Date(it.isoDate ?? it.pubDate ?? (it as { dcDate?: string }).dcDate ?? NaN)).filter((d) => !Number.isNaN(d.getTime()));
        const newest = dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))).toISOString().slice(0, 16) : "none";
        const d30 = dates.filter((d) => d >= from && d < to).length;
        const sig = `${clip(f.title, 60)}|${clip(items[0]?.title, 60)}`;
        if (feeds.has(sig)) continue;
        feeds.add(sig);
        const first = items[0] as Record<string, unknown> | undefined;
        const raw = clip(first?.pubDate ?? first?.isoDate ?? first?.dcDate ?? "", 40);
        console.log(`P ${id} FEED ${url} n=${items.length} dated=${dates.length} newest=${newest} d30=${d30} raw="${raw}" title="${clip(f.title, 70)}" h="${items.slice(0, 3).map((it) => clip(it.title, 70)).join(" | ")}"`);
      } catch (err) {
        console.log(`P ${id} BADFEED ${url} ${clip(err instanceof Error ? err.message : err, 60)}`);
      }
      continue;
    }
    const declared = feedLinksIn(text, url);
    const anchors = [...text.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)].map((m) => m[1]!).filter((h) => /(rss|feed|atom)/i.test(h) && !/(facebook|twitter|instagram|feedly|feedburner\.google|comments)/i.test(h));
    const links: string[] = [];
    for (const h of [...declared, ...anchors].slice(0, 12)) {
      try { links.push(new URL(h.replace(/&amp;/g, "&"), url).toString()); } catch { /* skip */ }
    }
    const challenge = /just a moment|cf-chl|captcha|attention required|access denied/i.test(text.slice(0, 5000));
    if (links.length || challenge || given.includes(url)) console.log(`P ${id} PAGE ${url} ${challenge ? "CHALLENGE " : ""}links=${[...new Set(links)].join(" ")}`);
    for (const l of links) if (!seen.has(l)) queue.splice(i + 1, 0, l);
  }
  console.log(`P ${id} SUM feeds=${feeds.size} tried=${seen.size} codes=${[...codes].map(([k, v]) => `${k}:${v}`).join(",")}`);
}

const byId = new Map<string, string[]>();
for (const line of readFileSync(process.argv[2]!, "utf8").split("\n")) {
  const [id, url] = line.split("\t").map((s) => s?.trim());
  if (id && url) byId.set(id, [...(byId.get(id) ?? []), url]);
}
const ids = [...byId.keys()];
let next = 0;
await Promise.all(Array.from({ length: 24 }, async () => {
  while (next < ids.length) {
    const id = ids[next++]!;
    await probe(id, byId.get(id)!);
  }
}));
console.log(`P DONE ${ids.length} ids`);
