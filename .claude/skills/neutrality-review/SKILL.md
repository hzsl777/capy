---
name: neutrality-review
description: Review a change to Capy's UI, copy, basemap or story-selection logic against the project's neutrality rules (no borders, no country names, no ranking, no rewriting, balanced outlets, no full article text). Use before finishing any such change, and whenever someone asks whether something is neutral or could be controversial.
---

# Neutrality review

Capy is public and shows news from contested places. Go through each check against the diff (`git diff` against the base branch) and the running app. Report each as pass, fail, or not applicable, with the file and line for any failure. Fix failures before finishing.

## Map
- [ ] No political boundary data added: search for `admin_`, `boundary`, `countries`, `disputed` in `scripts/` and `public/basemap/`.
- [ ] The basemap build still strips every property except the river rank (`strip()` in `scripts/build-basemap.ts`).
- [ ] Nothing draws text on the canvas (`fillText`/`strokeText` in `src/map/`).
- [ ] Dot size depends only on report count. Dot colour depends only on "reported in the last hour".
- [ ] No red or warning colour tied to conflict topics. Topics never change how a dot looks.

## Panel and copy
- [ ] Place names use `Place.name` only, with no country appended.
- [ ] Lists are newest first. No new sort key.
- [ ] Headlines are shown as published. Any translation is labelled "Translated from X" and is opt-in.
- [ ] No generated text about a story, place or outlet (summaries, labels like "breaking" or "developing", sentiment).
- [ ] New UI copy is descriptive and plain: no adjectives about events, places or groups, no em dashes.
- [ ] Topic names stay neutral nouns ("Conflict & security", not loaded terms).

## Pipeline
- [ ] Balance caps in `pipeline/balance.ts` are not loosened without the owner's say-so.
- [ ] No new ranking signal (tone, shares, source "authority") feeds selection or order.
- [ ] Country-only articles are still dropped (`choosePlace` in `pipeline/place.ts`).
- [ ] `enrich.ts` still stores only preview metadata, honours robots.txt, and never stores article body text.
- [ ] New outlets in `sources.json` went through `add-news-source`, and the list isn't tilting toward one region or language.

## Output
A short table of checks and results, then any fixes you made. If a check needs a judgement call (e.g. a topic name), say what you chose and why, and flag it for the owner.
