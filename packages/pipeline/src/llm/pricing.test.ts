import { describe, expect, it } from "vitest";
import { costUsd } from "./pricing.js";
import { spendReport } from "./spend.js";

describe("costUsd", () => {
  it("prices Sonnet 5 and halves for batch", () => {
    const usage = { input: 1_000_000, output: 100_000, cacheRead: 0, cacheWrite: 0 };
    expect(costUsd("claude-sonnet-5", usage)).toBeCloseTo(3, 6);
    expect(costUsd("claude-sonnet-5", usage, true)).toBeCloseTo(1.5, 6);
  });
  it("prices the 5.5 models", () => {
    const usage = { input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheWrite: 0 };
    expect(costUsd("claude-haiku-5-5", usage)).toBeCloseTo(0.6, 6);
    expect(costUsd("claude-sonnet-5-5", usage)).toBeCloseTo(12, 6);
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
  it("reports spend by day, split at the day's end in New York, and by stage", () => {
    // October 19's day ends at 04:00 UTC on October 20.
    const text = spendReport([
      { runDate: "2026-10-19", stage: "cluster-world", costUsd: 0.1, createdAt: new Date("2026-10-19T15:00:00Z") },
      { runDate: "2026-10-19", stage: "cluster-world", costUsd: 0.2, createdAt: new Date("2026-10-20T05:00:00Z") },
      { runDate: "2026-10-19", stage: "telegram-word", costUsd: 0.01, createdAt: new Date("2026-10-20T06:00:00Z") },
    ]);
    expect(text).toContain("2026-10-19          0.1000           0.2100   0.3100");
    expect(text).toContain("1 days, 0.3100 USD in all, 0.3100 a day");
    expect(text).toMatch(/cluster-world\s+0\.3000\n\s+telegram-word\s+0\.0100/);
    expect(text).toContain("by day and stage:");
    expect(text).toMatch(/2026-10-19\s+0\.3000\s+0\.0100/);
  });
});
