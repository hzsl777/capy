import { describe, expect, it } from "vitest";
import { headlineViolations } from "./headline.js";

describe("headlineViolations", () => {
  it("accepts a plain declarative line", () => {
    expect(headlineViolations("Fed held, chips rallied, nothing changes for your filing.")).toEqual([]);
  });
  it("accepts a single word", () => {
    expect(headlineViolations("Tariffs.")).toEqual([]);
  });
  it("accepts the quiet-day line", () => {
    expect(headlineViolations("Slow day. Two things worth ten minutes.")).toEqual([]);
  });
  it("rejects questions, exclamations, teasers, and length", () => {
    expect(headlineViolations("Is the Fed done?")).toContain("question form");
    expect(headlineViolations("Markets soar!")).toContain("exclamation mark");
    expect(headlineViolations("Breaking: rates held again")).toContain("colon-led teaser");
    expect(headlineViolations("Here's why the IRS notice matters")).toContain("withheld subject");
    expect(headlineViolations(Array(16).fill("word").join(" "))[0]).toMatch(/too long/);
  });
  it("rejects an empty line", () => {
    expect(headlineViolations("   ")).toEqual(["empty"]);
  });
});
