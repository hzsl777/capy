// Test double. Same seam as the real client, answers from a script keyed by stage. No SDK import.
import type { z } from "zod";
import type { RunDate } from "@2dayai/core";
import { LlmParseError, type Llm, type ParseOutcome, type ParseRequest } from "./types.js";

export type FakeAnswer = (req: { stage: string; user: string; attempt: number }) => unknown;

export class FakeLlm implements Llm {
  public calls: { stage: string; user: string; id?: string }[] = [];
  private attempts = new Map<string, number>();
  constructor(private answers: Record<string, FakeAnswer>) {}

  private answer(stage: string, user: string, id?: string): unknown {
    // Attempts count per stage, so a retry through parse() after parseMany() is attempt 2.
    const attempt = (this.attempts.get(stage) ?? 0) + 1;
    this.attempts.set(stage, attempt);
    const fn = this.answers[stage];
    if (!fn) throw new Error(`FakeLlm has no answer for stage ${stage}`);
    const call: { stage: string; user: string; id?: string } = { stage, user };
    if (id !== undefined) call.id = id;
    this.calls.push(call);
    return fn({ stage, user, attempt });
  }

  async parse<T extends z.ZodType>(req: Omit<ParseRequest<T>, "id">, _date: RunDate): Promise<z.infer<T>> {
    const raw = this.answer(req.stage, req.user);
    const parsed = req.schema.safeParse(raw);
    if (!parsed.success) throw new LlmParseError(req.stage, parsed.error.message);
    return parsed.data;
  }

  async parseMany<T extends z.ZodType>(reqs: ParseRequest<T>[], date: RunDate): Promise<Map<string, ParseOutcome<z.infer<T>>>> {
    const out = new Map<string, ParseOutcome<z.infer<T>>>();
    for (const req of reqs) {
      try {
        const raw = this.answer(req.stage, req.user, req.id);
        const parsed = req.schema.safeParse(raw);
        if (!parsed.success) throw new LlmParseError(req.stage, parsed.error.message);
        out.set(req.id, { ok: true, value: parsed.data });
      } catch (err) {
        out.set(req.id, { ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
    void date;
    return out;
  }
}
