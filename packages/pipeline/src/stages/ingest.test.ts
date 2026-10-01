import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { toRunDate, type Source } from "@2dayai/core";
import { articlesFromFeed, checkSources, COMMON_FEED_PATHS, feedDate, feedLinksIn, fetchFeedDocument, HttpError, inSection } from "./ingest.js";

const here = dirname(fileURLToPath(import.meta.url));
const xml = readFileSync(join(here, "..", "fixtures", "sample-feed.xml"), "utf8");
const source: Source = { id: "sample", name: "Sample", url: "https://example.gov/feed.xml", topic: "tax", tier: "primary", desk: "briefing", lang: "en" };

describe("articlesFromFeed", () => {
  it("keeps only linked items inside the run date's window, midnight to midnight UTC (decision 81)", async () => {
    const out = await articlesFromFeed(source, xml, toRunDate("2026-09-03"));
    expect(out.map((a) => a.url)).toEqual(["https://example.gov/news/2026-09-03-deferred-revenue"]);
  });
  it("strips markup from titles and bodies", async () => {
    const [a] = await articlesFromFeed(source, xml, toRunDate("2026-09-03"));
    expect(a?.title).toBe("Agency issues guidance on deferred revenue timing");
    expect(a?.body).toContain("tax years beginning after December 31, 2026");
    expect(a?.body).not.toContain("<p>");
  });
});

describe("feedDate (decision 89)", () => {
  it("reads the usual forms as before", () => {
    expect(feedDate("Wed, 30 Sep 2026 10:00:00 +0000")?.toISOString()).toBe("2026-09-30T10:00:00.000Z");
    expect(feedDate("2026-09-30T10:00:00Z")?.toISOString()).toBe("2026-09-30T10:00:00.000Z");
  });
  it("reads month and weekday names in the feed's own language", () => {
    expect(feedDate("gio, 01 ott 2026 03:35:03 +0200")?.toISOString()).toBe("2026-10-01T01:35:03.000Z");
    expect(feedDate("mié, 30 sept 2026 22:15:00 -0500")?.toISOString()).toBe("2026-10-01T03:15:00.000Z");
    expect(feedDate("qua, 30 set 2026 12:00:00 -0300")?.toISOString()).toBe("2026-09-30T15:00:00.000Z");
    expect(feedDate("mer., 30 sept. 2026 08:00:00 +0200")?.toISOString()).toBe("2026-09-30T06:00:00.000Z");
    expect(feedDate("Mi, 30 Dez 2026 08:00:00 +0100")?.toISOString()).toBe("2026-12-30T07:00:00.000Z");
    expect(feedDate("30 août 2026 08:00:00 GMT")?.toISOString()).toBe("2026-08-30T08:00:00.000Z");
  });
  it("keeps an item whose feed writes its date in Italian", async () => {
    const it = `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title><item><title>Notizia</title><link>https://example.it/a</link><pubDate>mer, 30 set 2026 10:00:00 +0200</pubDate></item></channel></rss>`;
    const out = await articlesFromFeed(source, it, toRunDate("2026-09-30"));
    expect(out.map((a) => a.publishedAt.toISOString())).toEqual(["2026-09-30T08:00:00.000Z"]);
  });
  it("leaves what it can't read undated", () => {
    expect(feedDate(undefined)).toBeUndefined();
    expect(feedDate("")).toBeUndefined();
    expect(feedDate("gestern")).toBeUndefined();
    expect(feedDate("30 foo 2026 08:00:00 GMT")).toBeUndefined();
  });
});

describe("checkSources", () => {
  it("reports fetch failures per source without throwing", async () => {
    const reports = await checkSources([source, { ...source, id: "broken", url: "https://example.gov/broken" }], toRunDate("2026-09-03"), async (url) => {
      if (url.endsWith("broken")) throw new Error("503 Service Unavailable");
      return xml;
    });
    expect(reports).toEqual([
      { source: "sample", fetched: 1, inserted: 0, feedTitle: "Sample press releases", headlines: ["Agency issues guidance on deferred revenue timing", "Old item outside the window", "Item with no link"] },
      { source: "broken", fetched: 0, inserted: 0, error: "503 Service Unavailable" },
    ]);
  });

  it("lists every feed a page links to, so a section's own feed can be picked", async () => {
    const page = `<html><head><link rel="alternate" type="application/rss+xml" href="/rss.xml"><link rel="alternate" type="application/rss+xml" href="/english/rss/"></head></html>`;
    const [r] = await checkSources([{ ...source, url: "https://example.gov/english/" }], toRunDate("2026-09-04"), async (url) => (url.endsWith(".xml") || url.endsWith("/rss/") ? xml : page));
    expect(r?.feedUrl).toBe("https://example.gov/english/rss/");
    expect(r?.declared).toEqual(["https://example.gov/rss.xml", "https://example.gov/english/rss/"]);
  });
});

