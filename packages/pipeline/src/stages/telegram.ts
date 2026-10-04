// The telegram (decision 26): one word for the emotion the day's world reporting evokes, on a fixed scale.
// Model calls with code in between, so the model never sets the scale on its own:
//   1. score: every explained world event gets -2 to 2 by what happened to people, citing one of its own
//      verified sentences. Checked in code. The call runs TELEGRAM_SCORE_RUNS times (default 3) and each event
//      keeps its middle score, because repeat runs sometimes disagree (decision 36).
//   2. dayBand (code): the worst significant event sets a bad day; an all-good day is the weighted average.
//   3. word: the model picks from the band's fixed list and names the events that shaped the day. Checked in code.
// Each call gets one retry with its problems spelled out. A score run that still breaks the rules is set aside
// and another is asked, up to two more; if none passes, or the word fails twice, the day has no word (decision
// 51). The checks themselves never loosen, and an outage or the spend ceiling still fails the stage.
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import {
  allowedWords,
  dayBand,
  medianScores,
  MOOD_BAND_LABEL,
  scoreProblems,
  TelegramScoresSchema,
  TelegramWordSchema,
  wordProblems,
  WORD_REPEAT_DAYS,
  type MoodBand,
  type RunDate,
  type ScoredEvent,
  type TelegramScores,
  type TelegramWord,
  type VerifiedSentence,
} from "@2dayai/core";
import { articles, eventArticles, eventExplanations, events, sources, telegramItems, telegramScores, telegrams, type Db } from "@2dayai/db";
import { loadPrompt, type Prompt } from "../prompts.js";
import type { Config } from "../config.js";
import { LlmParseError, type Llm } from "../llm/types.js";
import type { z } from "zod";

export const TELEGRAM_SCORE_PROMPT_VERSION = 1;
export const TELEGRAM_WORD_PROMPT_VERSION = 1;
export const TELEGRAM_SCOPE = "world";

export type TelegramReport = {
  candidates: number;
  written: boolean;
  word: string | null;
  band: MoodBand | null;
  events: number;
  /** Score calls made, and events whose runs gave different scores. */
  scoreRuns: number;
  split: number;
  retried: { score: boolean; word: boolean };
  /** Score runs set aside because they still broke the rules after their retry (decision 51). */
  rejected: number;
  reason?: string;
};

/** Extra score runs asked when one is set aside (decision 51). */
export const SPARE_SCORE_RUNS = 2;

/** The model's answer broke a rule twice. Unlike an outage, this costs the day its word, not the day. */
class RuleError extends Error {}
const ruleBroken = (err: unknown): err is Error => err instanceof RuleError || err instanceof LlmParseError;

type Candidate = { id: number; title: string; topic: string; importance: number; places: string[]; sentences: VerifiedSentence[] };
type Stored = { whatHappened: VerifiedSentence[]; whyItMatters: VerifiedSentence[]; whatChangesNext: VerifiedSentence[] };

function eventBlock(c: Candidate): string {
  return `[event ${c.id}] ${c.title}\ntopic: ${c.topic}, importance: ${c.importance}\nreported from: ${c.places.join(", ") || "unknown"}\n${c.sentences.map((s) => `- ${s.text}`).join("\n")}`;
}

export function scoreUserContent(date: RunDate, cands: Candidate[]): string {
  return `Run date: ${date}. World events with verified explanations, ${cands.length} in total. Score every one.\n\n${cands.map(eventBlock).join("\n\n")}`;
}

export function wordUserContent(date: RunDate, band: MoodBand, cands: Candidate[], scored: TelegramScores, recent: readonly string[] = []): string {
  const score = new Map(scored.scores.map((s) => [s.eventId, s.score]));
  const list = cands.map((c) => `${eventBlock(c)}\nscore: ${score.get(c.id) ?? 0}`).join("\n\n");
  return `Run date: ${date}.\nThe day's band, computed from the scores: ${band} (${MOOD_BAND_LABEL[band]}).\nAllowed words for this band: ${allowedWords(band, recent).join(", ")}.\n\nScored events, ${cands.length} in total:\n\n${list}`;
}

/** One model call, validated; one retry with the problems listed; then a thrown error. */
async function checkedCall<T extends z.ZodType>(
  llm: Llm,
  date: RunDate,
  req: { stage: string; prompt: Prompt; schema: T; user: string; effort: Config["effort"]["telegram"] },
  problemsOf: (v: z.infer<T>) => string[],
): Promise<{ value: z.infer<T>; retried: boolean }> {
  let problems: string[];
  let value: z.infer<T> | null = null;
  try {
    value = await llm.parse(req, date);
    problems = problemsOf(value);
  } catch (err) {
    problems = [err instanceof Error ? err.message : String(err)];
  }
  if (!problems.length && value !== null) return { value, retried: false };
  const retryUser = `${req.user}\n\nYour previous answer had these problems. Fix every one of them:\n${problems.map((p) => `- ${p}`).join("\n")}`;
  value = await llm.parse({ ...req, user: retryUser }, date);
  problems = problemsOf(value);
  if (problems.length) throw new RuleError(`${req.stage}: the model's answer still breaks the rules after one retry: ${problems.join("; ")}`);
  return { value, retried: true };
}

