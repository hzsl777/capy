import { describe, expect, it } from "vitest";
import { ReaderProfileSchema, SelectionSchema, SourcesFileSchema } from "./schemas.js";

describe("schemas", () => {
  it("parses a sources file", () => {
    const r = SourcesFileSchema.safeParse({
      sources: [{ id: "sec-press", name: "SEC press releases", url: "https://www.sec.gov/news/pressreleases.rss", topic: "securities", tier: "primary" }],
    });
    expect(r.success).toBe(true);
  });
  it("rejects a reader profile without a stake", () => {
    const r = ReaderProfileSchema.safeParse({ id: "r01", timezone: "America/New_York", deliveryHour: 6, topics: [{ name: "tax", weight: 5 }], stake: [] });
    expect(r.success).toBe(false);
  });
  it("caps selection at five and rejection at five", () => {
    const item = { eventId: 1, line: "x", stakeParagraph: "y", outsideInterests: false };
    const r = SelectionSchema.safeParse({ selected: Array(6).fill(item), rejected: [], quietDay: false, headline: "h" });
    expect(r.success).toBe(false);
  });
});
