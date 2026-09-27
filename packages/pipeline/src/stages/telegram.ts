// The conflict telegram (decision 25): one word for the day's conflict reporting worldwide, and the events it
// stands for. A sibling of select that runs once for the world instead of once per reader. The word is written
// from verified sentences only and checked in code: one word, found in those sentences, not a name, not a
// contested label. One retry with the problems spelled out, then the stage fails loudly.
import { and, eq, inArray } from "drizzle-orm";
import { TelegramSchema, telegramProblems, type RunDate, type Telegram, type VerifiedSentence } from "@2dayai/core";
import { articles, eventArticles, eventExplanations, events, sources, telegramItems, telegrams, type Db } from "@2dayai/db";
import { loadPrompt } from "../prompts.js";
import type { Config } from "../config.js";
import type { Llm } from "../llm/types.js";

export const TELEGRAM_PROMPT_VERSION = 1;
export const TELEGRAM_SCOPE = "conflict";

export type TelegramReport = { candidates: number; written: boolean; word: string | null; quietDay: boolean; events: number; retried: boolean; reason?: string };

type Candidate = { id: number; title: string; importance: number; places: string[]; sentences: VerifiedSentence[] };

type Stored = { whatHappened: VerifiedSentence[]; whyItMatters: VerifiedSentence[]; whatChangesNext: VerifiedSentence[] };

export function telegramUserContent(date: RunDate, cands: Candidate[]): string {
  const list = cands
    .map((c) => `[event ${c.id}] ${c.title}\nimportance: ${c.importance}\nreported from: ${c.places.join(", ") || "unknown"}\n${c.sentences.map((s) => `- ${s.text}`).join("\n")}`)
    .join("\n\n");
  return `Run date: ${date}. Conflict events with verified explanations, ${cands.length} in total:\n\n${list}`;
}

export async function runTelegram(db: Db, config: Config, llm: Llm, date: RunDate): Promise<TelegramReport> {
  await db.delete(telegrams).where(and(eq(telegrams.runDate, date), eq(telegrams.scope, TELEGRAM_SCOPE)));

  const rows = await db
    .select({ id: events.id, title: events.title, importance: events.importance, sentences: eventExplanations.sentences, usable: eventExplanations.usable, failed: eventExplanations.failed })
    .from(events)
    .innerJoin(eventExplanations, eq(eventExplanations.eventId, events.id))
    .where(and(eq(events.runDate, date), eq(events.desk, "world"), eq(events.topic, "conflict")));
  const usableRows = rows.filter((r) => r.usable);
  if (usableRows.length === 0) {
    const failed = rows.filter((r) => r.failed).length;
    if (failed > 0) throw new Error(`telegram: no usable conflict events and ${failed} explanations failed; refusing to call the day quiet`);
    return { candidates: 0, written: false, word: null, quietDay: false, events: 0, retried: false, reason: "no verified conflict reporting for this date" };
  }

  const ids = usableRows.map((r) => r.id);
  const placeRows = await db
    .selectDistinct({ eventId: eventArticles.eventId, place: sources.placeName })
    .from(eventArticles)
    .innerJoin(articles, eq(articles.id, eventArticles.articleId))
    .innerJoin(sources, eq(sources.id, articles.sourceId))
    .where(inArray(eventArticles.eventId, ids));
  const cands: Candidate[] = usableRows.map((r) => {
    const s = r.sentences as Stored;
    return {
      id: r.id,
      title: r.title,
      importance: r.importance,
      places: [...new Set(placeRows.filter((p) => p.eventId === r.id && p.place).map((p) => p.place!))],
      sentences: [...s.whatHappened, ...s.whyItMatters, ...s.whatChangesNext],
    };
  });
  cands.sort((a, b) => b.importance - a.importance);
  const usable = new Map(cands.map((c) => [c.id, c.sentences]));

  const prompt = loadPrompt("telegram", TELEGRAM_PROMPT_VERSION);
  const user = telegramUserContent(date, cands);
  let retried = false;
  let t: Telegram | null = null;
  let problems: string[];
  try {
    t = await llm.parse({ stage: "telegram", prompt, schema: TelegramSchema, user, effort: config.effort.telegram }, date);
    problems = telegramProblems(t, usable);
  } catch (err) {
    problems = [err instanceof Error ? err.message : String(err)];
  }
  if (problems.length) {
    retried = true;
    const retryUser = `${user}\n\nYour previous answer had these problems. Fix every one of them:\n${problems.map((p) => `- ${p}`).join("\n")}`;
    t = await llm.parse({ stage: "telegram", prompt, schema: TelegramSchema, user: retryUser, effort: config.effort.telegram }, date);
    problems = telegramProblems(t, usable);
  }
  if (!t || problems.length) throw new Error(`telegram: the model's answer still breaks the rules after one retry: ${problems.join("; ")}`);

  const [row] = await db
    .insert(telegrams)
    .values({ runDate: date, scope: TELEGRAM_SCOPE, word: t.word.trim(), quietDay: t.quietDay, promptVersion: prompt.label })
    .returning({ id: telegrams.id });
  if (t.events.length) await db.insert(telegramItems).values(t.events.map((e, i) => ({ telegramId: row!.id, eventId: e.eventId, rank: i + 1, line: e.line })));
  return { candidates: cands.length, written: true, word: t.word.trim(), quietDay: t.quietDay, events: t.events.length, retried };
}
