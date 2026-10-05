---
name: ingest-pipeline
description: Run, debug or change the world desk that feeds GlobalGist, the public map, covering world sources, cluster world with topics, which events get explained, the one-word mood telegram (scores, the band formula, the word lists) and its checks, and the map read model (loadMapView, /data/latest.json). Use for questions like "why is there no word today", "why was the word rejected", "why is a place empty", "why is this event unexplained", or changes to how world events are chosen.
---

# The world desk

Paths are relative to the repository root.

The daily run (`npm run stage -- day`, `.github/workflows/daily.yml`) is one pipeline for both products (decision 25):

```
config/sources.yaml (desk: world, with place)
  -> ingest, enrich                      shared with 2DayAI
  -> cluster world   stages/cluster.ts   WORLD_PER_SOURCE (15) newest articles per source, newest first across sources,
                                         in batches of at most WORLD_CLUSTER_BATCH (300): cluster-world.v4 per batch
                                         (parseMany, ids batch-1, batch-2, ...), a topic per event.
                                         More than one batch: one merge call (cluster-world-merge.v2) names batch
                                         events that are the same story; code checks the keys and joins them.
                                         Then a second merge call (cluster-world-merge-top) over the events of
                                         importance 3 or more only (decision 108). Events with no city that happened
                                         in another country than the outlet's are marked abroad (decision 107).
  -> explain         stages/explain.ts   world events of importance 3 or more, at most WORLD_EXPLAIN_MAX (25).
                                         every sentence's quoted passage checked against the article text
  -> telegram        stages/telegram.ts  score each event (telegram-score.v1, scoreProblems) TELEGRAM_SCORE_RUNS
                                         times and keep the middle (medianScores, decision 36), dayBand in code,
                                         word from MOOD_WORDS[band] (telegram-word.v1, wordProblems). Decision 26.
  -> local           stages/local.ts     no model. GDELT articles about every town it tags, placed by
                                         Gazetteer.loadWithTowns().locate(nearest): the city list plus GeoNames'
                                         places of 500 or more (data/towns.txt), same name within 30 km of
                                         GDELT's point, else its point only within 20 km of a listed place. A town within 3 km (OUTLET_KM) of an outlet story's place is
                                         skipped. pickLocal: the newest GDELT_PER_TOWN (2) of each town, every
                                         town's newest before any town's second, GDELT_MAX (80000) a day as a
                                         safety valve. Own table local_stories; a GDELT outage costs only these.
                                         Decisions 54, 67, 78. `stage -- refresh` (refresh.yml, every three hours
                                         and after each daily run) reads the last 24 hours (rollingWindow) into the
                                         latest map's date instead, run recorded as "refresh". Decision 80.
                                         With --outlets it also ingests the day under way and runs cluster world
                                         with onlyNew (new articles only, no merges, nothing deleted), and
                                         withTodayStories adds them to the published file. Decision 130.
  -> loadMapView     db/src/map.ts       the whole day. splitLocal (core) cuts it into the site's file and 10-degree
                                         tiles of local stories; map export writes both, the daily run stores both
                                         in R2 (latest.json, <date>.json, local/<date>/<tile>.json), and the Worker
                                         streams them. With no stored file the Worker builds the file with
                                         loadMapView(..., { local: "index" }) and a tile with loadLocalTile.
```

Every stage records a row in `runs` with its report or error. Read those first.

## Offline (no feeds, no key)

```
npm run check          # includes packages/pipeline/src/world.test.ts and packages/web/src/index.test.ts
npm run map:sample     # the fictional world fixture through every real stage, in memory
```

The fixture is `packages/pipeline/src/fixtures/world.ts`: invented outlets pinned to real cities, invented places, and scripted model answers (`worldAnswers`). Add a story there to reproduce a case. Keep it fictional. `packages/pipeline/src/fixtures/gdelt.ts` is the day's GDELT file: invented local sites and headlines about real towns, in the GKG layout (`gkgRow`). `packages/pipeline/scripts/synthetic-day.ts` makes a day of tens of thousands of local stories to measure speed and file sizes (decision 78).

## With a database

