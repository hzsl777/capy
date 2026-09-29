// The world desk: clustering with a topic (decision 25), and the mood telegram (decision 26).
import { z } from "zod";
import type { VerifiedSentence } from "./citations.js";

/** The map's topic filters. Topics filter; they never rank and never change how a pin looks. */
export const WORLD_TOPICS = ["politics", "economy", "conflict", "environment", "health", "science", "justice", "culture", "sport", "other"] as const;
export const WorldTopic = z.enum(WORLD_TOPICS);
export type WorldTopic = z.infer<typeof WorldTopic>;

/**
 * One event from the grouping model. Only the article ids decide what the stage writes, so every other field
 * falls back to a safe value instead of failing its batch: one malformed field among hundreds of events used to
 * throw away a batch of 300 articles (decisions 41 and 47). Titles are cut to 120 characters in code.
 */
export const WorldClusterEventSchema = z.object({
  title: z.string().min(1),
  /**
   * Not required to be non-empty: a model sometimes returns one empty event among a hundred, and code drops it.
   * Refusing the whole batch for it failed the first live day (decision 41).
   */
  articleIds: z.array(z.number().int()),
  importance: z.number().int().min(1).max(5).catch(2),
  importanceReason: z.string().max(400).catch(""),
  topic: WorldTopic.catch("other"),
  /**
   * Where the event happened, as the articles report it (decision 44): the city or town, its ISO 3166-1 alpha-2
   * country code and a rough point. Null when they name no single city; anything malformed counts as null.
   * Code checks it against a fixed list of cities before anything is placed; the country code only tells
   * same-named cities apart and is never shown.
   */
  where: z
    .object({ city: z.string().max(80), country: z.string().max(3).nullish(), lat: z.number().nullish(), lon: z.number().nullish() })
    .nullish()
    .catch(null),
});

export const WorldClusterResultSchema = z.object({
  events: z.array(WorldClusterEventSchema),
  skipped: z.array(z.object({ articleId: z.number().int(), reason: z.string().min(1).max(120) })),
});
export type WorldClusterResult = z.infer<typeof WorldClusterResultSchema>;

/**
 * A large day is clustered in batches. The merge pass names the batch events that report the same story, by key
 * ("b1-e3"), with one title for each group. Code checks the keys; a group of fewer than two distinct events is
 * dropped there rather than failing the whole answer.
 */
export const WorldClusterMergeSchema = z.object({
  groups: z.array(z.object({ eventKeys: z.array(z.string().min(1)).min(1), title: z.string().min(1) })),
});
export type WorldClusterMerge = z.infer<typeof WorldClusterMergeSchema>;

/**
 * The groups code accepts: every key known, no key shared between groups, and at least two distinct events each.
 * A key named by two groups drops both, since picking one would be a guess.
 */
export function validMergeGroups(merge: WorldClusterMerge, known: ReadonlySet<string>): { groups: WorldClusterMerge["groups"]; dropped: number } {
  const uses = new Map<string, number>();
  for (const g of merge.groups) for (const k of new Set(g.eventKeys)) uses.set(k, (uses.get(k) ?? 0) + 1);
  const groups = merge.groups.filter((g) => {
    const keys = new Set(g.eventKeys);
    if (keys.size < 2) return false;
    return [...keys].every((k) => known.has(k) && uses.get(k) === 1);
  });
  return { groups, dropped: merge.groups.length - groups.length };
}

/*
 * The telegram (decision 26): one word for the emotion the day's world reporting evokes.
 *
 * 1. The model scores each explained event from -2 to 2 by what happened to people, citing one of the event's
 *    verified sentences as the reason. Harm counts as harm whichever side it falls on.
 * 2. Code, not the model, turns the scores into the day's band: if any significant event (importance 3 or more)
 *    scored below zero, the worst of them sets the day, so good news never averages a tragedy away. Otherwise
 *    the day is the importance-weighted average, rounded.
 * 3. The model picks the word from that band's fixed list, and the events that shaped the day.
 */

export const MOOD_BANDS = [-2, -1, 0, 1, 2] as const;
export type MoodBand = (typeof MOOD_BANDS)[number];

/** Names for the scale's steps, shown beside the word. */
export const MOOD_BAND_LABEL: Record<MoodBand, string> = { [-2]: "Grave", [-1]: "Hard", 0: "Mixed", 1: "Hopeful", 2: "Good" };

/**
 * The only words the telegram can use, per band. Emotions a reader might feel on reading the day's reporting,
 * never verdicts about who is right. Changing a list is a decision (docs/DECISIONS.md), not a tweak.
 */
export const MOOD_WORDS: Record<MoodBand, readonly string[]> = {
  [-2]: ["Grief", "Mourning", "Sorrow", "Anguish"],
  [-1]: ["Unease", "Strain", "Worry", "Heaviness"],
  0: ["Watchful", "Uncertain", "Unsettled", "Wary"],
  1: ["Relief", "Hope", "Reassurance", "Encouragement"],
  2: ["Joy", "Gratitude", "Gladness", "Elation"],
};

