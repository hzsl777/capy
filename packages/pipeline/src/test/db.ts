// A real Postgres engine in-process (PGlite) with the real migrations applied. Tests exercise the schema, not a mock.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as schema from "@2dayai/db";
import type { Db } from "@2dayai/db";

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "db", "migrations");

export async function createTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return { db: db as unknown as Db, close: () => client.close() };
}
