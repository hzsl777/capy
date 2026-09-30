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
      local: { files: 192, filesMissing: 0, filesFailed: 0, articles: 90_000, townsTagged: 31_250, townsNearOutlet: 410, regionsEmpty: 2_100, regionsFilled: 1_980, regionsAdded: 380, towns: 30_840, stories: 43_120, overMax: 0 },
      coverage: { towns: 31_180, townsTotal: 171_587, offList: 95, countries: 214, countriesTotal: 225, regions: 2_450, regionsTotal: 2_589, missing: ["AQ (McMurdo Station)", "TV (Funafuti)"] },
    });
    expect(text).toContain("Word: **Unease** (band -1, Harm). Scored 3 times, runs disagreed on 1 of 4 events.");
    expect(text).toContain("Feeds: 2 read, 2 failed, 1 paused. 12 new articles.");
    expect(text).toContain("Model spend: $0.123.");
    // Decision 78: towns with a story out of every listed town, and the countries with none, for outlet research.
    expect(text).toContain("Local stories: 43,120 from GDELT in 30,840 towns of the 31,250 GDELT placed today (410 left to the outlets there), reaching 1,980 of 2,100 regions no outlet reached.");
    expect(text).toContain("Coverage: stories in 31,180 of 171,587 listed towns and cities (and 95 other places), 214 of 225 countries and territories, and 2,450 of 2,589 regions.");
    expect(text).toContain("AQ (McMurdo Station), TV (Funafuti)");
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
