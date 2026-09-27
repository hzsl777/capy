import { describe, expect, it } from "vitest";
import { costUsd } from "./pricing.js";

describe("costUsd", () => {
  it("prices Sonnet 5 and halves for batch", () => {
    const usage = { input: 1_000_000, output: 100_000, cacheRead: 0, cacheWrite: 0 };
    expect(costUsd("claude-sonnet-5", usage)).toBeCloseTo(3, 6);
    expect(costUsd("claude-sonnet-5", usage, true)).toBeCloseTo(1.5, 6);
  });
  it("refuses an unknown model rather than guessing", () => {
    expect(() => costUsd("claude-unknown", { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 })).toThrow(/price table/);
  });
  it("prices cache writes at 1.25 times input", () => {
    expect(costUsd("claude-sonnet-5", { input: 0, output: 0, cacheRead: 0, cacheWrite: 1_000_000 })).toBeCloseTo(2.5, 6);
  });
});
