---
name: ingest-pipeline
description: Run, debug or change Capy's news ingest pipeline (GDELT GKG download and parsing, place selection, topics, balance, story grouping, preview enrichment, output file). Use for questions like "why is this story on the wrong spot", "why is a place empty", "ingest failed in CI", or changes to how articles are picked.
---

# Ingest pipeline

This is the map prototype's stand-in pipeline. Decision 24 retires it when the map moves onto the shared 2DayAI pipeline; fix it, but don't grow it.

Paths in this skill are relative to `packages/map/`. Run npm scripts from the repository root.

`pipeline/ingest.ts` runs hourly in `.github/workflows/deploy.yml`:

```
GDELT GKG 2.1 (English + translingual, every 15 min)  +  RSS (pipeline/sources.json)
  -> parseGkgLine        gkg.ts     title from <PAGE_TITLE>, language from srclc:
  -> choosePlace         place.ts   earliest city mention, else province; country-only dropped
  -> classify            topics.ts  URL section first, else the two strongest GKG themes
  -> prune               ingest.ts  24h rolling pool, 80 per place
  -> balance             balance.ts newest first, outlets take turns, per-outlet caps
  -> cluster             cluster.ts shared rare people/orgs across places -> story id
  -> enrich              enrich.ts  og:description/og:image + framing check, cached by URL
  -> public/data/latest.json
```

State lives in `$CAPY_STATE_DIR` (default `.cache/ingest`): `state.json` (last GDELT stamp per feed), `pool.json`, `meta.json` (preview cache). CI carries it with actions/cache. Delete the directory for a cold start, which fetches the last `CAPY_COLD_START_FILES` (default 16, four hours) of files.

## Offline (no GDELT access)

Cloud sessions often can't reach `data.gdeltproject.org`. Use the fixture:

```
CAPY_STATE_DIR=/tmp/capy-state npm run map:ingest -- --fixture test/fixtures/gkg-sample.csv --out /tmp/out.json
```

To build a new fixture row, use `gkgRow()` in `test/helpers.ts`. The GKG 2.1 column indexes are in `COL` in `pipeline/gkg.ts`. Location blocks are `type#name#country#adm1#adm2#lat#lon#featureId#offset`, where type 3/4 is a city and 2/5 a province.

## Debugging checklist

- **Wrong spot:** find the row's V2ENHANCEDLOCATIONS. The earliest city wins. If a story names a far-off city before its dateline, that's the heuristic's known weakness; don't special-case one story.
- **Place empty or thin:** check balance caps and whether the articles were country-only.
- **One outlet everywhere:** check `perDomainGlobal` and whether the outlet uses several hostnames.
- **Huge story groups:** common entities should be filtered by `maxDf` in `cluster.ts`; check the entity lists.
- **CI ingest failed:** the job fails when GDELT returns nothing, and the previous deployment stays live. Read the `[gdelt]` log lines first.

Any change to selection or ordering needs a unit test in `test/pipeline.test.ts` and a pass through the `neutrality-review` skill.
