import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export type Db = ReturnType<typeof createDb>;

/** One client per process. Neon closes idle connections; keep the pool small. */
export function createDb(url: string) {
  const sql = postgres(url, { max: 4, prepare: false });
  return drizzle(sql, { schema });
}
