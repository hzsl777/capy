import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";
import type { Db } from "./types.js";

/** Node only (postgres-js). The Worker builds its own handle with the neon-http driver. */
export function createDb(url: string): Db {
  const sql = postgres(url, { max: 4, prepare: false });
  return drizzle(sql, { schema }) as unknown as Db;
}
