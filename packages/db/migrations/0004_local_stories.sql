CREATE TABLE "local_stories" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_date" date NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"domain" text NOT NULL,
	"lang" text,
	"published_at" timestamp with time zone NOT NULL,
	"place_name" text NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"region" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "local_stories_date_url_idx" ON "local_stories" USING btree ("run_date","url");