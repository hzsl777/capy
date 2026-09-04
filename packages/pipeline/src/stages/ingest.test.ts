import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { toRunDate, type Source } from "@2dayai/core";
import { articlesFromFeed, checkSources } from "./ingest.js";

const here = dirname(fileURLToPath(import.meta.url));
const xml = readFileSync(join(here, "..", "fixtures", "sample-feed.xml"), "utf8");
const source: Source = { id: "sample", name: "Sample", url: "https://example.gov/feed.xml", topic: "tax", tier: "primary" };

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
      { source: "sample", fetched: 1, inserted: 0 },
      { source: "broken", fetched: 0, inserted: 0, error: "503 Service Unavailable" },
    ]);
  });
});
