CREATE TABLE "articles" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"lead" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "citations" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"article_id" integer NOT NULL,
	"excerpt" text NOT NULL,
	"verified" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"edition_id" integer PRIMARY KEY NOT NULL,
	"provider_id" text,
	"status" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "edition_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"edition_id" integer NOT NULL,
	"event_id" integer NOT NULL,
	"rank" integer NOT NULL,
	"selected" boolean NOT NULL,
	"reason_code" text,
	"line" text,
	"stake_paragraph" text
);
--> statement-breakpoint
CREATE TABLE "editions" (
	"id" serial PRIMARY KEY NOT NULL,
	"reader_id" text NOT NULL,
	"run_date" date NOT NULL,
	"headline" text NOT NULL,
	"quiet_day" boolean NOT NULL,
	"prompt_version" text NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "event_articles" (
	"event_id" integer NOT NULL,
	"article_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_explanations" (
	"event_id" integer PRIMARY KEY NOT NULL,
	"sentences" jsonb NOT NULL,
	"usable" boolean NOT NULL,
	"prompt_version" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_date" date NOT NULL,
	"title" text NOT NULL,
	"importance" integer NOT NULL,
	"importance_reason" text NOT NULL,
	"prompt_version" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"reader_id" text NOT NULL,
	"event_id" integer NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_date" date NOT NULL,
	"stage" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(10, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reader_profiles" (
	"reader_id" text NOT NULL,
	"version" integer NOT NULL,
	"yaml" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "readers" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"email" text NOT NULL,
	"delivery_hour" integer NOT NULL,
	"timezone" text NOT NULL,
	"profile_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"topic" text NOT NULL,
	"tier" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citations" ADD CONSTRAINT "citations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citations" ADD CONSTRAINT "citations_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_items" ADD CONSTRAINT "edition_items_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_items" ADD CONSTRAINT "edition_items_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editions" ADD CONSTRAINT "editions_reader_id_readers_id_fk" FOREIGN KEY ("reader_id") REFERENCES "public"."readers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_articles" ADD CONSTRAINT "event_articles_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_articles" ADD CONSTRAINT "event_articles_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_explanations" ADD CONSTRAINT "event_explanations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_reader_id_readers_id_fk" FOREIGN KEY ("reader_id") REFERENCES "public"."readers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reader_profiles" ADD CONSTRAINT "reader_profiles_reader_id_readers_id_fk" FOREIGN KEY ("reader_id") REFERENCES "public"."readers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "articles_url_idx" ON "articles" USING btree ("url");--> statement-breakpoint
CREATE UNIQUE INDEX "editions_reader_date_idx" ON "editions" USING btree ("reader_id","run_date");--> statement-breakpoint
CREATE UNIQUE INDEX "event_articles_idx" ON "event_articles" USING btree ("event_id","article_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reader_profiles_idx" ON "reader_profiles" USING btree ("reader_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "readers_token_idx" ON "readers" USING btree ("token");