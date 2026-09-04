import { eq, sql } from "drizzle-orm";
import type { RunDate } from "@2dayai/core";
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
