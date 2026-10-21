import { and, eq, gte, lte, sql } from "drizzle-orm";
import { ingestWindow, type RunDate } from "@2dayai/core";
import { llmCalls, type Db } from "@2dayai/db";
import { SpendCeilingError } from "./types.js";

export async function spentToday(db: Db, date: RunDate): Promise<number> {
  const rows = await db
    .select({ total: sql<string>`coalesce(sum(${llmCalls.costUsd}), 0)` })
    .from(llmCalls)
    .where(eq(llmCalls.runDate, date));
  return Number(rows[0]?.total ?? 0);
}

/** Decision 10: the day fails loudly once spend passes the ceiling. Checked before every model request. */
export async function assertUnderCeiling(db: Db, date: RunDate, ceiling: number): Promise<void> {
  const spent = await spentToday(db, date);
  if (spent >= ceiling) throw new SpendCeilingError(spent, ceiling);
}

export type SpendRow = { runDate: string; stage: string; costUsd: number; createdAt: Date };

/**
 * Spend by run date, split at the day's end in New York: calls made during the day (the refresh groups the day's new
 * stories) and calls made after it (the daily run, and any word or day run again). Plain text, newest day last.
 */
export function spendReport(rows: readonly SpendRow[]): string {
  const days = new Map<string, { during: number; after: number; stages: Map<string, number> }>();
  for (const r of rows) {
    const d = days.get(r.runDate) ?? { during: 0, after: 0, stages: new Map() };
    if (r.createdAt < ingestWindow(r.runDate as RunDate).to) d.during += r.costUsd;
    else d.after += r.costUsd;
    d.stages.set(r.stage, (d.stages.get(r.stage) ?? 0) + r.costUsd);
    days.set(r.runDate, d);
  }
  const lines = ["date        during the day   after midnight   total"];
  let total = 0;
  for (const [date, d] of [...days].sort(([a], [b]) => a.localeCompare(b))) {
    total += d.during + d.after;
    lines.push(`${date}  ${d.during.toFixed(4).padStart(14)}   ${d.after.toFixed(4).padStart(14)}   ${(d.during + d.after).toFixed(4)}`);
  }
  const stages = new Map<string, number>();
  for (const d of days.values()) for (const [k, v] of d.stages) stages.set(k, (stages.get(k) ?? 0) + v);
  lines.push("", `${days.size} days, ${total.toFixed(4)} USD in all, ${days.size ? (total / days.size).toFixed(4) : "0.0000"} a day`, "", "by stage:");
  for (const [k, v] of [...stages].sort(([, a], [, b]) => b - a)) lines.push(`  ${k.padEnd(28)} ${v.toFixed(4)}`);
  return lines.join("\n");
}

/** The report's rows: the 14 run dates up to and including `date`. */
export async function spendRows(db: Db, date: RunDate): Promise<SpendRow[]> {
  const from = new Date(Date.parse(`${date}T12:00:00Z`) - 13 * 86_400_000).toISOString().slice(0, 10);
  const rows = await db
    .select({ runDate: llmCalls.runDate, stage: llmCalls.stage, costUsd: llmCalls.costUsd, createdAt: llmCalls.createdAt })
    .from(llmCalls)
    .where(and(gte(llmCalls.runDate, from), lte(llmCalls.runDate, date)));
  return rows.map((r) => ({ ...r, costUsd: Number(r.costUsd) }));
}
