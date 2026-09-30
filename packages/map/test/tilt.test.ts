// The reader's tilt in Map view (src/map/tilt.ts): which designs take it, and that it stays inside their range.
import { describe, expect, it } from "vitest";
import { THEMES, type ThemeId } from "../src/themes.ts";
import { readerTilt, stepTilt, tiltRange, twoFingerGesture, TILT_MAX } from "../src/map/tilt.ts";

describe("reader's tilt", () => {
  it("lets flat designs stand up and tilted ones lie flat", () => {
    expect(tiltRange(THEMES.morning)).toEqual([0, TILT_MAX]);
    expect(tiltRange(THEMES.bit64)).toEqual([0, TILT_MAX]);
    expect(tiltRange(THEMES.drive)![1]).toBe(THEMES.drive.tilt);
    expect(tiltRange(THEMES.club)![0]).toBeGreaterThan(0);
  });

  it("leaves out designs whose picture can't take another camera", () => {
    for (const id of ["noir", "arcade", "stadium", "pool", "snow", "pirate", "pond", "stitch", "sheet", "radar", "chalk"] as ThemeId[]) {
      expect(tiltRange(THEMES[id]), id).toBeNull();
    }
  });

  it("keeps every design's own tilt inside its range", () => {
    for (const t of Object.values(THEMES)) {
      const r = tiltRange(t);
      if (!r || !t.tilt) continue;
      expect(t.tilt, t.id).toBeGreaterThanOrEqual(r[0]);
      expect(t.tilt, t.id).toBeLessThanOrEqual(r[1]);
    }
  });

  it("clamps the angle, and leaves the design's own alone when the reader changed nothing", () => {
    expect(readerTilt(24, 0, [8, 64])).toBe(24);
    expect(readerTilt(0, 0, [52, 66])).toBe(0);
    expect(readerTilt(54, -80, [8, 64])).toBe(8);
    expect(readerTilt(54, 30, [8, 64])).toBe(64);
    expect(readerTilt(54, 30, null)).toBe(54);
  });

  it("drops the overshoot, so dragging back past an end moves at once", () => {
    const by = stepTilt(0, 0, 200, [0, 64]);
    expect(by).toBe(64);
    expect(stepTilt(0, by, -10, [0, 64])).toBe(54);
    expect(stepTilt(0, 0, -30, [0, 64])).toBe(0);
    expect(stepTilt(30, 0, 5, null)).toBe(0);
  });

  it("tells a two-finger tilt from a pinch", () => {
    expect(twoFingerGesture(-30, 4, true)).toBe("tilt");
    expect(twoFingerGesture(-30, 40, true)).toBe("pinch");
    expect(twoFingerGesture(5, 20, true)).toBe("pinch");
    expect(twoFingerGesture(6, 3, true)).toBeNull();
    expect(twoFingerGesture(-30, 4, false)).toBe("pinch");
  });
});
