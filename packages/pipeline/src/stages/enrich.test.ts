import { describe, expect, it } from "vitest";
import { extractArticleText } from "./enrich.js";

const para = "The agency released guidance clarifying the timing of deferred revenue recognition for multi-year contracts and the related reporting. ";
const HTML = `<html><head><title>Guidance</title></head><body><nav><a href="/">Home</a><a href="/about">About</a></nav>
<article><h1>Agency issues guidance</h1>${Array(8).fill(`<p>${para}</p>`).join("")}</article>
<footer>Copyright</footer></body></html>`;

describe("extractArticleText", () => {
  it("returns the article body without navigation and footer", () => {
    const text = extractArticleText(HTML, "https://example.gov/a");
    expect(text.length).toBeGreaterThan(400);
    expect(text).toContain("deferred revenue recognition");
    expect(text).not.toContain("Copyright");
    expect(text).not.toContain("About");
  });
  it("returns empty for a page with no real body", () => {
    expect(extractArticleText("<html><body><p>Hi</p></body></html>", "https://example.gov/b")).toBe("");
  });
});
