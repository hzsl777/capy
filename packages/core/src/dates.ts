/** A run date is a calendar day in the day's time zone (`DAY_ZONE`), formatted YYYY-MM-DD. Every stage is keyed by it. */
export type RunDate = string & { readonly __brand: "RunDate" };

const RUN_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function toRunDate(input: string | Date): RunDate {
  const s = typeof input === "string" ? input : input.toISOString().slice(0, 10);
  if (!RUN_DATE_RE.test(s)) throw new Error(`Not a run date (YYYY-MM-DD): ${s}`);
  return s as RunDate;
}

/**
 * The day runs midnight to midnight in New York (decision 127, which moved it from UTC, decision 81): Davis reads the
 * site on Eastern time, and a day that ended at 8 pm there left the page a day behind all the next day.
 */
export const DAY_ZONE = "America/New_York";

const zoneParts = new Intl.DateTimeFormat("en-US", {
  timeZone: DAY_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** The wall clock in `DAY_ZONE` at an instant, read as if it were UTC, so the difference is the zone's offset. */
function zoneWall(t: number): number {
  const p = Object.fromEntries(zoneParts.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!);
}

/** The calendar day in `DAY_ZONE` at an instant. */
export function zoneDate(now: Date = new Date()): RunDate {
  return toRunDate(new Date(zoneWall(now.getTime())));
}

/** The instant midnight starts a day in `DAY_ZONE`. New York changes its clocks at 2 am, never across midnight. */
function zoneMidnight(date: string): Date {
  const wall = Date.parse(`${date}T00:00:00.000Z`);
  let t = wall - (zoneWall(wall) - wall);
  t = wall - (zoneWall(t) - t);
  return new Date(t);
}

/** The day after a run date. */
export function nextRunDate(date: string): RunDate {
  return toRunDate(new Date(Date.parse(`${date}T12:00:00.000Z`) + 24 * 60 * 60 * 1000));
}

export function todayRunDate(now: Date = new Date()): RunDate {
  return zoneDate(now);
}

/**
 * The newest run date whose window has closed: yesterday in New York. What the daily run builds just after midnight
 * there, and still builds when GitHub starts it hours late.
 */
export function lastFullRunDate(now: Date = new Date()): RunDate {
  const today = zoneDate(now);
  return toRunDate(new Date(Date.parse(`${today}T12:00:00.000Z`) - 24 * 60 * 60 * 1000));
}

/**
 * The 24 hours before now, ending at the last quarter hour: the window the map's local stories are refreshed over
 * during the day (decision 80), as GDELT publishes a file every 15 minutes.
 */
export function rollingWindow(now: Date = new Date()): { from: Date; to: Date } {
  const quarter = 15 * 60 * 1000;
  const to = new Date(Math.floor(now.getTime() / quarter) * quarter);
  return { from: new Date(to.getTime() - 24 * 60 * 60 * 1000), to };
}

/**
 * The ingest window for a run date: that calendar day in New York, midnight to midnight (decision 127), 24 hours long
 * but for the two days a year the clocks change.
 */
export function ingestWindow(date: RunDate): { from: Date; to: Date } {
  return { from: zoneMidnight(date), to: zoneMidnight(nextRunDate(date)) };
}