```
npm run stage -- cluster world --date 2026-09-27
npm run stage -- explain --date 2026-09-27
npm run stage -- telegram --date 2026-09-27
npm run stage -- map export --date 2026-09-27 --out /tmp/map.json
```

## Debugging checklist

- **No word today:** `runs` for stage `telegram`. `reason: no explained world events` means nothing had a usable explanation. Check `cluster-world`, then the `usable` count in `explain`. `reason: every score run broke the rules` or a `telegram-word` reason names the rule the model broke twice; `rejected` counts score runs set aside (decision 51). A thrown error is an outage or the spend ceiling, not a broken rule.
- **Why this word:** the `telegram_scores` rows hold every score (the middle of the runs) and its reason. The run report's `split` counts events the runs disagreed on. `dayBand` in core turns them into the band. The worst significant (importance 3+) negative score sets a bad day by design.
- **Rejected answers:** code enforces these rules: every event scored once with a copied sentence, a word from `MOOD_WORDS[band]`, and on a bad day the setting event listed. Fix the prompt (new version file) before touching the rules, and never loosen them without Davis.
- **Place empty or missing:** the source has no `place`, its feed failed at ingest, or its articles fall outside the run date's window, midnight to midnight in New York (decision 127).
- **A town has no local stories:** the `local` run report has `articles` (placed away from outlet places), `townsTagged` (towns GDELT's articles were placed at), `townsNearOutlet` (of those, at an outlet story's place), `towns` (with a story), `stories` and `overMax` (cut by `GDELT_MAX`, which should stay 0 on a normal day). A town within 3 km of a place with an outlet's story gets none by design. A GDELT town is dropped when no listed city or GeoNames town of that name is within 30 km of GDELT's point and no listed city or town of its country is within 20 km (`NEAR_KM`), or when the nearest listed place within 300 km has no country. The grouping model's towns use the same lists: by name in the named country, nearest the model's point within 50 km, ambiguous shared names left at the outlet, and the model's own point only within 20 km of a listed place (`Gazetteer.locate`). The town list is `npm run towns:build` (pinned GeoNames copy, never fetched in tests).
- **Local stories missing on the site:** they load only at the closest zoom, from tiles. The day's file lists them under `local.tiles`; check `/data/local/<date>/<tile>.json` answers (a 404 means neither R2 nor the database has that tile) and that the "Store the map for the site" step stored `local/<date>/` in the bucket.
- **Coverage:** `npm run stage -- coverage --date <date>` prints towns with a story out of every listed town, countries and regions with one, and every country and territory with none. The daily summary has the same line.
- **Event not explained:** it is below importance 3, or it fell below the cap. Raise `WORLD_EXPLAIN_MAX` only with the spend ceiling in mind.
- **Cluster world failed:** the error names each failed batch. Nothing is written, and the date keeps the events it had.
- **One story shows as two events:** the merge call did not group them, or code dropped the group. The `cluster-world` run report has `batches`, `merged`, `mergeDropped` and `mergedTop` (the second pass over events of importance 3 or more, decision 108). A group is dropped when a key is unknown, a key is in two groups, or it has fewer than two events.
- **A story shows at its outlet's city though it happened elsewhere:** the model named no city that checks out. If it named another country than the outlet's, the article is marked `abroad` and listed under "on events elsewhere" (decision 107); the run report counts them as `abroad`. `event_articles.abroad` holds the mark.
- **A feed keeps failing or is paused:** the daily run's summary page lists it with its streak. `sources.fail_streak` and `last_ok_at` hold the state; after 7 failed days it is only tried on Sundays (decision 36).
- **Stale word after a re-run:** `cluster world` deletes the date's telegram. Run `telegram` again.

## Choosing or changing the model

The provider and model are config (decision 28, `packages/pipeline/src/config.ts`). `npm run stage -- eval --setups "..."` runs setups side by side on one saved day. `--fixture --fake` shows the report with no key or network. Before recommending a model, read the report's scores and reasons, not only the cost column. Procedure: docs/RUNBOOK.md, "Choose a model".

Any change to selection, topics or the word rules needs a test in `packages/pipeline/src/world.test.ts` and a pass through the `neutrality-review` skill.
