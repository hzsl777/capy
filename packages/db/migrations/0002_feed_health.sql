ALTER TABLE "sources" ADD COLUMN "feed_url" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "feed_from" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "fail_streak" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "last_fail_on" date;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "last_ok_at" timestamp with time zone;