// Stages 6.4 and 6.5. One request per reader, batched. Validates the model's choices against the usable events
// and the headline against the rules. One retry with the errors spelled out, then the reader's edition fails loudly.
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { headlineViolations, SelectionSchema, type RunDate, type Selection, type VerifiedSentence } from "@2dayai/core";
import { loadPrompt } from "../prompts.js";
import { editionItems, editions, eventExplanations, events, readerProfiles, readers, type Db } from "@2dayai/db";
import type { Config } from "../config.js";
import type { Llm, ParseRequest } from "../llm/types.js";

export const SELECT_PROMPT_VERSION = 1;
export const QUIET_HEADLINE = "Nothing today needs you.";

export type SelectReport = { readers: number; editions: number; quiet: number; failed: number; retried: number; skippedSent: number };

type UsableEvent = { id: number; title: string; importance: number; sentences: string[] };

export function selectUserContent(profileYaml: string, evs: UsableEvent[]): string {
  const list = evs.map((e) => `[event ${e.id}] ${e.title}\nimportance: ${e.importance}\n${e.sentences.map((s) => `- ${s}`).join("\n")}`).join("\n\n");
  return `Reader profile (YAML):\n\n${profileYaml.trim()}\n\nEvents with verified explanations, ${evs.length} in total:\n\n${list}`;
}

/** Everything that must hold before an edition is written. Returns human-readable problems for the retry. */
export function selectionProblems(sel: Selection, usableIds: Set<number>): string[] {
  const problems: string[] = [];
  const seen = new Set<number>();
  for (const s of sel.selected) {
    if (!usableIds.has(s.eventId)) problems.push(`selected event ${s.eventId} is not in the list`);
    if (seen.has(s.eventId)) problems.push(`event ${s.eventId} selected twice`);
    seen.add(s.eventId);
    if (s.line.split(/\s+/).length > 25) problems.push(`line for event ${s.eventId} is over 25 words`);
  }
  for (const r of sel.rejected) {
    if (!usableIds.has(r.eventId)) problems.push(`rejected event ${r.eventId} is not in the list`);
    if (seen.has(r.eventId)) problems.push(`event ${r.eventId} is both selected and rejected`);
  }
  if (sel.selected.filter((s) => s.outsideInterests).length > 1) problems.push("more than one event marked outsideInterests");
  if (sel.selected.length < Math.min(3, usableIds.size)) problems.push(`only ${sel.selected.length} selected with ${usableIds.size} available; choose at least ${Math.min(3, usableIds.size)}`);
  for (const v of headlineViolations(sel.headline)) problems.push(`headline: ${v}`);
  return problems;
}

async function writeEdition(db: Db, readerId: string, date: RunDate, promptLabel: string, sel: Selection | null): Promise<void> {
  await db.delete(editions).where(and(eq(editions.readerId, readerId), eq(editions.runDate, date)));
  const [ed] = await db
    .insert(editions)
    .values({ readerId, runDate: date, headline: sel?.headline ?? QUIET_HEADLINE, quietDay: sel?.quietDay ?? true, promptVersion: promptLabel })
    .returning({ id: editions.id });
  if (!sel) return;
  const rows = [
    ...sel.selected.map((s, i) => ({ editionId: ed!.id, eventId: s.eventId, rank: i + 1, selected: true, outsideInterests: s.outsideInterests, line: s.line, stakeParagraph: s.stakeParagraph })),
    ...sel.rejected.map((r, i) => ({ editionId: ed!.id, eventId: r.eventId, rank: 100 + i, selected: false, reasonCode: r.reason })),
  ];
  if (rows.length) await db.insert(editionItems).values(rows);
}

