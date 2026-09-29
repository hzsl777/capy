// The data model from docs/SPEC.md section 7. This file is the source of truth; the spec is the map.
// Cascades exist so that re-running a stage for a date can delete its own output and everything derived from it
// (spec decision 6). Feedback is never cascaded away: it keeps the event title and drops the id.
import { boolean, date, doublePrecision, integer, jsonb, numeric, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const sources = pgTable("sources", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  topic: text("topic").notNull(),
  tier: text("tier").notNull(),
  /** briefing (2DayAI editions) or world (the public map). Decision 25. */
  desk: text("desk").notNull().default("briefing"),
  /** Where the publisher publishes from; the map's pin. Null for briefing sources. */
  placeName: text("place_name"),
  lat: doublePrecision("lat"),
  lon: doublePrecision("lon"),
  lang: text("lang").notNull().default("en"),
  /**
   * Feed health, kept by ingest so the list heals itself (decision 36): the feed found behind a configured
   * homepage (used while `feedFrom` still equals `url`), consecutive failed days, and the last good fetch.
   */
  feedUrl: text("feed_url"),
  feedFrom: text("feed_from"),
  failStreak: integer("fail_streak").notNull().default(0),
  /** The run date of the last failure, so re-running a day counts it once. */
  lastFailOn: date("last_fail_on"),
  lastOkAt: timestamp("last_ok_at", { withTimezone: true }),
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
    /** feed: body came with the feed. page: fetched from the article page. none: title and lead only. */
    bodySource: text("body_source").notNull().default("none"),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    enrichedAt: timestamp("enriched_at", { withTimezone: true }),
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
  desk: text("desk").notNull().default("briefing"),
  /** World desk only: one of WORLD_TOPICS. */
  topic: text("topic"),
  /** World desk only: where the event happened, checked against the city list (decision 44). Null means unplaced. */
  placeName: text("place_name"),
  lat: doublePrecision("lat"),
  lon: doublePrecision("lon"),
});

export const eventArticles = pgTable(
  "event_articles",
  {
    eventId: integer("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    articleId: integer("article_id").notNull().references(() => articles.id),
  },
  (t) => [uniqueIndex("event_articles_idx").on(t.eventId, t.articleId)],
);

export const eventExplanations = pgTable("event_explanations", {
  eventId: integer("event_id").primaryKey().references(() => events.id, { onDelete: "cascade" }),
  /** VerifiedExplanation from core, minus the unverified sentences. */
  sentences: jsonb("sentences").notNull(),
  usable: boolean("usable").notNull(),
  /** The model request itself failed (batch error, refusal, schema mismatch). Distinct from usable=false after verification. */
  failed: boolean("failed").notNull().default(false),
  survivors: integer("survivors").notNull(),
  dropped: integer("dropped").notNull(),
  promptVersion: text("prompt_version").notNull(),
});

export const citations = pgTable("citations", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("editions_reader_date_idx").on(t.readerId, t.runDate)],
);

export const editionItems = pgTable("edition_items", {
  id: serial("id").primaryKey(),
  editionId: integer("edition_id").notNull().references(() => editions.id, { onDelete: "cascade" }),
  eventId: integer("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  rank: integer("rank").notNull(),
  selected: boolean("selected").notNull(),
  outsideInterests: boolean("outside_interests").notNull().default(false),
  reasonCode: text("reason_code"),
  line: text("line"),
  stakeParagraph: text("stake_paragraph"),
});

export const feedback = pgTable("feedback", {
  id: serial("id").primaryKey(),
  readerId: text("reader_id").notNull().references(() => readers.id),
  eventId: integer("event_id").references(() => events.id, { onDelete: "set null" }),
  eventTitle: text("event_title").notNull(),
  runDate: date("run_date").notNull(),
  kind: text("kind").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const deliveries = pgTable("deliveries", {
  editionId: integer("edition_id").primaryKey().references(() => editions.id, { onDelete: "cascade" }),
  providerId: text("provider_id"),
  status: text("status").notNull(),
  detail: text("detail"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const llmCalls = pgTable("llm_calls", {
  id: serial("id").primaryKey(),
  runDate: date("run_date").notNull(),
  stage: text("stage").notNull(),
  model: text("model").notNull(),
  promptVersion: text("prompt_version").notNull(),
  batch: boolean("batch").notNull().default(false),
  inputTokens: integer("input_tokens").notNull(),
  outputTokens: integer("output_tokens").notNull(),
  cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
  cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
  costUsd: numeric("cost_usd", { precision: 10, scale: 6 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Audit trail: one row per stage per run. The GitHub Actions log is the other copy. */
export const runs = pgTable("runs", {
  id: serial("id").primaryKey(),
  runDate: date("run_date").notNull(),
  stage: text("stage").notNull(),
  status: text("status").notNull(),
  detail: jsonb("detail"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

/** The telegram for a run date (decision 26): one emotion word from a fixed list, for the band the scores set. */
export const telegrams = pgTable(
  "telegrams",
  {
    id: serial("id").primaryKey(),
    runDate: date("run_date").notNull(),
    /** What the word reads from. "world" today. */
    scope: text("scope").notNull(),
    word: text("word").notNull(),
    /** -2 to 2, from dayBand over telegram_scores. */
    band: integer("band").notNull(),
    promptVersion: text("prompt_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("telegrams_date_scope_idx").on(t.runDate, t.scope)],
);

export const telegramItems = pgTable("telegram_items", {
  id: serial("id").primaryKey(),
  telegramId: integer("telegram_id").notNull().references(() => telegrams.id, { onDelete: "cascade" }),
  eventId: integer("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  rank: integer("rank").notNull(),
  line: text("line").notNull(),
});

/** One score per explained world event, with the verified sentence the model gave as its reason. */
export const telegramScores = pgTable("telegram_scores", {
  id: serial("id").primaryKey(),
  telegramId: integer("telegram_id").notNull().references(() => telegrams.id, { onDelete: "cascade" }),
  eventId: integer("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  score: integer("score").notNull(),
  because: text("because").notNull(),
});
