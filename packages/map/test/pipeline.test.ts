import { describe, expect, it } from "vitest";
import { decodeEntities, parseGkgDate, parseGkgLine } from "../pipeline/gkg.ts";
import { choosePlace, shortName } from "../pipeline/place.ts";
import { classify } from "../pipeline/topics.ts";
import { balance } from "../pipeline/balance.ts";
import { cluster } from "../pipeline/cluster.ts";
import { allowsEmbedding, clip, parseMeta, robotsAllows } from "../pipeline/enrich.ts";
import { stampsToFetch, stampToUnix, unixToStamp } from "../pipeline/gdelt.ts";
import { parseFeed } from "../pipeline/rss.ts";
import { toBcp47 } from "../pipeline/langs.ts";
import { toNewsFile, toPoolItem } from "../pipeline/ingest.ts";
import type { PoolItem } from "../pipeline/pool.ts";
import { COUNTRY, MOMBASA, NAIROBI, gkgRow } from "./helpers.ts";

describe("GKG parsing", () => {
  it("reads title, date, language, locations and image", () => {
    const rec = parseGkgLine(
      gkgRow({
        title: "Ferry &amp; port times &#8211; update",
        locations: `${COUNTRY};${MOMBASA};${NAIROBI}`,
        translation: "srclc:swa;eng:GT-SWA 1.0",
        image: "https://example-news.org/lead.jpg",
        themes: "ECON_TRADE;TAX_FNCACT_PORT",
      }),
    )!;
    expect(rec.title).toBe("Ferry & port times – update");
    expect(rec.t).toBe(Date.UTC(2026, 8, 27, 3, 15, 0) / 1000);
    expect(rec.lang).toBe("sw");
    expect(rec.locations).toHaveLength(3);
    expect(rec.image).toBe("https://example-news.org/lead.jpg");
  });

  it("drops rows without a title, non-web collections and short rows", () => {
    expect(parseGkgLine(gkgRow({ title: "" }))).toBeNull();
    expect(parseGkgLine(gkgRow({ collection: "2" }))).toBeNull();
    expect(parseGkgLine("a\tb\tc")).toBeNull();
  });

  it("decodes entities and dates", () => {
    expect(decodeEntities("&quot;A&quot; &#x41; &unknown;")).toBe('"A" A &unknown;');
    expect(parseGkgDate("bad")).toBeNaN();
  });
});

describe("place choice", () => {
  it("prefers the earliest city mention and never a country", () => {
    const rec = parseGkgLine(gkgRow({ locations: `${COUNTRY};${NAIROBI};${MOMBASA}` }))!;
    const place = choosePlace(rec.locations)!;
    expect(place.name).toBe("Mombasa"); // offset 40 beats offset 120
    expect(place.id).toBe("g:-1473306");
  });
  it("returns null when only a country is named", () => {
    const rec = parseGkgLine(gkgRow({ locations: COUNTRY }))!;
    expect(choosePlace(rec.locations)).toBeNull();
    expect(toPoolItem(rec)).toBeNull();
  });
  it("keeps only the first segment of a place name", () => {
    expect(shortName("Springfield, Illinois, United States")).toBe("Springfield");
  });
});

describe("topics", () => {
  it("prefers the outlet's URL section", () => {
    expect(classify(["ECON_INFLATION"], "https://x.org/sport/match-report")).toEqual(["sport"]);
  });
  it("falls back to the two strongest themes", () => {
    expect(classify(["NATURAL_DISASTER_FLOOD", "ENV_WATER", "ECON_PRICE", "TRIAL"], "https://x.org/a")).toEqual([
      "environment",
      "economy",
    ]);
  });
  it("returns nothing when there's no signal", () => {
    expect(classify([], "https://x.org/a")).toEqual([]);
  });
});

const item = (o: Partial<PoolItem> & { id: string }): PoolItem => ({
  t: 1000,
  title: o.id,
  url: `https://x.org/${o.id}`,
  domain: "x.org",
  lang: "en",
  topics: [],
  place: { id: "p1", name: "P1", lat: 0, lon: 0 },
  entities: [],
  ...o,
});

describe("balance", () => {
  it("lets outlets take turns within a place and caps each outlet", () => {
    const items = [
      ...Array.from({ length: 6 }, (_, i) => item({ id: `wire${i}`, domain: "wire.com", t: 2000 + i })),
      item({ id: "local1", domain: "local.org", t: 100 }),
      item({ id: "local2", domain: "local2.org", t: 50 }),
    ];
    const out = balance(items, { perPlace: 4, perDomainPerPlace: 3, perDomainGlobal: 100 });
    expect(out.map((i) => i.domain).sort()).toEqual(["local.org", "local2.org", "wire.com", "wire.com"]);
  });
  it("dedupes repeated headlines within a place and orders newest first", () => {
    const out = balance(
      [item({ id: "a", title: "Same!", domain: "a.org", t: 1 }), item({ id: "b", title: "same", domain: "b.org", t: 5 })],
      { perPlace: 10, perDomainPerPlace: 3, perDomainGlobal: 10 },
    );
    expect(out.map((i) => i.id)).toEqual(["b"]);
  });
  it("applies the global per-outlet cap", () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      item({ id: `w${i}`, domain: "wire.com", place: { id: `p${i}`, name: "", lat: 0, lon: 0 } }),
    );
    expect(balance(items, { perPlace: 5, perDomainPerPlace: 5, perDomainGlobal: 2 })).toHaveLength(2);
  });
});

