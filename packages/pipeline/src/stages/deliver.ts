// Stage 6.6. Sends every unsent edition whose reader's local hour has reached their delivery hour.
// Runs hourly; the day pipeline runs once. Idempotent: a sent edition is never sent twice.
import { eq, isNull } from "drizzle-orm";
import { renderEditionText, renderEmailHtml, type RunDate } from "@2dayai/core";
import { deliveries, editions, loadEditionView, readers, type Db } from "@2dayai/db";
import type { Config } from "../config.js";

export type Sender = (msg: { from: string; to: string; subject: string; html: string; text: string }) => Promise<{ id: string }>;

export type DeliverReport = { due: number; sent: number; failed: number; waiting: number };

export function localHour(now: Date, timezone: string): number {
  const h = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hour12: false }).format(now);
  return Number(h) % 24;
}

/** The reader's local calendar date, YYYY-MM-DD. */
export function localDate(now: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Due once the reader's local clock has passed the delivery hour on the run date, or any time after that date. */
export function isDue(runDate: string, deliveryHour: number, timezone: string, now: Date): boolean {
  const ld = localDate(now, timezone);
  if (ld > runDate) return true;
  if (ld < runDate) return false;
  return localHour(now, timezone) >= deliveryHour;
}

/** Every unsent edition, whatever its date, so an evening delivery hour in the Americas still goes out after UTC midnight. */
export async function runDeliver(db: Db, config: Config, _date: RunDate, send: Sender, now: Date = new Date()): Promise<DeliverReport> {
  const rows = await db.select({ edition: editions, reader: readers }).from(editions).innerJoin(readers, eq(readers.id, editions.readerId)).where(isNull(editions.sentAt));
  const report: DeliverReport = { due: 0, sent: 0, failed: 0, waiting: 0 };
  for (const { edition, reader } of rows) {
    if (!isDue(edition.runDate, reader.deliveryHour, reader.timezone, now)) {
      report.waiting += 1;
      continue;
    }
    report.due += 1;
    const view = await loadEditionView(db, { editionId: edition.id });
    if (!view) {
      report.failed += 1;
      continue;
    }
    const links = { baseUrl: config.webBaseUrl };
    try {
      const { id } = await send({ from: config.mailFrom, to: reader.email, subject: view.headline, html: renderEmailHtml(view, links), text: renderEditionText(view, links) });
      await db.update(editions).set({ sentAt: now }).where(eq(editions.id, edition.id));
      await db.insert(deliveries).values({ editionId: edition.id, providerId: id, status: "sent" }).onConflictDoUpdate({ target: deliveries.editionId, set: { providerId: id, status: "sent", detail: null } });
      report.sent += 1;
    } catch (err) {
      report.failed += 1;
      await db
        .insert(deliveries)
        .values({ editionId: edition.id, status: "failed", detail: err instanceof Error ? err.message : String(err) })
        .onConflictDoUpdate({ target: deliveries.editionId, set: { status: "failed", detail: err instanceof Error ? err.message : String(err) } });
    }
  }
  return report;
}
