---
name: ingest-pipeline
description: Run, debug or change the world desk that feeds Capy's public map, covering world sources, cluster world with topics, which events get explained, the one-word conflict telegram and its checks, and the map read model (loadMapView, /data/latest.json). Use for questions like "why is there no word today", "why was the word rejected", "why is a place empty", "why is this event unexplained", or changes to how world events are chosen.
---

# The world desk

Paths are relative to the repository root.

The daily run (`npm run stage -- day`, `.github/workflows/daily.yml`) is one pipeline for both products (decision 25):

```
config/sources.yaml (desk: world, with place)
  -> ingest, enrich                      shared with 2DayAI
  -> cluster world   stages/cluster.ts   one model call, cluster-world.v1, a topic per event; 25 newest articles per source
  -> explain         stages/explain.ts   world events that are conflict or importance 4-5, at most WORLD_EXPLAIN_MAX (25);
                                         every sentence's quoted passage checked against the article text
  -> telegram        stages/telegram.ts  one word + 1 to 5 conflict events, telegram.v1; wordViolations in core/src/world.ts
  -> loadMapView     db/src/map.ts       what the Worker serves at /data/latest.json
```

Every stage records a row in `runs` with its report or error. Read those first.

## Offline (no feeds, no key)

```
npm run check          # includes packages/pipeline/src/world.test.ts and packages/web/src/index.test.ts
npm run map:sample     # the fictional world fixture through every real stage, in memory
```

The fixture is `packages/pipeline/src/fixtures/world.ts`: invented outlets pinned to real cities, invented places, and scripted model answers (`worldAnswers`). Add a story there to reproduce a case; keep it fictional.

## With a database

```
npm run stage -- cluster world --date 2026-09-27
npm run stage -- explain --date 2026-09-27
npm run stage -- telegram --date 2026-09-27
npm run stage -- map export --date 2026-09-27 --out /tmp/map.json
```

## Debugging checklist

- **No word today:** `runs` for stage `telegram`. `reason: no verified conflict reporting` means no conflict event had a usable explanation; check `cluster-world`'s `byTopic` and `explain`'s `usable`. A thrown error lists the rule the word broke twice.
- **Word rejected:** the rules are code, not prompt: one word, present in the chosen events' verified sentences, not a proper noun there, not in `CONTESTED_WORDS`. Fix the prompt (new version file) before touching the rules, and never loosen them without Davis.
- **Place empty or missing:** the source has no `place`, its feed failed at ingest, or its articles fall outside the 24-hour window ending 09:00 UTC.
- **Event not explained:** it is neither conflict nor importance 4-5, or it fell below the cap. Raise `WORLD_EXPLAIN_MAX` only with the spend ceiling in mind.
- **Stale word after a re-run:** `cluster world` deletes the date's telegram; run `telegram` again.

Any change to selection, topics or the word rules needs a test in `packages/pipeline/src/world.test.ts` and a pass through the `neutrality-review` skill.