export async function runSelect(db: Db, config: Config, llm: Llm, date: RunDate): Promise<SelectReport> {
  const all = await db.select().from(readers);
  const report: SelectReport = { readers: all.length, editions: 0, quiet: 0, failed: 0, retried: 0, skippedSent: 0 };
  if (all.length === 0) return report;
  // A sent edition is final. Re-running select never replaces what a reader already received.
  const sent = new Set((await db.select({ readerId: editions.readerId }).from(editions).where(and(eq(editions.runDate, date), isNotNull(editions.sentAt)))).map((r) => r.readerId));
  const rs = all.filter((r) => !sent.has(r.id));
  report.skippedSent = all.length - rs.length;
  if (rs.length === 0) return report;

  const evs = await db
    .select({ id: events.id, title: events.title, importance: events.importance, sentences: eventExplanations.sentences })
    .from(events)
    .innerJoin(eventExplanations, eq(eventExplanations.eventId, events.id))
    .where(and(eq(events.runDate, date), eq(eventExplanations.usable, true)));
  const usable: UsableEvent[] = evs.map((e) => {
    const s = e.sentences as { whatHappened: VerifiedSentence[]; whyItMatters: VerifiedSentence[]; whatChangesNext: VerifiedSentence[] };
    return { id: e.id, title: e.title, importance: e.importance, sentences: [...s.whatHappened, ...s.whyItMatters, ...s.whatChangesNext].map((x) => x.text) };
  });
  const usableIds = new Set(usable.map((e) => e.id));
  const prompt = loadPrompt("select", SELECT_PROMPT_VERSION);

  if (usable.length === 0) {
    const anyFailed = (await db.select({ id: eventExplanations.eventId }).from(eventExplanations).innerJoin(events, eq(events.id, eventExplanations.eventId)).where(and(eq(events.runDate, date), eq(eventExplanations.failed, true)))).length;
    if (anyFailed > 0) throw new Error(`select: no usable events and ${anyFailed} explanations failed; refusing to write quiet editions`);
    for (const r of rs) {
      await writeEdition(db, r.id, date, prompt.label, null);
      report.editions += 1;
      report.quiet += 1;
    }
    return report;
  }

  const profiles = await db.select().from(readerProfiles).where(inArray(readerProfiles.readerId, rs.map((r) => r.id)));
  const yamlFor = (id: string, version: number) => profiles.find((p) => p.readerId === id && p.version === version)?.yaml ?? profiles.filter((p) => p.readerId === id).sort((a, b) => b.version - a.version)[0]?.yaml ?? "";

  const reqs: ParseRequest<typeof SelectionSchema>[] = rs.map((r) => ({
    id: `reader-${r.id}`,
    stage: "select",
    prompt,
    schema: SelectionSchema,
    user: selectUserContent(yamlFor(r.id, r.profileVersion), usable),
    effort: config.effort.select,
  }));
  const results = await llm.parseMany(reqs, date);

  for (const r of rs) {
    const req = reqs.find((q) => q.id === `reader-${r.id}`)!;
    const outcome = results.get(req.id);
    let sel: Selection | null = outcome?.ok ? outcome.value : null;
    let problems = sel ? selectionProblems(sel, usableIds) : [outcome && !outcome.ok ? outcome.error : "no result"];
    if (problems.length) {
      report.retried += 1;
      try {
        const retryUser = `${req.user}\n\nYour previous answer had these problems. Fix every one of them:\n${problems.map((p) => `- ${p}`).join("\n")}`;
        sel = await llm.parse({ stage: "select", prompt, schema: SelectionSchema, user: retryUser, effort: config.effort.select }, date);
        problems = selectionProblems(sel, usableIds);
      } catch (err) {
        sel = null;
        problems = [err instanceof Error ? err.message : String(err)];
      }
    }
    if (!sel || problems.length) {
      report.failed += 1;
      console.error(`select: reader ${r.id} failed: ${problems.join("; ")}`);
      continue;
    }
    await writeEdition(db, r.id, date, prompt.label, sel);
    report.editions += 1;
    if (sel.quietDay) report.quiet += 1;
  }
  return report;
}
