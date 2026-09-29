import { eq } from "drizzle-orm";
import type { RunDate } from "@2dayai/core";
import { runs, type Db } from "@2dayai/db";
import { noControl, noControlDeep } from "./text.js";

/** Wraps a stage so every attempt leaves a row: started, then ok or failed with detail. */
export async function recorded<T>(db: Db, date: RunDate, stage: string, fn: () => Promise<T>): Promise<T> {
  const [row] = await db.insert(runs).values({ runDate: date, stage, status: "started" }).returning({ id: runs.id });
  try {
    const value = await fn();
    await db.update(runs).set({ status: "ok", detail: noControlDeep(value) as object, finishedAt: new Date() }).where(eq(runs.id, row!.id));
    return value;
  } catch (err) {
    await db
      .update(runs)
      .set({ status: "failed", detail: { error: noControl(err instanceof Error ? err.message : String(err)) }, finishedAt: new Date() })
      .where(eq(runs.id, row!.id));
    throw err;
  }
}
