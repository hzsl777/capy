# GlobalGist (the map): agent guide

The map, published as GlobalGist, is one of two products in capy. The other is 2DayAI (see the root AGENTS.md and CONTEXT.md). GlobalGist is the public site. It puts world news on a map by where it happens (decision 44), in the spirit of Radio Garden. One word heads it: the emotion the day's world reporting evokes, on a scored scale from Severe harm to Resolution (decision 59).

On open, the map or globe turns until a place lands under the small reticle in the middle; drag to turn it yourself. The place under the reticle is "tuned", and the side panel lists what its outlets reported. Opening the word shows:

- the scale and the events that shaped the day
- every event's score with the sentence it rests on
- each event's explanation with numbered citations
- the sources with the passages quoted

The data comes from the shared pipeline (decision 25): world-desk sources in `config/sources.yaml`, the `cluster world`, `explain` and `telegram` stages, and the `loadMapView` read model in `packages/db`. The Worker (`packages/web`) serves this site's build and its data at `/data/latest.json`. This package holds the site only.

## Neutrality rules (hard rules)

The site is public and covers contested places. These rules apply to every change. Run the `neutrality-review` skill before finishing any change to the UI, the basemap, the telegram, or how world events are chosen.

1. **No political geography.** The basemap has land, coastlines, lakes, rivers, relief and ice. No borders, no disputed-area lines, no country fills, no country names anywhere in the UI. Never add a Natural Earth `admin_*` or `boundary_*` layer.
2. **No labels on the map, and a story sits where it happened, checked** (decision 44). The map shows dots only, one per city. A place name appears only in the panel, never with a country. The grouping model names the city where an event happened; code places it only when that city is on the fixed city list (`packages/pipeline/data/places.json`, from Natural Earth) or lies within 250 km of a listed city in the country the model named. Anything else, including a story that names only a country or a region, stays at its outlet's city. Nothing places a story at a country or region, and every report shows its outlet's own city. The one other source of places is GDELT's city tag on local stories (rule 6): a town on the list, or within 250 km of a listed city in its country, and nothing coarser.
3. **Lists are never ranked; the map is, openly** (decisions 30 and 46). Lists are newest first. The map ranks places by the grouping model's 1 to 5 importance and by how many outlet cities reported a story, and only in two ways: which places show at each zoom (`tierOf` in `src/data.ts`, five tiers from importance 4 or 5, or four outlet cities, at the whole world down to everything when zoomed in), and each dot's symbol and size (`weightOf`, the place's most important story, sets the symbol: hollow for 1 and GDELT stories, filled for 2 and 3, ringed for 4 and 5, decision 57; the report count sets the size). The Key button on the map opens a panel beside it that explains the symbols; marker shape (circle, square, diamond) is part of a design and carries no meaning. Nearby places merge into one dot that lists every city by name, never a region. The "fresh" colour means "reported in the last hour" and nothing else. The mood score is the only sentiment signal. It never orders headlines or changes how a pin looks, and the site always shows every score with its reason.
4. **No unverified text.** Headlines appear as published. Generated text appears in two places only, both built from sentences checked against the sources and both labelled as written by AI: the telegram (the word, the event scores and one line per event) and event explanations. Translation is on-device, opt-in, and marked "Translated from X".
5. **A formula sets the word, and code checks it** (decision 26, `packages/core/src/world.ts`). Scores are outcomes for people, never which side gained. Each score quotes a verified sentence (`scoreProblems`). `dayBand` lets the worst significant event set a bad day, so good news never averages a tragedy away. The word must come from the band's fixed list, and a bad day must name the event that set it (`wordProblems`). Never loosen these checks to get a word out. A day without a word is acceptable.
6. **Balance by curation and caps.** The world source list is kept balanced across regions and never adds one side of a conflict without the other. `cluster world` keeps at most `WORLD_PER_SOURCE` (default 15) articles per source per day. A region no listed outlet reached that day gets at most `GDELT_PER_REGION` (default 3) of the newest local stories from the GDELT index (decision 54): no model reads them, they sit at the lowest zoom tier, and each says "via GDELT". A listed outlet in a region always replaces them; outlet research continues so GDELT fills less over time.
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
  map/terrain.ts         Polygon Kingdom's triangle terrain, built once per basemap
  map/decor.ts           decorations under the dots: Pirate sea creatures, Candy Shop sweets, Space stars and rim (fixed ocean spots, tested)
  translate.ts           browser Translator API wrapper
  pins.ts                localStorage pins and prefs
  ui/dom.ts              element builder (text only, never innerHTML)
  style.css              twenty designs over one layout
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

`MapFile` in `packages/core/src/map.ts`, built by `loadMapView` in `packages/db/src/map.ts`. Change the type first, then the read model, then the site. The site imports core with `import type` only, so nothing from core (zod included) is bundled. Times are unix seconds. The site measures time windows from `generatedAt`. `source: "sample"` (the fictional day) and `"demo"` (headlines gathered outside the daily run) show a one-line banner. `"live"` never does. `web:deploy` removes `sample.json` from the build so the public site can never fall back to it.

## Designs

Twenty looks (decisions 32, 43 and 57 to 62), each in Map or Globe view, chosen from one Design menu:

- **Morning Edition**: newsprint, black ink, halftone land, blackletter masthead and word. Map by default.
- **Cabinet Map**: parchment, sepia ink, engraved water lines, hachured mountains, one red for fresh reports and the word. Map by default.
- **Wire Room**: phosphor green on black, dot-matrix land, VT323 masthead, scanlines, scrolling ticker. Globe by default.
- **Ops Room**: a slate situation display with one cyan, condensed sans-serif, a plotting grid. Map by default. It borrows the look of operations software, never its friend-or-foe colours or symbols.
- **Blueprint**: cobalt drafting sheet, white linework, hand lettering, orange for fresh reports. Map by default.
- **Pirate**: an old sea chart. Parchment land on sea-green water, sepia ink, dashed rhumb lines, a compass rose, rope and dashed rules in the chrome, a Pirata One masthead and word, red for fresh reports. Small ink sea creatures (serpents, a kraken, whales) sit at fixed spots in open ocean. Map by default.
- **Space**: the globe as a planet against a static starfield, dark land with a faint city-lights texture, a thin atmosphere rim, Space Grotesk and IBM Plex Mono, amber for fresh reports. The flat map is a star chart, with faint four-point stars in open ocean. Globe by default.
- **Candy Shop**: pink land on sky-blue water, white water lines, rounded pill-shaped chrome, sprinkles and a candy-stripe masthead, Fredoka and Nunito, magenta for fresh reports, sweets at the creature spots. Map by default. Formerly Cotton Candy; `cotton` still opens it.
- **Stage Select** (`bit8`): after the side-scrolling action games of the 8-bit era. Hard pixels at a third of the resolution, land built from bevelled metal blocks on a tiled sea, square markers, riveted panels, a strip of blocks under the masthead, Press Start 2P, the scale drawn as an energy bar. Map by default.
- **Overworld** (`bit16`): after the world maps of 16-bit role-playing games. Half resolution, pixel grass, sandy shores and lighter shallows, glinting water, blue gradient windows with white frames and a menu pointer, Pixelify Sans and DotGothic16, gold for fresh reports. Map by default.
- **Polygon Kingdom** (`bit64`): an overworld after Super Mario 64 and Ocarina of Time (decision 61). Land as a grid of flat-shaded triangles with heights, spiky mountains in rock and snow, orange cliff walls (`lowPoly`, `src/map/terrain.ts`), a soft half-resolution picture, a 22-sided globe fading into haze, coins for markers and red coins for fresh reports, outlined counter lettering (Luckiest Guy) over a sky, dark see-through message boxes, raised gold buttons. No lakes, rivers or islands smaller than a triangle. Globe by default.
- **Realize**: direct inspiration from the Mezmerize and Hypnotize covers. Black ground, dark red smeared land, bone-white coasts and markers, blue for fresh reports, the striped arcs across the top, worn white Anton capitals over a red Permanent Marker word. Map by default.
- **Newsroom**: a television news studio. The world on a glowing LED wall, glossy navy panels, the word as a white caption bar under a red tab, Oswald and Barlow, red for fresh reports, a crawl of the newest headlines. No "live" or "breaking" labels. Globe by default.
- **Lily Pond**: murky green water rippling around every shore, lily-pad land and panels, Chewy, lotus pink for fresh reports. Map by default.
- **Honeycomb**: after the feel of Bee Movie. Honey land in hexagon cells over a dark hive, hexagon markers, black and yellow stripes, Baloo 2, white for fresh reports. Map by default.
- **Arcana**: a tarot card. Midnight indigo, gold linework and stars, card-framed panels, Cinzel Decorative and Lora, amber for fresh reports. Globe by default.
- **Arcadia**: a black-and-white engraving after Thomas Cole's The Course of Empire (public domain). Hatched land, ruled water, engraved mountains, a grey sky, a double frame, a compass, IM Fell English. Single-colour: fresh reports get a dotted ring. Map by default.
- **Nightcap**: a bedtime tea box. Watercolour periwinkle and sage, a moon and stars, Lora italic, a warm lamp colour for fresh reports. Globe by default.
- **Campus**: a college campus in maroon and cream. Maroon masthead, varsity lettering (Graduate), pennant buttons, gold for fresh reports. Map by default.
- **Lasso**: a frontier newspaper. Dusty tan and faded denim, rope rules, Rye and Special Elite, a compass, red for fresh reports. Map by default.

The console, Realize, Newsroom, Honeycomb, Nightcap, Campus and Lasso designs borrow a feel, never a game's or album's art, names or layouts, and the site names none of them. Settings (design, view, Translate, topics) are saved in the browser only (`src/pins.ts`).

The globe is shaded as a lit sphere (`shade`, `atmosphere` in the theme). The printed designs frame the map with a double neatline (`neatline`). A theme may set `decor` for drawings under the dots (`src/map/decor.ts`). Decorations are open ink strokes with no text, sit only at fixed open-ocean spots far from every outlet's city (checked against the basemap and `config/sources.yaml` by `test/decor.test.ts`), and never change a dot. Adding an outlet on a remote island can fail that test: move the decoration, not the outlet.

A theme is two things kept in step: a `Theme` in `src/themes.ts` (canvas) and a `:root[data-theme=...]` block in `src/style.css` (chrome and fonts). Fonts are self-hosted through `@fontsource`. See the `design-themes` skill. The word is the page's headline: centred in the masthead in every design, with its size set by its length so every word on the lists fits a phone, and always next to its date and the "Chosen by AI" label (decision 40). Anything decorative around the word must not change how it reads (a "STOP" suffix was removed because "Ceasefire stop" reads as a statement).

## Conventions

- TypeScript, ES modules, no framework. Keep dependencies small.
- Third-party text (headlines, summaries, outlet names, quoted passages) goes into the DOM as text via `h()`. URLs go through `safeUrl()`.
- Comments explain why, not what.
