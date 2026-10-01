import { z } from "zod";

/* Sources and articles (stage 6.1) */

export const SourceTier = z.enum(["primary", "trade", "general"]);

/** briefing feeds 2DayAI's reader editions; world feeds the public map and its telegram (decision 25). */
export const Desk = z.enum(["briefing", "world"]);
export type Desk = z.infer<typeof Desk>;

/** Where a publisher publishes from. The map pins publishers, never events (decision 23). */
export const SourcePlaceSchema = z.object({
  name: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});
export type SourcePlace = z.infer<typeof SourcePlaceSchema>;

export const SourceSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  url: z.string().url(),
  topic: z.string().min(1),
  tier: SourceTier,
  desk: Desk.default("briefing"),
  /** Required for world sources: a world source without a place could not be pinned. */
  place: SourcePlaceSchema.optional(),
  /** BCP 47 language of the feed, for the map's language label and translation. */
  lang: z.string().min(2).max(8).default("en"),
  /**
   * For outlets on the sides of a conflict or a contested place: the pair they belong to and their side. On a day one
   * side has no story, the whole pair is left out of the map, so it never shows one side's local outlets alone
   * (decision 90).
   */
  balance: z.object({ group: z.string().regex(/^[a-z0-9-]+$/), side: z.string().regex(/^[a-z0-9-]+$/) }).optional(),
});
export type Source = z.infer<typeof SourceSchema>;

export const SourcesFileSchema = z.object({
  sources: z
    .array(SourceSchema)
    .min(1)
    .superRefine((list, ctx) => {
      list.forEach((s, i) => {
        if (s.desk === "world" && !s.place) ctx.addIssue({ code: "custom", path: [i, "place"], message: `world source ${s.id} needs a place` });
      });
      // A balance group with one side would hold nothing back and only look balanced.
      const sides = new Map<string, Set<string>>();
      for (const s of list) if (s.balance) sides.set(s.balance.group, (sides.get(s.balance.group) ?? new Set()).add(s.balance.side));
      for (const [group, set] of sides) if (set.size < 2) ctx.addIssue({ code: "custom", path: [], message: `balance group ${group} has only one side` });
    }),
});

export const ArticleSchema = z.object({
  sourceId: z.string(),
  url: z.string().url(),
  title: z.string().min(1),
  lead: z.string().default(""),
  body: z.string().default(""),
  publishedAt: z.date(),
});
export type Article = z.infer<typeof ArticleSchema>;

/* Cluster (stage 6.2): the model groups the day's articles into events. */

export const ClusterEventSchema = z.object({
  title: z.string().min(1).max(120),
  articleIds: z.array(z.number().int()).min(1),
  importance: z.number().int().min(1).max(5),
  importanceReason: z.string().min(1).max(200),
});

export const ClusterResultSchema = z.object({
  /** Every article lands in exactly one event or in skipped. A single-article event is normal. */
  events: z.array(ClusterEventSchema),
  skipped: z.array(z.object({ articleId: z.number().int(), reason: z.string().min(1).max(120) })),
});
export type ClusterResult = z.infer<typeof ClusterResultSchema>;

/* Explain (stage 6.3): sentences with citations to verbatim excerpts. */

export const CitationSchema = z.object({
  articleId: z.number().int(),
  excerpt: z.string().min(1),
});
export type Citation = z.infer<typeof CitationSchema>;

export const SentenceSchema = z.object({
  text: z.string().min(1),
  citations: z.array(CitationSchema),
});
export type Sentence = z.infer<typeof SentenceSchema>;

export const ExplanationSchema = z.object({
  whatHappened: z.array(SentenceSchema),
  whyItMatters: z.array(SentenceSchema),
  whatChangesNext: z.array(SentenceSchema),
});
export type Explanation = z.infer<typeof ExplanationSchema>;

/* Reader profile (stage 6.4), hand-written YAML in version 0. */

function isTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const ReaderProfileSchema = z.object({
  id: z.string().regex(/^r\d{2}$/),
  email: z.string().email(),
  timezone: z.string().min(1).refine(isTimezone, "not an IANA timezone, for example America/New_York"),
  deliveryHour: z.number().int().min(0).max(23),
  topics: z.array(z.object({ name: z.string().min(1), weight: z.number().int().min(1).max(5) })).min(1),
  muted: z.array(z.string()).default([]),
  stake: z.array(z.string().min(1)).min(1),
});
export type ReaderProfile = z.infer<typeof ReaderProfileSchema>;

/* Select and headline (stages 6.4 and 6.5), one call per reader. */

export const RejectReason = z.enum(["outside-interests", "muted", "duplicate", "low-importance", "low-confidence"]);

export const SelectionSchema = z.object({
  selected: z
    .array(
      z.object({
        eventId: z.number().int(),
        line: z.string().min(1).max(200),
        stakeParagraph: z.string().min(1),
        outsideInterests: z.boolean(),
      }),
    )
    .min(1)
    .max(5),
  rejected: z.array(z.object({ eventId: z.number().int(), reason: RejectReason })).max(5),
  quietDay: z.boolean(),
  headline: z.string().min(1),
});
export type Selection = z.infer<typeof SelectionSchema>;