export async function runTelegram(db: Db, config: Config, llm: Llm, date: RunDate): Promise<TelegramReport> {
  await db.delete(telegrams).where(and(eq(telegrams.runDate, date), eq(telegrams.scope, TELEGRAM_SCOPE)));

  const rows = await db
    .select({ id: events.id, title: events.title, topic: events.topic, importance: events.importance, sentences: eventExplanations.sentences, usable: eventExplanations.usable, failed: eventExplanations.failed })
    .from(events)
    .innerJoin(eventExplanations, eq(eventExplanations.eventId, events.id))
    .where(and(eq(events.runDate, date), eq(events.desk, "world")));
  const usableRows = rows.filter((r) => r.usable);
  const none = { word: null, band: null, events: 0, scoreRuns: 0, split: 0, retried: { score: false, word: false }, rejected: 0 };
  if (usableRows.length === 0) {
    const failed = rows.filter((r) => r.failed).length;
    if (failed > 0) throw new Error(`telegram: no usable world events and ${failed} explanations failed; refusing to write a word`);
    return { candidates: 0, written: false, ...none, reason: "no explained world events for this date" };
  }

  const ids = usableRows.map((r) => r.id);
  const placeRows = await db
    .selectDistinct({ eventId: eventArticles.eventId, place: sources.placeName })
    .from(eventArticles)
    .innerJoin(articles, eq(articles.id, eventArticles.articleId))
    .innerJoin(sources, eq(sources.id, articles.sourceId))
    .where(inArray(eventArticles.eventId, ids));
  const cands: Candidate[] = usableRows
    .map((r) => {
      const s = r.sentences as Stored;
      return {
        id: r.id,
        title: r.title,
        topic: r.topic ?? "other",
        importance: r.importance,
        places: [...new Set(placeRows.filter((p) => p.eventId === r.id && p.place).map((p) => p.place!))],
        sentences: [...s.whatHappened, ...s.whyItMatters, ...s.whatChangesNext],
      };
    })
    .sort((a, b) => b.importance - a.importance);
  const usable = new Map(cands.map((c) => [c.id, c.sentences]));

  const scorePrompt = loadPrompt("telegram-score", TELEGRAM_SCORE_PROMPT_VERSION);
  // One after another, not in parallel: the repeats send the same prompt, so the provider's cache bills most of
  // their input at a tenth of the price.
  const runs: { value: TelegramScores; retried: boolean }[] = [];
  let rejected = 0;
  let lastProblem = "";
  for (let i = 0; runs.length < config.telegramScoreRuns && i < config.telegramScoreRuns + SPARE_SCORE_RUNS; i++) {
    try {
      runs.push(
        await checkedCall(
          llm,
          date,
          { stage: "telegram-score", prompt: scorePrompt, schema: TelegramScoresSchema, user: scoreUserContent(date, cands), effort: config.effort.telegram },
          (v) => scoreProblems(v, usable),
        ),
      );
    } catch (err) {
      if (!ruleBroken(err)) throw err;
      rejected += 1;
      lastProblem = err.message;
      console.error(`telegram: score run set aside. ${err.message}`);
    }
  }
  if (runs.length === 0) return { candidates: cands.length, written: false, ...none, rejected, reason: `every score run broke the rules. ${lastProblem}` };
  const median = medianScores(runs.map((r) => r.value));
  const scored = { value: { scores: median.scores }, retried: runs.some((r) => r.retried) };

  const importance = new Map(cands.map((c) => [c.id, c.importance]));
  const scoredEvents: ScoredEvent[] = scored.value.scores.map((s) => ({ eventId: s.eventId, importance: importance.get(s.eventId) ?? 1, score: s.score }));
  const band = dayBand(scoredEvents)!;

  // The past week's words, so no word repeats within it (decision 128): they are left off the allowed list.
  const weekBefore = new Date(Date.parse(`${date}T12:00:00Z`) - WORD_REPEAT_DAYS * 86_400_000).toISOString().slice(0, 10);
  const recent = (
    await db
      .select({ word: telegrams.word })
      .from(telegrams)
      .where(and(eq(telegrams.scope, TELEGRAM_SCOPE), lt(telegrams.runDate, date), gte(telegrams.runDate, weekBefore)))
  ).map((r) => r.word);

  const wordPrompt = loadPrompt("telegram-word", TELEGRAM_WORD_PROMPT_VERSION);
  let worded: { value: TelegramWord; retried: boolean };
  try {
    worded = await checkedCall(
      llm,
      date,
      { stage: "telegram-word", prompt: wordPrompt, schema: TelegramWordSchema, user: wordUserContent(date, band, cands, scored.value, recent), effort: config.effort.telegram },
      (v: TelegramWord) => wordProblems(v, band, scoredEvents, recent),
    );
  } catch (err) {
    if (!ruleBroken(err)) throw err;
    return { candidates: cands.length, written: false, ...none, band, scoreRuns: runs.length, split: median.split, retried: { score: scored.retried, word: true }, rejected, reason: err.message };
  }

  const word = worded.value.word.trim();
  const [row] = await db
    .insert(telegrams)
    .values({ runDate: date, scope: TELEGRAM_SCOPE, word, band, promptVersion: `${scorePrompt.label}+${wordPrompt.label}` })
    .returning({ id: telegrams.id });
  await db.insert(telegramScores).values(scored.value.scores.map((s) => ({ telegramId: row!.id, eventId: s.eventId, score: s.score, because: s.because })));
  await db.insert(telegramItems).values(worded.value.events.map((e, i) => ({ telegramId: row!.id, eventId: e.eventId, rank: i + 1, line: e.line })));
  return { candidates: cands.length, written: true, word, band, events: worded.value.events.length, scoreRuns: runs.length, split: median.split, retried: { score: scored.retried, word: worded.retried }, rejected };
}
