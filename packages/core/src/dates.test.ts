import { describe, expect, it } from "vitest";
import { ingestWindow, lastFullRunDate, nextRunDate, toRunDate, zoneDate } from "./dates.js";

describe("the day ends at midnight in New York (decision 127)", () => {
  it("runs a summer day from 04:00 to 04:00 UTC and a winter day from 05:00 to 05:00", () => {
    expect(ingestWindow(toRunDate("2026-10-03"))).toEqual({ from: new Date("2026-10-03T04:00:00Z"), to: new Date("2026-10-04T04:00:00Z") });
    expect(ingestWindow(toRunDate("2026-12-31"))).toEqual({ from: new Date("2026-12-31T05:00:00Z"), to: new Date("2027-01-01T05:00:00Z") });
  });

  it("lets the two days the clocks change run 25 and 23 hours, so no hour is lost or read twice", () => {
    const fall = ingestWindow(toRunDate("2026-11-01"));
    expect(fall.to.getTime() - fall.from.getTime()).toBe(25 * 3600_000);
    const spring = ingestWindow(toRunDate("2026-03-08"));
    expect(spring.to.getTime() - spring.from.getTime()).toBe(23 * 3600_000);
    expect(ingestWindow(toRunDate("2026-11-02")).from).toEqual(fall.to);
  });

  it("builds the day that has just ended there, whenever the run starts", () => {
    expect(lastFullRunDate(new Date("2026-10-04T03:59:00Z"))).toBe("2026-10-02");
    expect(lastFullRunDate(new Date("2026-10-04T04:07:00Z"))).toBe("2026-10-03");
    expect(lastFullRunDate(new Date("2026-12-05T04:07:00Z"))).toBe("2026-12-03");
    expect(lastFullRunDate(new Date("2026-12-05T05:07:00Z"))).toBe("2026-12-04");
    expect(zoneDate(new Date("2027-01-01T04:59:00Z"))).toBe("2026-12-31");
    expect(nextRunDate("2026-12-31")).toBe("2027-01-01");
  });
});
