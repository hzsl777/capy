// The world desk: clustering with a topic, and the conflict telegram (decision 25).
import { z } from "zod";
import type { VerifiedSentence } from "./citations.js";

/** The map's topic filters. Topics filter; they never rank and never change how a pin looks. */
export const WORLD_TOPICS = ["politics", "economy", "conflict", "environment", "health", "science", "justice", "culture", "sport", "other"] as const;
export const WorldTopic = z.enum(WORLD_TOPICS);
export type WorldTopic = z.infer<typeof WorldTopic>;

export const WorldClusterEventSchema = z.object({
  title: z.string().min(1).max(120),
  articleIds: z.array(z.number().int()).min(1),
  importance: z.number().int().min(1).max(5),
  importanceReason: z.string().min(1).max(200),
  topic: WorldTopic,
});

export const WorldClusterResultSchema = z.object({
  events: z.array(WorldClusterEventSchema),
  skipped: z.array(z.object({ articleId: z.number().int(), reason: z.string().min(1).max(120) })),
});
export type WorldClusterResult = z.infer<typeof WorldClusterResultSchema>;

/** The telegram: one word for the day's conflict reporting, and the events it stands for. */
export const TelegramSchema = z.object({
  word: z.string().min(1).max(40),
  quietDay: z.boolean(),
  events: z
    .array(z.object({ eventId: z.number().int(), line: z.string().min(1).max(220) }))
    .max(5),
});
export type Telegram = z.infer<typeof TelegramSchema>;

export const QUIET_WORD = "Quiet";

/**
 * Words that carry a verdict one side disputes, or that sell alarm instead of describing what happened.
 * The telegram is public and read by everyone, so it never uses them, even when a source does.
 */
export const CONTESTED_WORDS = new Set([
  "genocide", "massacre", "terror", "terrorism", "terrorist", "terrorists", "martyr", "martyrs", "martyrdom",
  "aggression", "aggressor", "occupation", "occupier", "occupiers", "liberation", "liberated", "apartheid",
  "atrocity", "atrocities", "slaughter", "carnage", "bloodbath", "chaos", "horror", "catastrophe", "victory",
  "defeat", "surrender", "heroes", "invaders", "regime", "puppet", "annexation", "provocation", "crisis",
]);

const WORD_RE = /^\p{L}[\p{L}'-]{1,23}$/u;

/** Crude stemmer, enough to match "Ceasefires" to "ceasefire" and "Talks" to "talks". */
export function stem(word: string): string {
  let w = word.toLowerCase().replace(/[’']s$/, "");
  for (const suffix of ["ing", "ed", "es", "s"]) {
    if (w.endsWith(suffix) && w.length - suffix.length >= 3) {
      w = w.slice(0, -suffix.length);
      break;
    }
  }
  return w;
}

type Token = { raw: string; sentenceStart: boolean };

function tokens(text: string): Token[] {
  const out: Token[] = [];
  let start = true;
  for (const m of text.matchAll(/[\p{L}][\p{L}'’-]*|[.!?;:]/gu)) {
    const t = m[0];
    if (/^[.!?;:]$/.test(t)) {
      start = true;
      continue;
    }
    out.push({ raw: t, sentenceStart: start });
    start = false;
  }
  return out;
}

/**
 * Rules for the telegram word. Returns the violations; an empty list means the word passes.
 * The word must be lifted from the verified sentences it stands for, so the model cannot supply a verdict
 * the sources did not state, and it must not name a place, person or group.
 */
export function wordViolations(word: string, quietDay: boolean, sentences: string[]): string[] {
  const w = word.trim();
  const out: string[] = [];
  if (!WORD_RE.test(w)) return [`"${w}" is not a single word of letters (2 to 24 characters, hyphen allowed)`];
  if (quietDay) return w === QUIET_WORD ? [] : [`on a quiet day the word is "${QUIET_WORD}"`];
  if (w === QUIET_WORD) out.push(`"${QUIET_WORD}" is reserved for quiet days`);
  if (CONTESTED_WORDS.has(w.toLowerCase())) out.push(`"${w}" is a contested or alarm word; describe what happened instead`);
  const target = stem(w);
  const matches = sentences.flatMap(tokens).filter((t) => {
    const s = stem(t.raw);
    return s === target || (target.length >= 5 && (s.startsWith(target) || target.startsWith(s)) && Math.min(s.length, target.length) >= 5);
  });
  if (matches.length === 0) out.push(`"${w}" does not appear in the verified sentences of the chosen events`);
  else if (matches.every((t) => !t.sentenceStart && /^\p{Lu}/u.test(t.raw))) out.push(`"${w}" is a proper noun in the sources; the word must not name a place, person or group`);
  return out;
}

/** Everything the telegram needs checked beyond the word itself. */
export function telegramProblems(t: Telegram, usable: Map<number, VerifiedSentence[]>): string[] {
  const problems: string[] = [];
  const seen = new Set<number>();
  for (const e of t.events) {
    if (!usable.has(e.eventId)) problems.push(`event ${e.eventId} is not in the list`);
    if (seen.has(e.eventId)) problems.push(`event ${e.eventId} chosen twice`);
    seen.add(e.eventId);
    if (e.line.split(/\s+/).length > 25) problems.push(`line for event ${e.eventId} is over 25 words`);
    if (/\u2014/.test(e.line)) problems.push(`line for event ${e.eventId} has an em dash`);
  }
  if (!t.quietDay && t.events.length === 0) problems.push("choose at least one event unless it is a quiet day");
  if (t.quietDay && t.events.length > 0) problems.push("a quiet day lists no events");
  const sentences = t.events.flatMap((e) => (usable.get(e.eventId) ?? []).map((s) => s.text));
  for (const v of wordViolations(t.word, t.quietDay, sentences)) problems.push(`word: ${v}`);
  return problems;
}
