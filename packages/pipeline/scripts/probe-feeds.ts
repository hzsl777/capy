// Probes many candidate feed addresses per outlet from wherever it runs (Preflight on GitHub's servers), for fixing
// sources that fail `sources check`. Input: a TSV of `id<TAB>url` lines (the configured address and any candidates).
// For each id it tries those URLs, the usual feed paths at the site's root (with and without www), and every feed a
// fetched page links to. Prints one line per distinct feed found, the feed links pages declare, and a summary.
// Usage: npx tsx packages/pipeline/scripts/probe-feeds.ts probe.tsv
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
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
const OUT = process.argv[3];
if (OUT) writeFileSync(OUT, "");
const say = (line: string) => { console.log(line); if (OUT) appendFileSync(OUT, line + "\n"); };
/** Rejects after ms, so one feed the parser never finishes can't stall the probe. */
const within = <T>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<never>((_, no) => setTimeout(() => no(new Error("timed out")), ms))]);
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
  const found: { url: string; n: number; dated: number; newest: string; d30: number; raw: string; title: string; h: string }[] = [];
  const sigs = new Set<string>();
  const codes = new Map<string, number>();
  const pageLinks: string[] = [];
  let challenge = false;
  let netFails = 0;
  const began = Date.now();
  for (let i = 0; i < queue.length && seen.size < 90 && Date.now() - began < 200_000; i++) {
    const url = queue[i]!;
    if (seen.has(url)) continue;
    seen.add(url);
    if (netFails >= 6 && i >= given.length) break;
    const r = await get(url);
    if (!r.text) {
      const key = r.error ?? String(r.status);
      codes.set(key, (codes.get(key) ?? 0) + 1);
      if (r.status === 0) netFails++;
      continue;
    }
    const text = r.text;
    if (/<(rss|feed|rdf:RDF)[\s>]/i.test(text.slice(0, 4000))) {
      try {
        const f = await within(parser.parseString(text), 10_000);
        if (/comment|comentario|commentaire|kommentar/i.test(f.title ?? "")) continue;
        const items = f.items ?? [];
        const dates = items.map((it) => new Date(it.isoDate ?? it.pubDate ?? (it as { dcDate?: string }).dcDate ?? NaN)).filter((d) => !Number.isNaN(d.getTime()));
        const newest = dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))).toISOString().slice(0, 13) : "none";
        const sig = `${clip(f.title, 60)}|${clip(items[0]?.title, 60)}`;
        if (sigs.has(sig)) continue;
        sigs.add(sig);
        const first = items[0] as unknown as Record<string, unknown> | undefined;
        found.push({ url, n: items.length, dated: dates.length, newest, d30: dates.filter((d) => d >= from && d < to).length, raw: clip(first?.pubDate ?? first?.isoDate ?? first?.dcDate ?? "", 32), title: clip(f.title, 40), h: clip(items[0]?.title, 60) });
      } catch {
        codes.set("badfeed", (codes.get("badfeed") ?? 0) + 1);
      }
      continue;
    }
    const declared = feedLinksIn(text, url);
    const anchors = [...text.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)].map((m) => m[1]!).filter((h) => /(rss|feed|atom)/i.test(h) && !/(facebook|twitter|instagram|feedly|comments|\.css|\.js)/i.test(h));
    const links: string[] = [];
    for (const h of [...declared, ...anchors].slice(0, 12)) {
      try { links.push(new URL(h.replace(/&amp;/g, "&"), url).toString()); } catch { /* skip */ }
    }
    if (/just a moment|cf-chl|captcha|attention required|access denied/i.test(text.slice(0, 5000))) challenge = true;
    for (const l of links) {
      if (!pageLinks.includes(l)) pageLinks.push(l);
      if (!seen.has(l)) queue.splice(i + 1, 0, l);
    }
  }
  const recent = (x: string) => (x >= "2026-09-28" ? 1 : 0);
  found.sort((a, b) => b.d30 - a.d30 || recent(b.newest) - recent(a.newest) || b.dated - a.dated || b.n - a.n);
  const line = (tag: string, f: (typeof found)[number]) =>
    say(`${tag} ${id} ${f.url} d30=${f.d30} dated=${f.dated}/${f.n} new=${f.newest}${f.dated ? "" : ` raw="${f.raw}"`} t="${f.title}" h="${f.h}"`);
  if (found[0]) line("B", found[0]);
  if (found[1]) line("A", found[1]);
  if (!found.length) say(`N ${id} codes=${[...codes].map(([k, v]) => `${k}:${v}`).join(",")}${challenge ? " challenge" : ""}${pageLinks.length ? ` links=${pageLinks.slice(0, 3).join(" ")}` : ""}`);
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
    await within(probe(id, byId.get(id)!), 280_000).catch((err) => say(`N ${id} stopped: ${clip(err instanceof Error ? err.message : err, 40)}`));
  }
}));
say(`DONE ${ids.length} ids`);
process.exit(0);
