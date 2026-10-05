// Stage 6.2. One model call groups the day's articles into events. Idempotent per date: existing events for the date
// are deleted first, and the cascade removes everything derived from them.
import { and, asc, desc, eq, gte, isNotNull, lt } from "drizzle-orm";
import {
  ClusterResultSchema,
  ingestWindow,
  validMergeGroups,
  WorldClusterMergeSchema,
  WorldClusterResultSchema,
  type RunDate,
  type Source,
  type WorldClusterMerge,
  type WorldClusterResult,
  type WorldTopic,
} from "@2dayai/core";
import { heldGroups, type Held } from "../balance.js";
import { Gazetteer, type Where } from "../places.js";
import { loadPrompt, type Prompt } from "../prompts.js";
import { articles, editions, eventArticles, events, sources, telegrams, type Db } from "@2dayai/db";
import type { Config } from "../config.js";
import type { Llm } from "../llm/types.js";

export const CLUSTER_PROMPT_VERSION = 1;
const BODY_CHARS_FOR_CLUSTERING = 900;

export type ClusterReport = { articles: number; events: number; skipped: number; unknownIds: number; unassigned: number };

export function clusterUserContent(rows: { id: number; source: string; tier: string; title: string; lead: string; body: string }[]): string {
  const lines = rows.map((r) => {
    const text = (r.body || r.lead).slice(0, BODY_CHARS_FOR_CLUSTERING);
    return `[${r.id}] ${r.title}\nsource: ${r.source} (${r.tier})\n${text}`;
  });
  return `Articles for today, ${rows.length} in total. Each starts with its id in brackets.\n\n${lines.join("\n\n")}`;
}

export async function runCluster(db: Db, config: Config, llm: Llm, date: RunDate, opts: { force?: boolean } = {}): Promise<ClusterReport> {
  // Re-clustering deletes the date's events, and with them the items of any edition already in a reader's inbox.
  const sent = await db.select({ id: editions.id }).from(editions).where(and(eq(editions.runDate, date), isNotNull(editions.sentAt)));
  if (sent.length > 0 && !opts.force) throw new Error(`cluster: ${sent.length} edition(s) for ${date} were already sent; pass --force to re-cluster anyway and break their links`);
  const { from, to } = ingestWindow(date);
  const rows = await db
    .select({ id: articles.id, source: sources.name, tier: sources.tier, title: articles.title, lead: articles.lead, body: articles.body })
    .from(articles)
    .innerJoin(sources, eq(sources.id, articles.sourceId))
    .where(and(eq(sources.desk, "briefing"), gte(articles.publishedAt, from), lt(articles.publishedAt, to)));

  await db.delete(events).where(and(eq(events.runDate, date), eq(events.desk, "briefing")));
  if (rows.length === 0) return { articles: 0, events: 0, skipped: 0, unknownIds: 0, unassigned: 0 };

  const prompt = loadPrompt("cluster", CLUSTER_PROMPT_VERSION);
  const result = await llm.parse({ stage: "cluster", prompt, schema: ClusterResultSchema, user: clusterUserContent(rows), effort: config.effort.cluster }, date);

  const known = new Set(rows.map((r) => r.id));
  const assigned = new Set<number>();
  let unknownIds = 0;
  let written = 0;
  for (const ev of result.events) {
    const ids = [...new Set(ev.articleIds)].filter((id) => {
      if (!known.has(id)) {
        unknownIds += 1;
        return false;
      }
      if (assigned.has(id)) return false;
      return true;
    });
    if (ids.length === 0) continue;
    ids.forEach((id) => assigned.add(id));
    const [row] = await db
      .insert(events)
      .values({ runDate: date, title: ev.title, importance: ev.importance, importanceReason: ev.importanceReason, promptVersion: prompt.label })
      .returning({ id: events.id });
    await db.insert(eventArticles).values(ids.map((articleId) => ({ eventId: row!.id, articleId })));
    written += 1;
  }
  const skipped = result.skipped.filter((s) => known.has(s.articleId)).length;
  const unassigned = rows.filter((r) => !assigned.has(r.id) && !result.skipped.some((s) => s.articleId === r.id)).length;
  return { articles: rows.length, events: written, skipped, unknownIds, unassigned };
}