describe("feed discovery (decision 31)", () => {
  const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title></channel></rss>`;
  const page = (links: string) => `<!doctype html><html><head><title>Outlet</title>${links}</head><body>News</body></html>`;

  it("reads the feed links a page declares, resolving relative ones", () => {
    const html = page(`<link rel="alternate" type="application/rss+xml" title="All" href="/rss/all.xml"><link href="https://cdn.example/atom" type="application/atom+xml" rel="alternate"><link rel="stylesheet" href="/a.css">`);
    expect(feedLinksIn(html, "https://outlet.example/news/")).toEqual(["https://outlet.example/rss/all.xml", "https://cdn.example/atom"]);
  });

  it("uses a configured feed as is", async () => {
    const got = await fetchFeedDocument("https://outlet.example/feed", async () => rss);
    expect(got.feedUrl).toBe("https://outlet.example/feed");
  });

  it("follows a homepage to the feed it links to", async () => {
    const fetched: string[] = [];
    const got = await fetchFeedDocument("https://outlet.example/", async (url) => {
      fetched.push(url);
      return url.endsWith("/rss/all.xml") ? rss : page(`<link rel="alternate" type="application/rss+xml" href="/rss/all.xml">`);
    });
    expect(got.feedUrl).toBe("https://outlet.example/rss/all.xml");
    expect(fetched).toEqual(["https://outlet.example/", "https://outlet.example/rss/all.xml"]);
  });

  it("tries common paths only when the page links to no feed, and accepts only a real feed", async () => {
    const got = await fetchFeedDocument("https://outlet.example/", async (url) => (url === "https://outlet.example/rss" ? rss : page("")));
    expect(got.feedUrl).toBe("https://outlet.example/rss");
    await expect(fetchFeedDocument("https://outlet.example/", async () => page(""))).rejects.toThrow(/links to none/);
  });

  it("tries the usual paths when the configured address answers with an error, and keeps that error if none works", async () => {
    const fetched: string[] = [];
    const got = await fetchFeedDocument("https://outlet.example/", async (url) => {
      fetched.push(url);
      if (url === "https://outlet.example/index.rss") return rss;
      throw new HttpError("403 Forbidden");
    });
    expect(got.feedUrl).toBe("https://outlet.example/index.rss");
    expect(fetched[0]).toBe("https://outlet.example/");
    await expect(fetchFeedDocument("https://outlet.example/", async () => { throw new HttpError("403 Forbidden"); })).rejects.toThrow("403 Forbidden");
  });

  it("never looks for a section's or edition's feed at the site's root (decision 82)", async () => {
    // The site feed at /rss.xml is another section's news, in another language, and would be pinned at this outlet.
    for (const url of ["https://outlet.example/english/", "https://outlet.example/cebu", "https://outlet.example/?edition=en"]) {
      const fetched: string[] = [];
      await expect(
        fetchFeedDocument(url, async (u) => {
          fetched.push(u);
          return u === "https://outlet.example/rss.xml" ? rss : page("");
        }),
      ).rejects.toThrow(/links to none; an address with a path gets no feed from the site's root/);
      expect(fetched).toEqual([url]);
    }
  });

  it("asks a section's address once more after an error, and never tries the root's paths", async () => {
    const fetched: string[] = [];
    await expect(
      fetchFeedDocument("https://outlet.example/feed/", async (url) => {
        fetched.push(url);
        if (url === "https://outlet.example/rss") return rss;
        throw new HttpError("404 Not Found");
      }),
    ).rejects.toThrow(/^404 Not Found; an address with a path/);
    expect(fetched).toEqual(["https://outlet.example/feed/", "https://outlet.example/feed/"]);
    // A server that refuses only the first request.
    let calls = 0;
    const got = await fetchFeedDocument("https://outlet.example/rss", async () => {
      if (calls++ === 0) throw new HttpError("403 Forbidden");
      return rss;
    });
    expect(got.feedUrl).toBe("https://outlet.example/rss");
    // A server that asks for fewer requests is not asked again.
    let limited = 0;
    await expect(fetchFeedDocument("https://outlet.example/rss", async () => { limited++; throw new HttpError("429 Too Many Requests"); })).rejects.toThrow(/^429 Too Many Requests; an address with a path/);
    expect(limited).toBe(1);
  });

  it("follows only the feeds a section's page links to in its own section", async () => {
    // 24.kg's English page linked to 27 Russian section feeds and not the English one.
    const links = page(`<link rel="alternate" type="application/rss+xml" href="/oshskie_sobytija/rss/"><link rel="alternate" type="application/rss+xml" href="/politika/rss/">`);
    const fetched: string[] = [];
    await expect(
      fetchFeedDocument("https://outlet.example/english/", async (url) => {
        fetched.push(url);
        return url.endsWith("/rss/") ? rss : links;
      }),
    ).rejects.toThrow(/links to 2 feed\(s\), none in its section/);
    expect(fetched).toEqual(["https://outlet.example/english/"]);
    expect(inSection("https://outlet.example/english/rss/", "https://outlet.example/english/")).toBe(true);
    expect(inSection("https://www.outlet.example/en.rss.xml", "https://outlet.example/en.html")).toBe(true);
    expect(inSection("https://feeds.feedservice.example/outlet", "https://outlet.example/english/")).toBe(true);
    expect(inSection("https://outlet.example/rss.xml", "https://outlet.example/?edition=en")).toBe(true);
    expect(inSection("https://outlet.example/englishnews/rss/", "https://outlet.example/english/")).toBe(false);
    expect(inSection("https://outlet.example/feed/", "https://outlet.example/cebu")).toBe(false);
  });

  it("still follows the feed a section's page links to", async () => {
    const got = await fetchFeedDocument("https://outlet.example/english/", async (url) =>
      url === "https://outlet.example/english/rss/" ? rss : page(`<link rel="alternate" type="application/rss+xml" href="/english/rss/">`),
    );
    expect(got.feedUrl).toBe("https://outlet.example/english/rss/");
  });

  it("does not guess paths on a host that is down", async () => {
    let calls = 0;
    await expect(fetchFeedDocument("https://down.example/", async () => { calls++; throw new Error("fetch failed"); })).rejects.toThrow("fetch failed");
    expect(calls).toBe(1);
    expect(COMMON_FEED_PATHS.length).toBeGreaterThan(5);
  });
});
