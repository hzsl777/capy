# GlobalGist (the map): agent guide

The map, published as GlobalGist, is one of two products in capy. The other is 2DayAI (see the root AGENTS.md and CONTEXT.md). GlobalGist is the public site. It puts world news on a map by where it is published, in the spirit of Radio Garden. One word heads it: the emotion the day's world reporting evokes, on a scored scale from Grave to Good.

On open, the map or globe turns until a place lands under the small reticle in the middle; drag to turn it yourself. The place under the reticle is "tuned", and the side panel lists what its outlets reported. Opening the word shows:

- the scale and the events that shaped the day
- every event's score with the sentence it rests on
- each event's explanation with numbered citations
- the sources with the passages quoted

The data comes from the shared pipeline (decision 25): world-desk sources in `config/sources.yaml`, the `cluster world`, `explain` and `telegram` stages, and the `loadMapView` read model in `packages/db`. The Worker (`packages/web`) serves this site's build and its data at `/data/latest.json`. This package holds the site only.

## Neutrality rules (hard rules)

The site is public and covers contested places. These rules apply to every change. Run the `neutrality-review` skill before finishing any change to the UI, the basemap, the telegram, or how world events are chosen.

1. **No political geography.** The basemap has land, coastlines, lakes, rivers, relief and ice. No borders, no disputed-area lines, no country fills, no country names anywhere in the UI. Never add a Natural Earth `admin_*` or `boundary_*` layer.
2. **No labels on the map, and pins are publishers.** The map shows dots only, one per city that outlets publish from. A place name appears only in the panel. Nothing is geocoded from article text.
3. **No ranking of headlines.** Lists are newest first. Dot size reflects report count and nothing else. The one exception is zoom (decision 30): zoomed out, a place shows only when one of its stories was reported from three or more places or rated 4 or 5 by the model; zooming in shows the rest (`tierOf` in `src/data.ts`). That decides visibility only, never order, size or colour. Nearby places merge into one dot that lists every city by name, never a region. The "fresh" colour means "reported in the last hour". The mood score is the only sentiment signal. It never orders headlines or changes how a pin looks, and the site always shows every score with its reason.
4. **No unverified text.** Headlines appear as published. Generated text appears in two places only, both built from sentences checked against the sources and both labelled as written by AI: the telegram (the word, the event scores and one line per event) and event explanations. Translation is on-device, opt-in, and marked "Translated from X".
5. **A formula sets the word, and code checks it** (decision 26, `packages/core/src/world.ts`). Scores are outcomes for people, never which side gained. Each score quotes a verified sentence (`scoreProblems`). `dayBand` lets the worst significant event set a bad day, so good news never averages a tragedy away. The word must come from the band's fixed list, and a bad day must name the event that set it (`wordProblems`). Never loosen these checks to get a word out. A day without a word is acceptable.
6. **Balance by curation and caps.** The world source list is kept balanced across regions and never adds one side of a conflict without the other. `cluster world` keeps at most `WORLD_PER_SOURCE` (default 15) articles per source per day.
7. **No full article text on the site.** The panel shows the outlet's own feed summary (at most 300 characters). Explanations quote short passages as citations. Article text fetched for verification (decision 16) is never published whole.
8. **Neutral copy.** UI text is plain and descriptive. No adjectives about events or places. No em dashes in UI copy or docs.

## Layout

Paths are relative to `packages/map/`.

```
index.html               page shell, toolbar, telegram strip, about dialog
src/
  brand.ts               the site name and tagline, used by every design
  main.ts                app state and all rendering: masthead, toolbar, telegram, panel views, timebar, ticker
  types.ts               re-exports MapFile and friends from @2dayai/core (type-only) plus the topic list
  data.ts                load + filter + formatting helpers (unit tested)
  themes.ts              canvas colours per design; CSS tokens live in style.css
  map/view.ts            canvas map: projections, drag/zoom/pinch, tuning, highlights, drawing
  map/basemap.ts         loads the TopoJSON basemap
  translate.ts           browser Translator API wrapper
  pins.ts                localStorage pins and prefs
  ui/dom.ts              element builder (text only, never innerHTML)
  style.css              five designs over one layout
public/
  basemap/               Natural Earth physical layers (built by scripts/build-basemap.ts, committed)
  data/sample.json       fictional sample made by `npm run map:sample` (committed)
scripts/
  build-basemap.ts       Natural Earth -> public/basemap/*.json
  screenshots.ts         every design x view, the reader, the telegram and an explanation into docs/map/screenshots
test/                    vitest
```

## Commands

Run from the repository root:

```
npm install
npm run map:sample       fictional world day through the real stages, in memory, into public/data/sample.json
npm run map:dev          dev server on the sample (http://localhost:5173)
npm run check            boundaries, typecheck and tests for every package, including the map
npm run map:build        typecheck + production build into packages/map/dist/
npm run map:basemap      rebuild the basemap (needs raw.githubusercontent.com)
npm run map:build && npm run map:screenshots
npm run web:deploy       build and deploy with the Worker (needs Cloudflare credentials)
```

To look at a real day locally: `npm run stage -- map export --out packages/map/public/data/latest.json` with `DATABASE_URL` set, then `npm run map:dev`. `latest.json` is gitignored.

Before pushing: `npm run check && npm run map:build`.

## Data contract

`MapFile` in `packages/core/src/map.ts`, built by `loadMapView` in `packages/db/src/map.ts`. Change the type first, then the read model, then the site. The site imports core with `import type` only, so nothing from core (zod included) is bundled. Times are unix seconds. The site measures time windows from `generatedAt`. `source: "sample"` shows the sample-data banner. `web:deploy` removes `sample.json` from the build so the public site can never fall back to it.

## Designs

Five looks (decision 32), each in Map or Globe view, chosen from one Design menu:

- **Morning Edition**: newsprint, black ink, halftone land, blackletter masthead and word. Map by default.
- **Cabinet Map**: parchment, sepia ink, engraved water lines, hachured mountains, one red for fresh reports and the word. Map by default.
- **Wire Room**: phosphor green on black, dot-matrix land, VT323 masthead, scanlines, scrolling ticker. Globe by default.
- **Ops Room**: a slate situation display with one cyan, condensed sans-serif, a plotting grid. Map by default. It borrows the look of operations software, never its friend-or-foe colours or symbols.
- **Blueprint**: cobalt drafting sheet, white linework, hand lettering, orange for fresh reports. Map by default.

The globe is shaded as a lit sphere (`shade`, `atmosphere` in the theme). The printed designs frame the map with a double neatline (`neatline`).

A theme is two things kept in step: a `Theme` in `src/themes.ts` (canvas) and a `:root[data-theme=...]` block in `src/style.css` (chrome and fonts). Fonts are self-hosted through `@fontsource`. See the `design-themes` skill. Anything decorative around the word must not change how it reads (a "STOP" suffix was removed because "Ceasefire stop" reads as a statement).

## Conventions

- TypeScript, ES modules, no framework. Keep dependencies small.
- Third-party text (headlines, summaries, outlet names, quoted passages) goes into the DOM as text via `h()`. URLs go through `safeUrl()`.
- Comments explain why, not what.