/*
 * The world desk (decision 25): same job, its own prompt, and a topic per event for the map's filters.
 *
 * A day with hundreds of outlets is too large for one call, so the articles go out in batches of at most
 * WORLD_CLUSTER_BATCH, each through the cluster-world prompt with the same checks. When there is more than one batch, a
 * merge pass (cluster-world-merge) names the batch events that report the same story, and code joins them. A second,
 * short merge pass then looks only at the events of importance 3 or more, the ones explained and scored for the word,
 * so one story never fills two lines there (decision 108).
 */

// v2 (decision 33): the same rules with short reasons, since every reason is billed as output across hundreds of events.
// v4 (decision 107): a city may come from an institution the articles name, and every event gives its country.
export const CLUSTER_WORLD_PROMPT_VERSION = 4;
// v2 (decision 108): same-day developments of one story, by the same main actor on the same matter, are one story.
export const CLUSTER_WORLD_MERGE_PROMPT_VERSION = 2;
/** The events the word is made from (explain and telegram take importance 3 and up), merged once more on their own. */
const TOP_IMPORTANCE = 3;
/** Headlines carry most of the grouping signal; a short lead settles the rest. */
const WORLD_CHARS_FOR_CLUSTERING = 200;

export type WorldClusterReport = ClusterReport & {
  byTopic: Record<string, number>;
  /** Cluster calls made. */
  batches: number;
  /** Merge groups applied, each joining two or more batch events into one. */
  merged: number;
  /** Merge groups the checks refused: an unknown key, a key in two groups, or fewer than two events. */
  mergeDropped: number;
  /** Groups the second merge pass joined among the events of importance 3 or more (decision 108). */
  mergedTop?: number;
  /** Articles shown at their outlet's city whose story happened in another country, with no city to place it (decision 107). */
  abroad?: number;
  /** Events placed where they happened (decision 44); the rest show at their outlets' cities. */
  placed: number;
  /** Articles still ungrouped after the second pass, each written as its own event of importance 1 (decision 50). */
  alone: number;
  /** Balance groups left out today because a side had no story, with the sides that had none (decision 90). */
  held?: Held[];
  /** Set by the refresh during the day: only articles no event holds yet were grouped, and none was removed (decision 130). */
  onlyNew?: boolean;
};

type WorldRow = { id: number; source: string; place: string; title: string; lead: string; lat: number | null; lon: number | null };

/** One event from one batch after its article ids were checked. `key` names it in the merge pass. */
type BatchEvent = { key: string; title: string; importance: number; importanceReason: string; topic: WorldTopic; ids: number[]; promptVersion: string; where: Where | null; country: string | null };

let gazetteer: Gazetteer | undefined;

export function worldClusterUserContent(rows: WorldRow[]): string {
  const lines = rows.map((r) => `[${r.id}] ${r.title} (${r.source})\n${r.lead.slice(0, WORLD_CHARS_FOR_CLUSTERING)}`);
  return `World articles for today, ${rows.length} in total. Each starts with its id in brackets.\n\n${lines.join("\n\n")}`;
}

/** How many times a batch whose answer ran past the output limit is halved and asked again (decision 36). */
const MAX_SPLITS = 3;

/**
 * Every batch through the cluster-world prompt. A batch whose answer hit max_tokens is halved and asked again,
 * up to MAX_SPLITS times, so a busy day costs a few more calls instead of the whole stage. Any other failure is
 * asked once more as it is (decision 41). A batch that still fails fails the stage before anything is written.
 */
async function answerBatches(llm: Llm, config: Config, prompt: Prompt, batches: { id: string; batch: WorldRow[] }[], date: RunDate, depth = 0): Promise<{ batch: WorldRow[]; result: WorldClusterResult }[]> {
  const answers = await llm.parseMany(
    batches.map(({ id, batch }) => ({ id, stage: "cluster-world", prompt, schema: WorldClusterResultSchema, user: worldClusterUserContent(batch), effort: config.effort.cluster })),
    date,
  );
  const out: { batch: WorldRow[]; result: WorldClusterResult }[] = [];
  const retry: { id: string; batch: WorldRow[] }[] = [];
  const failures: string[] = [];
  for (const { id, batch } of batches) {
    const answer = answers.get(id);
    if (answer?.ok) out.push({ batch, result: answer.value });
    else if (answer && /max_tokens/.test(answer.error) && batch.length >= 2 && depth < MAX_SPLITS) {
      const half = Math.ceil(batch.length / 2);
      retry.push({ id: `${id}.1`, batch: batch.slice(0, half) }, { id: `${id}.2`, batch: batch.slice(half) });
    } else if (!id.endsWith(".again")) retry.push({ id: `${id}.again`, batch });
    else failures.push(`${id}: ${answer ? answer.error : "no answer"}`);
  }
  // A dead batch fails the stage before anything is written. A partial day would leave places empty without saying why.
  if (failures.length > 0) throw new Error(`cluster-world: ${failures.length} ${failures.length === 1 ? "batch" : "batches"} still failed after a retry, nothing written. ${failures.join("; ")}`);
  return retry.length ? [...out, ...(await answerBatches(llm, config, prompt, retry, date, depth + 1))] : out;
}

