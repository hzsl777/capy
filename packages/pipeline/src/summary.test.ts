import { describe, expect, it } from "vitest";
import { toRunDate } from "@2dayai/core";
import { daySummary } from "./summary.js";

const date = toRunDate("2026-09-28");

describe("the daily run summary (decision 36)", () => {
  it("shows the word, the counts, the spend and the feeds that need a person", () => {
    const text = daySummary(date, {
      ingest: [
        { source: "a", fetched: 10, inserted: 8 },
        { source: "b", fetched: 4, inserted: 4, feedUrl: "https://b.example/rss" },
        { source: "c", fetched: 0, inserted: 0, failedDays: 1, error: "503 Service Unavailable" },
        { source: "d", fetched: 0, inserted: 0, failedDays: 5, error: "404 | Not Found" },
        { source: "e", fetched: 0, inserted: 0, failedDays: 9, paused: true, error: "paused" },
      ],
      clusterWorld: { articles: 12, events: 6, skipped: 0, unknownIds: 0, unassigned: 0, byTopic: {}, batches: 1, merged: 0, mergeDropped: 0 },
      explain: { events: 4, usable: 4, unusable: 0, failed: 0, sentencesDropped: 0 },
      select: { readers: 0, editions: 0, quiet: 0, failed: 0, retried: 0, skippedSent: 0 },
      telegram: { candidates: 4, written: true, word: "Unease", band: -1, events: 3, scoreRuns: 3, split: 1, retried: { score: false, word: false }, rejected: 0 },
      spendUsd: 0.1234,
    });
    expect(text).toContain("Word: **Unease** (band -1, Harm). Scored 3 times, runs disagreed on 1 of 4 events.");
    expect(text).toContain("Feeds: 2 read, 2 failed, 1 paused. 12 new articles.");
    expect(text).toContain("Model spend: $0.123.");
    expect(text).not.toContain("2DayAI:");
    // Worst streak first, and a pipe in an error can't break the table.
    expect(text.indexOf("| d | 5 | 404 \\| Not Found |")).toBeLessThan(text.indexOf("| c | 1 |"));
    expect(text).toContain("e (9 days)");
    expect(text).toContain("| b | https://b.example/rss |");
  });

  it("says the run failed and lists what finished", () => {
    const text = daySummary(date, { ingest: [{ source: "a", fetched: 1, inserted: 1 }] }, "telegram: the model's answer still breaks the rules");
    expect(text).toContain("**The run failed.** telegram:");
    expect(text).toContain("Feeds: 1 read, 0 failed, 0 paused.");
    expect(text).not.toContain("Word:");
  });
});
