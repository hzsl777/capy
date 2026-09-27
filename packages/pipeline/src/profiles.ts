// Reader profiles are hand-written YAML in version 0 (spec 6.4). This syncs them into the database.
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { parse } from "yaml";
import { ReaderProfileSchema, type ReaderProfile } from "@2dayai/core";
import { readerProfiles, readers, type Db } from "@2dayai/db";

export type LoadedProfile = { profile: ReaderProfile; yaml: string };

export function loadProfiles(dir = "config/readers"): LoadedProfile[] {
  const out: LoadedProfile[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (!/^r\d{2}\.yaml$/.test(name)) continue;
    const yaml = readFileSync(join(dir, name), "utf8");
    const profile = ReaderProfileSchema.parse(parse(yaml));
    if (`${profile.id}.yaml` !== name) throw new Error(`${name}: id ${profile.id} does not match the filename`);
    out.push({ profile, yaml });
  }
  return out;
}

/** Upsert readers. Tokens are stable; the profile YAML is versioned when its text changes. */
export async function syncReaders(db: Db, profiles: LoadedProfile[]): Promise<{ id: string; profileVersion: number }[]> {
  const result: { id: string; profileVersion: number }[] = [];
  for (const { profile, yaml } of profiles) {
    const existing = (await db.select().from(readers).where(eq(readers.id, profile.id)))[0];
    const token = existing?.token ?? randomBytes(16).toString("hex");
    const latest = (
      await db
        .select()
        .from(readerProfiles)
        .where(eq(readerProfiles.readerId, profile.id))
        .orderBy(desc(readerProfiles.version))
        .limit(1)
    )[0];
    const version = latest && latest.yaml === yaml ? latest.version : (latest?.version ?? 0) + 1;
    await db
      .insert(readers)
      .values({ id: profile.id, token, email: profile.email, deliveryHour: profile.deliveryHour, timezone: profile.timezone, profileVersion: version })
      .onConflictDoUpdate({ target: readers.id, set: { email: profile.email, deliveryHour: profile.deliveryHour, timezone: profile.timezone, profileVersion: version } });
    if (!latest || latest.yaml !== yaml) {
      await db.insert(readerProfiles).values({ readerId: profile.id, version, yaml }).onConflictDoNothing();
    }
    result.push({ id: profile.id, profileVersion: version });
  }
  void and;
  return result;
}
