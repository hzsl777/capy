---
name: neutrality-review
description: Review a change to GlobalGist's map UI, copy, basemap, world sources, the one-word mood telegram (scores, scale, word lists) or how world events are chosen against the project's neutrality rules (no borders, no country names, no ranking of headlines, no unverified text, a checked word, balanced outlets, no full article text). Use before finishing any such change, and whenever someone asks whether something is neutral or could be controversial.
---

# Neutrality review

Paths in this skill are relative to `packages/map/`. Run npm scripts from the repository root.

GlobalGist is public and shows news from contested places. Go through each check against the diff (`git diff` against the base branch, limited to `packages/map/`) and the running app. Report each as pass, fail, or not applicable, with the file and line for any failure. Fix failures before finishing.

## Map
- [ ] No political boundary data added: search for `admin_`, `boundary`, `countries`, `disputed` in `scripts/` and `public/basemap/`.
- [ ] The basemap build still strips every property except the river rank (`strip()` in `packages/map/scripts/build-basemap.ts`).
- [ ] Nothing draws text on the canvas (`fillText`/`strokeText` in `src/map/`).
- [ ] Dot size depends only on report count. Dot colour depends only on "reported in the last hour".
- [ ] Zoom decides visibility only by the rule in decision 30 (`tierOf` in `src/data.ts`): reach of three places or importance 4 or 5 at the widest zoom. No other signal decides which places show.
- [ ] A merged dot lists its cities by name and never names a region.
- [ ] No red or warning colour tied to conflict topics. Topics never change how a dot looks.

## Panel and copy
- [ ] Place names use `Place.name` only, with no country appended.
- [ ] Lists are newest first. No new sort key.
- [ ] Headlines are shown as published. Any translation is labelled "Translated from X" and is opt-in.
- [ ] Generated text appears only in the telegram (word, scores, lines) and event explanations, all built from verified sentences and labelled as written by AI. No other summaries, no labels like "breaking" or "developing", no sentiment.
- [ ] Nothing decorative around the word changes how it reads (no suffixes, no icons that imply a verdict).
- [ ] New UI copy is descriptive and plain: no adjectives about events, places or groups, no em dashes.
- [ ] Topic names stay neutral nouns ("Conflict & security", not loaded terms).

## Pipeline
- [ ] `dayBand`, `scoreProblems`, `wordProblems` and `MOOD_WORDS` in `packages/core/src/world.ts` are not loosened or edited without a decision. The worst significant event still sets a bad day. A day without a word is acceptable.
- [ ] The scoring prompt still scores outcomes for people, never which side gained, and the word prompt still asks for breadth and forbids verdicts.
- [ ] The mood score never orders headlines or changes how a pin looks, and every score is shown with its reason.
- [ ] No new ranking signal (tone, shares, source "authority") orders headlines. Stories are placed only by the checked city lookup (`packages/pipeline/src/places.ts`, decision 44), never at a country or region, and each report still names its outlet's city.
- [ ] The site shows only feed summaries (at most 300 characters) and quoted citation passages, never article text.
- [ ] New outlets in `config/sources.yaml` went through `add-news-source`, and the world list isn't tilting toward one region, language or side.

## Output
A short table of checks and results, then any fixes you made. If a check needs a judgement call (e.g. a topic name), say what you chose and why, and flag it for the owner.
