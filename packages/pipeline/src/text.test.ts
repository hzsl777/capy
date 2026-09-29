import { describe, expect, it } from "vitest";
import { noControl, noControlDeep } from "./text.js";

describe("noControl", () => {
  it("removes NUL and other control characters but keeps tab and line breaks", () => {
    expect(noControl("a\u0000b\u0007c\td\ne\rf")).toBe("abc\td\ne\rf");
  });

  it("cleans every string inside a nested value and leaves other values alone", () => {
    expect(noControlDeep({ a: ["x\u0000y", 2], b: { c: "\u001fz", d: null, e: true } })).toEqual({ a: ["xy", 2], b: { c: "z", d: null, e: true } });
  });
});
