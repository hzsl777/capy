/** A run date is a calendar day in UTC, formatted YYYY-MM-DD. Every stage is keyed by it. */
export type RunDate = string & { readonly __brand: "RunDate" };

const RUN_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function toRunDate(input: string | Date): RunDate {
  const s = typeof input === "string" ? input : input.toISOString().slice(0, 10);
  if (!RUN_DATE_RE.test(s)) throw new Error(`Not a run date (YYYY-MM-DD): ${s}`);
  return s as RunDate;
}

export function todayRunDate(now: Date = new Date()): RunDate {
  return toRunDate(now);
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

/** The ingest window for a run date: the 24 hours ending at 09:00 UTC on that date. */
export function ingestWindow(date: RunDate): { from: Date; to: Date } {
  const to = new Date(`${date}T09:00:00.000Z`);
  const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);
  return { from, to };
}
