# Decisions

One entry per decision. A reversal is a new entry that names the one it reverses. Never edit an entry.

Decisions 1 to 12 are stated in full in SPEC.md sections 4 and 5. This file records what changed after the spec was written.

## 13. Boundary rule is a script, not an ESLint plugin (September 4, 2026)

SPEC.md section 8 said an ESLint boundary rule. Milestone 0 uses `tools/check-boundaries.mjs`, forty lines with no dependencies, run as `npm run lint`. Reason: one fewer toolchain to configure and the rule is readable in full. Revisit when a real linter is added.

## 14. Web package excluded from the root typecheck (September 4, 2026)

The Worker compiles against Cloudflare types, not Node types. It has its own tsconfig and is checked by `wrangler` at deploy. The root `npm run typecheck` covers core, db, and pipeline.

## 15. Starter source list is unverified (September 4, 2026)

The build environment could not reach any news host. `config/sources.yaml` ships with the candidate list and `npm run stage -- sources check` exists so the list can be verified locally in one command. Davis owns the list.

## 16. Article pages are fetched for text (September 4, 2026)

Feeds mostly carry a title and a lead, and a citation needs a passage to point at. The enrich stage fetches each article page once, extracts the main text with Readability, and stores up to 30,000 characters. The page text is used for verification and for quoted excerpts, never republished whole. A page that yields nothing leaves the article with what the feed gave.

## 17. Delivery is its own hourly job (September 4, 2026)

The day runs once at 09:00 UTC. Delivery runs every hour and sends editions whose reader's local hour has reached their delivery hour. This is how "per reader, from the start" costs nothing: one more cron line.

## 18. Feedback survives re-runs (September 4, 2026)

Re-running cluster for a date deletes that date's events and everything derived from them, except feedback. Feedback keeps the event title and drops the id. Reader signals are never destroyed by a prompt change.

## 19. Tests run on a real Postgres engine (September 4, 2026)

Integration tests use PGlite with the real migrations. The model is a scripted fake behind the same interface as the real client. The suite runs with no network and no key, and exercises the schema, the cascades, the citation check, the selection validator, the retry, and delivery idempotence.

## 20. The stake paragraph is labeled (September 4, 2026)

The paragraph on why an event matters to this reader is written from the profile and the verified sentences. It cannot be verified against a source the way the explanation can. It is labeled on the page: "Written from your profile, not from the sources." The honesty boundary is visible, not hidden.

## 21. Selection is validated and retried once (September 4, 2026)

The model's selection is checked in code: every id must be a usable event, no duplicates, no overlap between selected and rejected, at most one outside-interests slot, at least three chosen when three exist, and the headline rules. Problems are sent back once with the errors spelled out. A second failure fails that reader's edition loudly rather than shipping a bad one.

## 22. First adversarial review, eight findings fixed (September 4, 2026)

An independent review of the whole tree found eight real defects before any live run. All are fixed and each has a test.

1. A sentence citing one real passage and one invented passage kept both; the invented excerpt would have been quoted on the page. Now every citation is checked on its own and only the passing ones survive.
2. Evening delivery hours in American time zones never sent, because delivery filtered by the UTC run date. Delivery now considers every unsent edition and sends once the reader's local date and hour have passed the run date's delivery hour.
3. A dead model stage turned into a quiet day for every reader. Explain now stops the day when requests fail and nothing is usable, and select refuses to write quiet editions while failed explanations exist.
4. Re-running select replaced an edition already in a reader's inbox and sent it again; re-running cluster broke its links. Select skips readers with a sent edition. Cluster refuses to run after a send unless forced, and says so.
5. Spend under-counted: cache writes were never priced. They are now, at 1.25 times the input rate.
6. An unset GitHub Actions variable arrives as an empty string and broke config defaults. Empty strings are treated as absent.
7. The Worker accepted non-numeric ids and impossible dates, and recorded feedback for any event. Ids and dates are validated, and feedback is accepted only for an event in that reader's edition on that date.
8. Feedback links were plain GETs, which mail link scanners would trigger. GET now shows a one-button form; POST records.

Also from the review: the Worker was excluded from the CI typecheck. It is included now.

## 23. The code lives in capy, alongside a second product (September 27, 2026)

Davis's capy idea is a Radio Garden for news: a public map where a place shows what is being published there. The pipeline built for 2DayAI is the objective layer that map needs, so the code moves into hzsl777/capy rather than a repository of its own. 2DayAI and the map are two thin products over one pipeline and one database. The map is deferred until 2DayAI holds up for a week with Davis as reader one (milestone 4), so the second product does not starve the first.

Three design points fixed now so the pipeline does not need rework later:

1. Pins are publishers, placed where they publish from, not where events happen. This is how Radio Garden places stations. It needs no geocoding, and it never labels a disputed place. The source list gains a latitude and longitude per source when the map starts.
2. The map draws coastlines only. No borders, no country names. The unit of place is the publisher pin and a region radius around it.
3. The region's telegram line is the 2DayAI headline with the reader replaced by a place: a sibling of the select stage that runs per region instead of per profile. Level 1 (titles and links) is free everywhere; explanations and the telegram line are generated only for the top events per region, so model spend scales with regions shown, not with articles ingested.

Capy is private, so Actions has 2,000 free minutes a month. Delivery moves to every two hours and dependencies are cached to fit.

## 24. A map prototype exists ahead of decision 23's schedule (September 27, 2026)

At Davis's request in a parallel session, a working map prototype was built before milestone 4 and merged here as `packages/map`. Decision 23 stands as the plan of record. The prototype is a design study: three looks (Morning Edition, Cabinet Map, Wire Room), flat and globe views, the crosshair and panel, an in-app reader, story arcs across places, a replay slider and topic filters. It is not deployed, and its deploy workflow runs only by hand.

It runs on stand-in data: the free GDELT index, read by `packages/map/pipeline`, with each article placed at the first city it mentions. Before the map ships, it changes to match decision 23:

1. Pins become publishers, at the places they publish from. The source list gains coordinates and the prototype's GDELT placement (`choosePlace`) is retired. The prototype's RSS adapter already pins each source to its home city.
2. Each region shows its telegram line, generated by the region sibling of select from verified sentences only, and labeled as generated. The headlines under it stay as published.
3. The map reads the shared database through a read model instead of its own static JSON. Whether a static export stays, to keep hosting free, is decided then.

Kept from the prototype and consistent with decision 23: no borders and no country names, coastlines and physical features only. Also kept: no text drawn on the map itself, outlets balanced within each place, and a reader that shows the outlet's own preview and frames the full page only when the outlet allows it.

Until the map work starts, `packages/map` imports nothing from the workspace.
