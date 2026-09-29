import { describe, expect, it } from "vitest";
import { decodeBody, noControl, noControlDeep } from "./text.js";

describe("noControl", () => {
  it("removes NUL and other control characters but keeps tab and line breaks", () => {
    expect(noControl("a\u0000b\u0007c\td\ne\rf")).toBe("abc\td\ne\rf");
  });

  it("cleans every string inside a nested value and leaves other values alone", () => {
    expect(noControlDeep({ a: ["x\u0000y", 2], b: { c: "\u001fz", d: null, e: true } })).toEqual({ a: ["xy", 2], b: { c: "z", d: null, e: true } });
  });
});

describe("decodeBody", () => {
  const latin1 = (s: string) => new Uint8Array(Buffer.from(s, "latin1"));
  it("reads a feed in the encoding its XML declaration names", () => {
    const xml = '<?xml version="1.0" encoding="ISO-8859-1"?><rss><title>Decisão à humanidade</title></rss>';
    expect(decodeBody(latin1(xml), "application/rss+xml")).toContain("Decisão à humanidade");
  });
  it("prefers the declaration when a UTF-8 header would break the text", () => {
    const xml = '<?xml version="1.0" encoding="windows-1252"?><rss><title>São Paulo</title></rss>';
    expect(decodeBody(latin1(xml), "text/xml; charset=utf-8")).toContain("São Paulo");
  });
  it("reads UTF-8 by default and honours an HTML meta charset", () => {
    expect(decodeBody(new TextEncoder().encode("<rss>Ñandú 北京</rss>"), null)).toBe("<rss>Ñandú 北京</rss>");
    expect(decodeBody(latin1('<html><meta charset="iso-8859-1"><p>Bogotá</p>'), "text/html")).toContain("Bogotá");
  });
});
