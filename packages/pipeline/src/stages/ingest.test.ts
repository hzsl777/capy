import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { toRunDate, type Source } from "@2dayai/core";
import { articlesFromFeed, checkSources, COMMON_FEED_PATHS, feedLinksIn, fetchFeedDocument, HttpError } from "./ingest.js";

const here = dirname(fileURLToPath(import.meta.url));
const xml = readFileSync(join(here, "..", "fixtures", "sample-feed.xml"), "utf8");
const source: Source = { id: "sample", name: "Sample", url: "https://example.gov/feed.xml", topic: "tax", tier: "primary", desk: "briefing", lang: "en" };

describe("articlesFromFeed", () => {
  it("keeps only linked items inside the 24 hour window ending 09:00 UTC on the run date", async () => {
    const out = await articlesFromFeed(source, xml, toRunDate("2026-09-04"));
    expect(out.map((a) => a.url)).toEqual(["https://example.gov/news/2026-09-03-deferred-revenue"]);
  });
  it("strips markup from titles and bodies", async () => {
    const [a] = await articlesFromFeed(source, xml, toRunDate("2026-09-04"));
    expect(a?.title).toBe("Agency issues guidance on deferred revenue timing");
    expect(a?.body).toContain("tax years beginning after December 31, 2026");
    expect(a?.body).not.toContain("<p>");
  });
});

describe("checkSources", () => {
  it("reports fetch failures per source without throwing", async () => {
    const reports = await checkSources([source, { ...source, id: "broken", url: "https://example.gov/broken" }], toRunDate("2026-09-04"), async (url) => {
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
    const [r] = await checkSources([{ ...source, url: "https://example.gov/english/" }], toRunDate("2026-09-04"), async (url) => (url.endsWith(".xml") ? xml : page));
    expect(r?.feedUrl).toBe("https://example.gov/rss.xml");
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

  it("never looks for a section's or edition's feed at the site's root (decision 81)", async () => {
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