/** Even batches of at most `max`, in the order given. */
export function splitBatches<T>(rows: T[], max: number): T[][] {
  if (rows.length === 0) return [];
  const count = Math.ceil(rows.length / max);
  const size = Math.ceil(rows.length / count);
  return Array.from({ length: count }, (_, i) => rows.slice(i * size, (i + 1) * size));
}

/** The merge pass sees each batch event's key, title, topic, importance, and its outlets with their places. */
export function worldMergeUserContent(evs: BatchEvent[], outletOf: Map<number, string>): string {
  const lines = evs.map((e) => {
    const outlets = [...new Set(e.ids.map((id) => outletOf.get(id) ?? "unknown"))].join("; ");
    return `[${e.key}] ${e.title}\ntopic: ${e.topic}, importance ${e.importance}\noutlets: ${outlets}`;
  });
  return `Events from today's batches, ${evs.length} in total. Each starts with its key in brackets.\n\n${lines.join("\n\n")}`;
}

/**
 * `sourceList` carries the balance groups (decision 90); without it nothing is held. With `onlyNew`, the refresh during
 * the day (decision 130): only the articles no event of the date holds yet are grouped, into new events beside the ones
 * already there, with no merge passes and nothing deleted; the daily run groups the whole day again once it ends.
 */
export async function runClusterWorld(db: Db, config: Config, llm: Llm, date: RunDate, sourceList: Source[] = [], opts: { onlyNew?: boolean } = {}): Promise<WorldClusterReport> {
  const { from, to } = ingestWindow(date);
  // Newest first across every source, so each batch is a slice of the day from many places, not one region.
  const all = await db
    .select({ id: articles.id, sourceId: sources.id, source: sources.name, place: sources.placeName, lat: sources.lat, lon: sources.lon, title: articles.title, lead: articles.lead })
    .from(articles)
    .innerJoin(sources, eq(sources.id, articles.sourceId))
    .where(and(eq(sources.desk, "world"), gte(articles.publishedAt, from), lt(articles.publishedAt, to)))
    .orderBy(desc(articles.publishedAt), asc(articles.id));
  const bySource = new Map<string, number>();
  for (const r of all) bySource.set(r.sourceId, (bySource.get(r.sourceId) ?? 0) + 1);
  const { held, heldSources } = heldGroups(sourceList, bySource);
  // Articles an event of the date already holds: during the day they keep their events and still count toward their
  // outlet's daily cap, so the day never shows more of one outlet than the daily run would.
  const grouped = opts.onlyNew
    ? new Set(
        (
          await db
            .select({ id: eventArticles.articleId })
            .from(eventArticles)
            .innerJoin(events, eq(events.id, eventArticles.eventId))
            .where(and(eq(events.runDate, date), eq(events.desk, "world")))
        ).map((r) => r.id),
      )
    : new Set<number>();
  const perSource = new Map<string, number>();
  const rows: WorldRow[] = all
    .filter((r) => !heldSources.has(r.sourceId))
    .filter((r) => {
      const n = (perSource.get(r.sourceId) ?? 0) + 1;
      perSource.set(r.sourceId, n);
      return n <= config.worldPerSource;
    })
    .filter((r) => !grouped.has(r.id))
    .map((r) => ({ id: r.id, source: r.source, place: r.place ?? "unknown", title: r.title, lead: r.lead, lat: r.lat, lon: r.lon }));

  if (rows.length === 0) {
    if (opts.onlyNew) return { articles: 0, events: 0, placed: 0, alone: 0, skipped: 0, unknownIds: 0, unassigned: 0, byTopic: {}, batches: 0, merged: 0, mergeDropped: 0, onlyNew: true };
    await clearWorldDay(db, date);
    return { articles: 0, events: 0, placed: 0, alone: 0, skipped: 0, unknownIds: 0, unassigned: 0, byTopic: {}, batches: 0, merged: 0, mergeDropped: 0, ...(held.length ? { held } : {}) };
  }

  const prompt = loadPrompt("cluster-world", CLUSTER_WORLD_PROMPT_VERSION);
  const answered = await answerBatches(llm, config, prompt, splitBatches(rows, config.worldClusterBatch).map((batch, i) => ({ id: `batch-${i + 1}`, batch })), date);

  const assigned = new Set<number>();
  const skippedIds = new Set<number>();
  const batchEvents: BatchEvent[] = [];
  let unknownIds = 0;
  const collect = (results: { batch: WorldRow[]; result: WorldClusterResult }[], prefix: string) => {
    results.forEach(({ batch, result }, i) => {
      // An id is known only inside the batch that carried it; the model never saw the others.
      const known = new Set(batch.map((r) => r.id));
      let n = 0;
      for (const ev of result.events) {
        // A model sometimes lists an article twice in one event; each article joins an event once.
        const ids = [...new Set(ev.articleIds)].filter((id) => {
          if (!known.has(id)) {
            unknownIds += 1;
            return false;
          }
          return !assigned.has(id);
        });
        if (ids.length === 0) continue;
        ids.forEach((id) => assigned.add(id));
        n += 1;
        batchEvents.push({ key: `${prefix}${i + 1}-e${n}`, title: ev.title.slice(0, 120), importance: ev.importance, importanceReason: ev.importanceReason, topic: ev.topic, ids, promptVersion: prompt.label, where: ev.where ?? null, country: countryCode(ev.country ?? ev.where?.country) });
      }
      for (const x of result.skipped) if (known.has(x.articleId) && !assigned.has(x.articleId)) skippedIds.add(x.articleId);
    });
  };
  collect(answered, "b");

  // Articles the model neither grouped nor set aside go back once, on their own (decision 50). A day with this
  // second pass failing still stands: its articles are handled like any left over below.
  const left = () => rows.filter((r) => !assigned.has(r.id) && !skippedIds.has(r.id));
  const firstLeft = left();
  let second: { batch: WorldRow[]; result: WorldClusterResult }[] = [];
  if (firstLeft.length > 0) {
    try {
      second = await answerBatches(llm, config, prompt, splitBatches(firstLeft, config.worldClusterBatch).map((batch, i) => ({ id: `rest-${i + 1}`, batch })), date);
      collect(second, "r");
    } catch (err) {
      console.error(`cluster-world: second pass failed, its ${firstLeft.length} articles stand alone. ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const unassigned = firstLeft.length;
  // Whatever is still left is news the model would not group: one story each at the lowest importance, so every
  // article on the map has a rank and a topic, and nothing is shown ungrouped.
  const singles: BatchEvent[] = left().map((r) => ({ key: `s-${r.id}`, title: r.title.slice(0, 120), importance: 1, importanceReason: "not grouped by the model", topic: "other", ids: [r.id], promptVersion: prompt.label, where: null, country: null }));
  const skipped = skippedIds.size;
  const batches = [...answered, ...second];

  let final = batchEvents;
  let merged = 0;
  let mergeDropped = 0;
  if (!opts.onlyNew && batches.length > 1 && batchEvents.length > 1) {
    const mergePrompt = loadPrompt("cluster-world-merge", CLUSTER_WORLD_MERGE_PROMPT_VERSION);
    const outletOf = new Map(rows.map((r) => [r.id, `${r.source} (${r.place})`]));
    const answer = await llm.parse({ stage: "cluster-world-merge", prompt: mergePrompt, schema: WorldClusterMergeSchema, user: worldMergeUserContent(batchEvents, outletOf), effort: config.effort.cluster }, date);
    const checked = validMergeGroups(answer, new Set(batchEvents.map((e) => e.key)));
    final = applyMerge(batchEvents, checked.groups, `${prompt.label}+${mergePrompt.label}`);
    merged = checked.groups.length;
    mergeDropped = checked.dropped;
  }

  // The word is made from the events of importance 3 or more. In a long list the merge pass can miss two of them that
  // are one story, so those few are asked about once more on their own. A failure here costs only this check.
  let mergedTop = 0;
  const top = final.filter((e) => e.importance >= TOP_IMPORTANCE);
  if (!opts.onlyNew && top.length > 1) {
    const mergePrompt = loadPrompt("cluster-world-merge", CLUSTER_WORLD_MERGE_PROMPT_VERSION);
    const outletOf = new Map(rows.map((r) => [r.id, `${r.source} (${r.place})`]));
    try {
      const answer = await llm.parse({ stage: "cluster-world-merge-top", prompt: mergePrompt, schema: WorldClusterMergeSchema, user: worldMergeUserContent(top, outletOf), effort: config.effort.cluster }, date);
      const checked = validMergeGroups(answer, new Set(top.map((e) => e.key)));
      final = applyMerge(final, checked.groups, `${prompt.label}+${mergePrompt.label}`);
      mergedTop = checked.groups.length;
    } catch (err) {
      console.error(`cluster-world: the second merge pass failed, events stand as they are. ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  final = [...final, ...singles];

  // Every model call succeeded, so the date's world events are replaced only now; during the day they are added to.
  if (!opts.onlyNew) await clearWorldDay(db, date);
  const byTopic: Record<string, number> = {};
  gazetteer ??= Gazetteer.loadWithTowns();
  const rowOf = new Map(rows.map((r) => [r.id, r]));
  let placed = 0;
  let abroad = 0;
  for (const ev of final) {
    // Where it happened, if the model named a city that checks out against the city and town lists (decision 44);
    // otherwise the map shows it at its outlets.
    const at = gazetteer.locate(ev.where);
    if (at) placed += 1;
    // With no city, an article stays at its outlet's city. When the story happened in another country than the
    // outlet's, it is marked, so the site lists it apart and it never ranks that city (decision 107).
    const isAbroad = (id: number): boolean => {
      if (at || !ev.country) return false;
      const r = rowOf.get(id);
      const home = r && r.lat !== null && r.lon !== null ? gazetteer!.countryAt(r.lat, r.lon) : null;
      return home !== null && home !== ev.country;
    };
    const [row] = await db
      .insert(events)
      .values({ runDate: date, title: ev.title, importance: ev.importance, importanceReason: ev.importanceReason, promptVersion: ev.promptVersion, desk: "world", topic: ev.topic, placeName: at?.name ?? null, lat: at?.lat ?? null, lon: at?.lon ?? null })
      .returning({ id: events.id });
    await db.insert(eventArticles).values(
      ev.ids.map((articleId) => {
        const away = isAbroad(articleId);
        if (away) abroad += 1;
        return { eventId: row!.id, articleId, abroad: away };
      }),
    );
    byTopic[ev.topic] = (byTopic[ev.topic] ?? 0) + 1;
  }
  return { articles: rows.length, events: final.length, placed, skipped, unknownIds, unassigned, alone: singles.length, byTopic, batches: batches.length, merged, mergeDropped, mergedTop, abroad, ...(held.length ? { held } : {}), ...(opts.onlyNew ? { onlyNew: true } : {}) };
}

/** A two-letter country code in capitals, or null. */
function countryCode(cc: string | null | undefined): string | null {
  const c = (cc ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) ? c : null;
}

/** The telegram is written from the world events; re-clustering makes any old telegram for the date stale. */
async function clearWorldDay(db: Db, date: RunDate): Promise<void> {
  await db.delete(telegrams).where(eq(telegrams.runDate, date));
  await db.delete(events).where(and(eq(events.runDate, date), eq(events.desk, "world")));
}

/**
 * Joins each checked group into one event: the union of its articles, the group's title, the highest importance,
 * and the topic, reason and location of the most important member (the first listed on a tie), or the first
 * member's location when that one has none. The joined event takes the position of its first member in the list. Events in no group pass through unchanged.
 */
function applyMerge(evs: BatchEvent[], groups: WorldClusterMerge["groups"], promptVersion: string): BatchEvent[] {
  const byKey = new Map(evs.map((e) => [e.key, e]));
  const groupOf = new Map<string, number>();
  groups.forEach((g, gi) => g.eventKeys.forEach((k) => groupOf.set(k, gi)));
  const done = new Set<number>();
  const out: BatchEvent[] = [];
  for (const ev of evs) {
    const gi = groupOf.get(ev.key);
    if (gi === undefined) {
      out.push(ev);
      continue;
    }
    if (done.has(gi)) continue;
    done.add(gi);
    const group = groups[gi]!;
    const members = [...new Set(group.eventKeys)].map((k) => byKey.get(k)!);
    const lead = members.reduce((best, m) => (m.importance > best.importance ? m : best));
    out.push({
      key: members.map((m) => m.key).join("+"),
      title: group.title.slice(0, 120),
      importance: lead.importance,
      importanceReason: lead.importanceReason,
      topic: lead.topic,
      ids: members.flatMap((m) => m.ids),
      promptVersion,
      where: lead.where ?? members.find((m) => m.where)?.where ?? null,
      country: lead.country ?? members.find((m) => m.country)?.country ?? null,
    });
  }
  return out;
}