describe("story grouping", () => {
  const filler = Array.from({ length: 20 }, (_, i) => item({ id: `f${i}`, entities: [`solo${i}`] }));
  it("groups articles in different places sharing two uncommon entities", () => {
    const a = item({ id: "a", entities: ["ana ruiz", "coastal council"], place: { id: "p1", name: "", lat: 0, lon: 0 } });
    const b = item({ id: "b", entities: ["ana ruiz", "coastal council", "x"], place: { id: "p2", name: "", lat: 0, lon: 0 }, t: 2000 });
    cluster([a, b, ...filler]);
    expect(a.story).toBeDefined();
    expect(a.story).toBe(b.story);
  });
  it("does not label a group confined to one place", () => {
    const a = item({ id: "a", entities: ["ana ruiz", "coastal council"] });
    const b = item({ id: "b", entities: ["ana ruiz", "coastal council"] });
    cluster([a, b, ...filler]);
    expect(a.story).toBeUndefined();
  });
  it("needs two shared entities", () => {
    const a = item({ id: "a", entities: ["ana ruiz", "q"], place: { id: "p1", name: "", lat: 0, lon: 0 } });
    const b = item({ id: "b", entities: ["ana ruiz", "z"], place: { id: "p2", name: "", lat: 0, lon: 0 } });
    cluster([a, b, ...filler]);
    expect(a.story).toBeUndefined();
  });
});

describe("reader metadata", () => {
  it("reads og tags in any attribute order and clips long descriptions", () => {
    const html = `<meta content="Short &amp; sweet" property="og:description"><meta property='og:image' content='https://x.org/i.jpg'>`;
    expect(parseMeta(html)).toEqual({ description: "Short & sweet", image: "https://x.org/i.jpg" });
    expect(parseMeta(`<meta name="description" content="Plain">`).description).toBe("Plain");
    expect(parseMeta(`<meta property="og:image" content="http://insecure/i.jpg">`).image).toBeUndefined();
    expect(clip("one two three four five", 12)).toBe("one two...");
  });
  it("respects framing headers", () => {
    expect(allowsEmbedding(new Headers(), "https://x.org/a")).toBe(true);
    expect(allowsEmbedding(new Headers({ "x-frame-options": "SAMEORIGIN" }), "https://x.org/a")).toBe(false);
    expect(allowsEmbedding(new Headers({ "content-security-policy": "frame-ancestors 'self'" }), "https://x.org/a")).toBe(false);
    expect(allowsEmbedding(new Headers({ "content-security-policy": "frame-ancestors *" }), "https://x.org/a")).toBe(true);
    expect(allowsEmbedding(new Headers(), "http://x.org/a")).toBe(false);
  });
  it("follows robots.txt", () => {
    const robots = "User-agent: *\nDisallow: /private\nAllow: /private/ok\n\nUser-agent: OtherBot\nDisallow: /";
    expect(robotsAllows(robots, "/news/1")).toBe(true);
    expect(robotsAllows(robots, "/private/x")).toBe(false);
    expect(robotsAllows(robots, "/private/ok/1")).toBe(true);
    expect(robotsAllows("User-agent: CapyNewsMap\nDisallow: /", "/a")).toBe(false);
  });
});

describe("GDELT file schedule", () => {
  it("round-trips stamps and caps a cold start", () => {
    expect(unixToStamp(stampToUnix("20260927031500"))).toBe("20260927031500");
    expect(stampsToFetch(undefined, "20260927031500", 3)).toEqual(["20260927024500", "20260927030000", "20260927031500"]);
    expect(stampsToFetch("20260927024500", "20260927031500", 16)).toEqual(["20260927030000", "20260927031500"]);
    expect(stampsToFetch("20260927031500", "20260927031500", 16)).toEqual([]);
  });
});

describe("languages", () => {
  it("maps GDELT codes to browser codes", () => {
    expect(toBcp47("fra")).toBe("fr");
    expect(toBcp47("zho")).toBe("zh");
    expect(toBcp47("xx")).toBe("xx");
    expect(toBcp47("qqq")).toBe("und");
  });
});

describe("RSS", () => {
  it("parses RSS and Atom entries and pins them to the source's city", () => {
    const src = { name: "Test", feed: "", lang: "fr", place: { name: "Dakar", lat: 14.7, lon: -17.4 } };
    const rss = `<rss><channel><item><title>Un titre</title><link>https://www.journal.sn/culture/a</link><pubDate>Sun, 27 Sep 2026 01:00:00 GMT</pubDate></item></channel></rss>`;
    const atom = `<feed><entry><title>Autre</title><link rel="alternate" href="https://journal.sn/b"/><updated>2026-09-27T02:00:00Z</updated></entry></feed>`;
    const now = Date.UTC(2026, 8, 27, 3) / 1000;
    const [a] = parseFeed(rss, src, now);
    const [b] = parseFeed(atom, src, now);
    expect(a.domain).toBe("journal.sn");
    expect(a.topics).toEqual(["culture"]);
    expect(a.place.name).toBe("Dakar");
    expect(b.url).toBe("https://journal.sn/b");
    expect(b.t).toBe(Date.UTC(2026, 8, 27, 2) / 1000);
  });
});

describe("output file", () => {
  it("indexes places and carries preview metadata", () => {
    const a = item({ id: "a", place: { id: "p1", name: "One", lat: 1, lon: 1 } });
    const b = item({ id: "b", place: { id: "p1", name: "One", lat: 1, lon: 1 }, image: "https://x.org/g.jpg" });
    const meta = new Map([["https://x.org/a", { excerpt: "Hi", embed: true, at: 0 }]]);
    const file = toNewsFile([a, b], meta, 5000, "gdelt");
    expect(file.places).toHaveLength(1);
    expect(file.items[0]).toMatchObject({ place: 0, excerpt: "Hi", embed: true });
    expect(file.items[1]).toMatchObject({ image: "https://x.org/g.jpg" });
    expect(file.items[1].embed).toBeUndefined();
  });
});
