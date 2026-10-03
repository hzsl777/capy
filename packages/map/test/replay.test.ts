import { describe, expect, it } from "vitest";
import { replayStops } from "../src/data.ts";

describe("Replay's stops", () => {
  const end = 100 * 3600;
  const H = 3600;

  it("skips the stretches with nothing on the map", () => {
    // Reports only in the first six hours of the day; the clock has moved on 18 hours with nothing at this zoom.
    const times = [end - 23 * H, end - 20 * H, end - 19 * H];
    const stops = replayStops(times, end, 12, 96, 3 * H);
    expect(stops.length).toBeGreaterThan(0);
    for (const s of stops) {
      const to = end - (96 - s) * 900;
      expect(times.some((t) => t >= to - 3 * H && t <= to)).toBe(true);
    }
    // Nothing past the last report's window: the replay ends there and goes back to the last 24 hours.
    expect(Math.max(...stops)).toBe(96 - (19 * H) / 900 + 12);
  });

  it("plays every slot when reports are spread over the day", () => {
    const times = Array.from({ length: 96 }, (_, i) => end - i * 900).sort((a, b) => a - b);
    expect(replayStops(times, end, 12, 96, 3 * H)).toEqual(Array.from({ length: 85 }, (_, i) => 12 + i));
  });

  it("has no stops without reports", () => {
    expect(replayStops([], end, 12, 96, 3 * H)).toEqual([]);
  });
});
