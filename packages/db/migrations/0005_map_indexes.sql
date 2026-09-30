CREATE INDEX "articles_published_at_idx" ON "articles" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "event_articles_article_idx" ON "event_articles" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "events_desk_run_date_idx" ON "events" USING btree ("desk","run_date");