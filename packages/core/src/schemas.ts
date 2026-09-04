import { z } from "zod";

/* Sources and articles (stage 6.1) */

export const SourceTier = z.enum(["primary", "trade", "general"]);

export const SourceSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  url: z.string().url(),
  topic: z.string().min(1),
  tier: SourceTier,
});
export type Source = z.infer<typeof SourceSchema>;

export const SourcesFileSchema = z.object({
  sources: z.array(SourceSchema).min(1),
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
  events: z.array(ClusterEventSchema),
  singletonArticleIds: z.array(z.number().int()),
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

export const ReaderProfileSchema = z.object({
  id: z.string().regex(/^r\d{2}$/),
  timezone: z.string().min(1),
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
