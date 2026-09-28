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

describe("costUsd for cheaper providers", () => {
  it("prices DeepSeek cache hits at the cache rate", () => {
    expect(costUsd("deepseek-flash", { input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 0 })).toBeCloseTo(1.506, 6);
  });
  it("bills OpenRouter free models at zero", () => {
    expect(costUsd("qwen/qwen3.8-27b:free", { input: 5_000_000, output: 1_000_000, cacheRead: 0, cacheWrite: 0 })).toBe(0);
  });
  it("uses the override for a model the table lacks", () => {
    expect(costUsd("some-new-model", { input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheWrite: 0 }, false, { input: 0.1, output: 0.2 })).toBeCloseTo(0.3, 6);
  });
});
