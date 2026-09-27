import type { RejectReason } from "./schemas.js";
import type { VerifiedSentence } from "./citations.js";
import type { z } from "zod";

/** Everything the renderers need for one reader's edition. Built by the pipeline or the Worker from the database. */
export type SourceRef = { articleId: number; title: string; url: string; publisher: string; publishedAt: Date };

export type EditionItemView = {
  eventId: number;
  title: string;
  importance: number;
  line: string;
  stakeParagraph: string;
  outsideInterests: boolean;
  explanation: { whatHappened: VerifiedSentence[]; whyItMatters: VerifiedSentence[]; whatChangesNext: VerifiedSentence[] };
  sources: SourceRef[];
};

export type LeftOutView = { eventId: number; title: string; reason: z.infer<typeof RejectReason> };

export type EditionView = {
  editionId: number;
  readerId: string;
  readerToken: string;
  runDate: string;
  headline: string;
  quietDay: boolean;
  items: EditionItemView[];
  leftOut: LeftOutView[];
};

export const REJECT_REASON_TEXT: Record<z.infer<typeof RejectReason>, string> = {
  "outside-interests": "outside your interests",
  muted: "a topic you muted",
  duplicate: "same story as one above",
  "low-importance": "minor today",
  "low-confidence": "not enough sourced detail",
};
