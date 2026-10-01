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
- [ ] Dot symbol depends only on the place's most important story (`weightOf`: hollow, filled, ringed, decision 57) and dot size only on its report count. The Key matches what the canvas draws. Dot colour depends only on "reported in the last hour".
- [ ] Zoom decides visibility only by the tiers in `tierOf` (`src/data.ts`, decisions 30 and 46): importance and outlet-city reach. No other signal decides which places show.
- [ ] A merged dot lists its cities by name and never names a region.
- [ ] No red or warning colour tied to conflict topics. Topics never change how a dot looks.
- [ ] Designs that cut the world into shapes (Rose Window's glass pieces, Cross Stitch's cells, Honeycomb's hexagons, Polygon Kingdom's triangles, Night Drive's wire grid) cut them from longitude and latitude or a screen grid, the same over land and sea, and colour them by climate and relief only, never by any political unit. No patch of land is red. Textures and light laid over the map (Radar Sweep's speckle and beam, Film Noir's lamp and blinds, Arcade Cabinet's scanlines, Stadium Jumbotron's LED mesh) are the same over all land or fixed to the screen, never tied to a place.
- [ ] Designs with their own camera or moving light (Polygon Kingdom, Nightclub, Poolside, Snow Globe): places are drawn through the same camera as the land, a marker's size never changes with distance or animation, only light falls on the map (never a shape that reads as a mark, and no colour close to the fresh colour), and nothing flashes (no 10% swing in brightness within a third of a second, `test/scenes.test.ts`).
- [ ] Nothing drawn links one place to another except the reader's arcs: no route lines between cities (Sleeper Car's route lines are the Equator, tropics and polar circles, drawn under the land; its route bar has no named stops).
- [ ] Chrome built from a place's name (Spreadsheet's formula bar, `src/ui/extras.ts`) uses `Place.name` only, as text, and adds no judgement.
- [ ] Game-styled chrome measures the map and nothing else: Pin Drop's HUD (`src/ui/extras.ts`, decision 96) shows only the reticle's latitude and longitude and a scale bar, never a score, a round, or a distance to a place. Nothing decorative around the word labels it (no "special", "now showing" or "result").
- [ ] Designs that move on their own (Aquarium's fish, bubbles and water, Lava Lamp's wax; `src/map/ambient.ts`) never move, resize, cover or tint a marker, keep moving pictures in tested open water (`FISH`, `test/aquarium.test.ts`) or outside the map, never flash, and hold still for reduced motion.
- [ ] Screens and cameras (decision 75) read as what they are and nothing more: Radar Sweep has no friend-or-foe symbols, target boxes or tracks; Stadium Jumbotron has no scores, flags, or team, league or sponsor names or colours; Arcade Cabinet names no game and draws no game's characters. Motion never moves, resizes or hides a marker and stops for reduced motion.
- [ ] Things a design puts at sea (Pirate's creatures, the scenery pictures, Pop-up Book's pieces on sticks, Toy Train Set's tracks and trains, Chalkboard's and Sketchbook's doodles) sit only at tested spots clear of land and far from every place (`test/decor.test.ts`, `test/scenery.test.ts`, `test/handmade.test.ts`), carry no text, faces or flags, and never move or cover a marker.

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
- [ ] GDELT local stories (`packages/pipeline/src/stages/local.ts`, decisions 54, 67 and 78) add towns the outlets did not reach: none within 3 km of a place with an outlet's story, at most `GDELT_PER_TOWN` a town, every town's newest before any town's second, `GDELT_MAX` a day, chosen only by time and place (`pickLocal`), placed only from a city-level tag checked against the city list and GeoNames' places of 1,000 or more, never read by a model, shown only at the closest zoom, and labelled "via GDELT". GDELT's tone or theme fields never choose them.
- [ ] Tiles (decision 78) change when local stories load, never which show or how they look: the site loads the tiles in view only at the last zoom tier, a loaded story goes through `tierOf` and `weightOf` like any other, and a tile's places are GDELT's checked towns. The tile grid is longitude and latitude, never a political unit, and nothing on the site names a tile.
- [ ] The site shows only feed summaries (at most 300 characters) and quoted citation passages, never article text.
- [ ] New outlets in `config/sources.yaml` went through `add-news-source`, and the world list isn't tilting toward one region, language or side.
- [ ] An outlet on a side of an armed conflict or contested place carries `balance: { group, side }`, and its group has an outlet on every side (decision 90). A group with one side fails to load.

## Output
A short table of checks and results, then any fixes you made. If a check needs a judgement call (e.g. a topic name), say what you chose and why, and flag it for the owner.
