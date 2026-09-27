import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema.js";

/** Driver-agnostic handle. postgres-js in the pipeline, PGlite in tests, neon-http in the Worker all satisfy it. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