/** Events of this importance or more can set a bad day on their own. */
export const SIGNIFICANT_IMPORTANCE = 3;

export const TelegramScoresSchema = z.object({
  scores: z.array(
    z.object({
      eventId: z.number().int(),
      score: z.number().int().min(-2).max(2),
      /** Verbatim copy of one of the event's verified sentences: the reason for the score. */
      because: z.string().min(1),
    }),
  ),
});
export type TelegramScores = z.infer<typeof TelegramScoresSchema>;

export const TelegramWordSchema = z.object({
  word: z.string().min(1).max(40),
  /** One to five events that shaped the day, each with one line restating its verified sentences. */
  events: z.array(z.object({ eventId: z.number().int(), line: z.string().min(1).max(220) })).min(1).max(5),
});
export type TelegramWord = z.infer<typeof TelegramWordSchema>;

export type ScoredEvent = { eventId: number; importance: number; score: number };

/** The formula. Worst significant event decides a bad day; an all-good day is the weighted average. */
export function dayBand(scored: ScoredEvent[]): MoodBand | null {
  if (scored.length === 0) return null;
  const significant = scored.filter((e) => e.importance >= SIGNIFICANT_IMPORTANCE);
  const pool = significant.length ? significant : scored;
  const worst = Math.min(...pool.map((e) => e.score));
  if (worst < 0) return worst as MoodBand;
  const weight = pool.reduce((sum, e) => sum + e.importance, 0);
  const avg = pool.reduce((sum, e) => sum + e.importance * e.score, 0) / weight;
  return Math.max(0, Math.min(2, Math.round(avg))) as MoodBand;
}

/**
 * The middle score per event across repeat scoring runs, so one run's wobble doesn't move the word (decision 36).
 * The reason comes from a run that gave the middle score. Every run has already passed scoreProblems, so each
 * scores every event once. `split` counts events whose runs disagreed.
 */
export function medianScores(runs: TelegramScores[]): { scores: TelegramScores["scores"]; split: number } {
  let split = 0;
  const scores = (runs[0]?.scores ?? []).map((first) => {
    const all = runs.map((r) => r.scores.find((s) => s.eventId === first.eventId) ?? first).sort((a, b) => a.score - b.score);
    if (all.some((s) => s.score !== first.score)) split++;
    return all[Math.floor(all.length / 2)]!;
  });
  return { scores, split };
}

const norm = (s: string) => s.replace(/\s+/g, " ").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').trim().toLowerCase();

/** Every candidate scored exactly once, each with a reason copied from its own verified sentences. */
export function scoreProblems(sc: TelegramScores, usable: Map<number, VerifiedSentence[]>): string[] {
  const problems: string[] = [];
  const seen = new Set<number>();
  for (const s of sc.scores) {
    const sentences = usable.get(s.eventId);
    if (!sentences) {
      problems.push(`event ${s.eventId} is not in the list`);
      continue;
    }
    if (seen.has(s.eventId)) problems.push(`event ${s.eventId} scored twice`);
    seen.add(s.eventId);
    if (!sentences.some((v) => norm(v.text) === norm(s.because))) problems.push(`the reason for event ${s.eventId} is not one of its sentences; copy one exactly`);
  }
  for (const id of usable.keys()) if (!seen.has(id)) problems.push(`event ${id} was not scored`);
  return problems;
}

/** The word must come from the band's list, and a bad day must name the event that set it. */
export function wordProblems(w: TelegramWord, band: MoodBand, scored: ScoredEvent[]): string[] {
  const problems: string[] = [];
  const allowed = MOOD_WORDS[band];
  if (!allowed.includes(w.word.trim())) problems.push(`word "${w.word.trim()}" is not one of: ${allowed.join(", ")}`);
  const ids = new Map(scored.map((e) => [e.eventId, e]));
  const seen = new Set<number>();
  for (const e of w.events) {
    if (!ids.has(e.eventId)) problems.push(`event ${e.eventId} is not in the list`);
    if (seen.has(e.eventId)) problems.push(`event ${e.eventId} chosen twice`);
    seen.add(e.eventId);
    if (e.line.split(/\s+/).length > 25) problems.push(`line for event ${e.eventId} is over 25 words`);
    if (/\u2014/.test(e.line)) problems.push(`line for event ${e.eventId} has an em dash`);
  }
  if (band < 0) {
    const setters = scored.filter((e) => e.importance >= SIGNIFICANT_IMPORTANCE && e.score === band).map((e) => e.eventId);
    const pool = setters.length ? setters : scored.filter((e) => e.score === band).map((e) => e.eventId);
    if (!w.events.some((e) => pool.includes(e.eventId))) problems.push(`include the event that set the day (one of: ${pool.join(", ")})`);
  }
  return problems;
}
