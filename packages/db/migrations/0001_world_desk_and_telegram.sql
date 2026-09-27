CREATE TABLE "telegram_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"telegram_id" integer NOT NULL,
	"event_id" integer NOT NULL,
	"rank" integer NOT NULL,
	"line" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegrams" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_date" date NOT NULL,
	"scope" text NOT NULL,
	"word" text NOT NULL,
	"quiet_day" boolean NOT NULL,
	"prompt_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "desk" text DEFAULT 'briefing' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "topic" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "desk" text DEFAULT 'briefing' NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "place_name" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "lat" double precision;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "lon" double precision;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "lang" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "telegram_items" ADD CONSTRAINT "telegram_items_telegram_id_telegrams_id_fk" FOREIGN KEY ("telegram_id") REFERENCES "public"."telegrams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_items" ADD CONSTRAINT "telegram_items_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "telegrams_date_scope_idx" ON "telegrams" USING btree ("run_date","scope");