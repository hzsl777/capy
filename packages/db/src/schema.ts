// The data model from docs/SPEC.md section 7. This file is the source of truth; the spec is the map.
import { boolean, date, integer, jsonb, numeric, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const sources = pgTable("sources", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  topic: text("topic").notNull(),
  tier: text("tier").notNull(),
});

export const articles = pgTable(
  "articles",
  {
    id: serial("id").primaryKey(),
    sourceId: text("source_id").notNull().references(() => sources.id),
    url: text("url").notNull(),
    title: text("title").notNull(),
    lead: text("lead").notNull().default(""),
    body: text("body").notNull().default(""),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("articles_url_idx").on(t.url)],
);

export const events = pgTable("events", {
  id: serial("id").primaryKey(),
  runDate: date("run_date").notNull(),
  title: text("title").notNull(),
  importance: integer("importance").notNull(),
  importanceReason: text("importance_reason").notNull(),
  promptVersion: text("prompt_version").notNull(),
});

export const eventArticles = pgTable(
  "event_articles",
  {
    eventId: integer("event_id").notNull().references(() => events.id),
    articleId: integer("article_id").notNull().references(() => articles.id),
  },
  (t) => [uniqueIndex("event_articles_idx").on(t.eventId, t.articleId)],
);

export const eventExplanations = pgTable("event_explanations", {
  eventId: integer("event_id").primaryKey().references(() => events.id),
  sentences: jsonb("sentences").notNull(),
  usable: boolean("usable").notNull(),
  promptVersion: text("prompt_version").notNull(),
});

export const citations = pgTable("citations", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull().references(() => events.id),
  articleId: integer("article_id").notNull().references(() => articles.id),
  excerpt: text("excerpt").notNull(),
  verified: boolean("verified").notNull(),
});

export const readers = pgTable(
  "readers",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull(),
    email: text("email").notNull(),
    deliveryHour: integer("delivery_hour").notNull(),
    timezone: text("timezone").notNull(),
    profileVersion: integer("profile_version").notNull().default(1),
  },
  (t) => [uniqueIndex("readers_token_idx").on(t.token)],
);

export const readerProfiles = pgTable(
  "reader_profiles",
  {
    readerId: text("reader_id").notNull().references(() => readers.id),
    version: integer("version").notNull(),
    yaml: text("yaml").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("reader_profiles_idx").on(t.readerId, t.version)],
);

export const editions = pgTable(
  "editions",
  {
    id: serial("id").primaryKey(),
    readerId: text("reader_id").notNull().references(() => readers.id),
    runDate: date("run_date").notNull(),
    headline: text("headline").notNull(),
    quietDay: boolean("quiet_day").notNull(),
    promptVersion: text("prompt_version").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("editions_reader_date_idx").on(t.readerId, t.runDate)],
);

export const editionItems = pgTable("edition_items", {
  id: serial("id").primaryKey(),
  editionId: integer("edition_id").notNull().references(() => editions.id),
  eventId: integer("event_id").notNull().references(() => events.id),
  rank: integer("rank").notNull(),
  selected: boolean("selected").notNull(),
  reasonCode: text("reason_code"),
  line: text("line"),
  stakeParagraph: text("stake_paragraph"),
});

export const feedback = pgTable("feedback", {
  id: serial("id").primaryKey(),
  readerId: text("reader_id").notNull().references(() => readers.id),
  eventId: integer("event_id").notNull().references(() => events.id),
  kind: text("kind").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const deliveries = pgTable("deliveries", {
  editionId: integer("edition_id").primaryKey().references(() => editions.id),
  providerId: text("provider_id"),
  status: text("status").notNull(),
});

export const llmCalls = pgTable("llm_calls", {
  id: serial("id").primaryKey(),
  runDate: date("run_date").notNull(),
  stage: text("stage").notNull(),
  model: text("model").notNull(),
  promptVersion: text("prompt_version").notNull(),
  inputTokens: integer("input_tokens").notNull(),
  outputTokens: integer("output_tokens").notNull(),
  cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
  costUsd: numeric("cost_usd", { precision: 10, scale: 6 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
