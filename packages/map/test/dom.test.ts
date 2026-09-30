import { describe, expect, it } from "vitest";
import { safeUrl } from "../src/ui/dom.ts";

// Story, source and image links come from third-party feeds and GDELT, so only web links may reach an href or src.
describe("safeUrl", () => {
  it("keeps http and https links", () => {
    expect(safeUrl("https://example.org/a?b=1#c")).toBe("https://example.org/a?b=1#c");
    expect(safeUrl("http://example.org/")).toBe("http://example.org/");
    expect(safeUrl("HTTPS://EXAMPLE.org/x")).toBe("https://example.org/x");
  });
  it("refuses script, data and other schemes, however they are spelled", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      " javascript:alert(1)",
      "java\tscript:alert(1)",
      "\u0000javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "blob:https://example.org/x",
      "ftp://example.org/",
    ]) {
      expect(safeUrl(bad), bad).toBeNull();
    }
  });
  it("refuses relative, empty and malformed links", () => {
    expect(safeUrl(undefined)).toBeNull();
    expect(safeUrl("")).toBeNull();
    expect(safeUrl("/local/path")).toBeNull();
    expect(safeUrl("//example.org/x")).toBeNull();
    expect(safeUrl("not a url")).toBeNull();
  });
  it("takes https only when asked", () => {
    expect(safeUrl("http://example.org/i.jpg", true)).toBeNull();
    expect(safeUrl("https://example.org/i.jpg", true)).toBe("https://example.org/i.jpg");
  });
});
