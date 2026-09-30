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
2. **No labels on the map, and a story sits where it happened, checked** (decision 44). The map shows dots only, one per city. A place name appears only in the panel, never with a country. The grouping model names the city where an event happened; code places it only when that city is on the fixed city list (`packages/pipeline/data/places.json`, from Natural Earth) or lies within 250 km of a listed city in the country the model named. Anything else, including a story that names only a country or a region, stays at its outlet's city. Nothing places a story at a country or region, and every report shows its outlet's own city. The one other source of places is GDELT's city tag on local stories (rule 6): a town on the list or on GeoNames' list of towns of 5,000 people or more (`packages/pipeline/data/towns.json`, CC BY 4.0, credited in the About dialog, decision 67) with the same name within 30 km of GDELT's point, or else GDELT's own town within 250 km of a listed city in its country, and nothing coarser. The town list never places the grouping model's stories.
3. **Lists are never ranked; the map is, openly** (decisions 30 and 46). Lists are newest first. The map ranks places by the grouping model's 1 to 5 importance and by how many outlet cities reported a story, and only in two ways: which places show at each zoom (`tierOf` in `src/data.ts`, five tiers from importance 4 or 5, or four outlet cities, at the whole world down to everything when zoomed in; GDELT's local stories, which no model rates, only in the last), and each dot's symbol and size (`weightOf`, the place's most important story, sets the symbol: hollow for 1 and GDELT stories, filled for 2 and 3, ringed for 4 and 5, decision 57; the report count sets the size). The Key button on the map opens a panel beside it that explains the symbols; marker shape (circle, square, diamond, bevelled disc, sewn button, hexagon, lily pad, four-, five- or six-point star, flower, gumdrop, shield, character block; `src/map/marks.ts`, decisions 72 and 74) is part of a design and carries no meaning. A marker's size never changes with a camera's distance. Nearby places merge into one dot that lists every city by name, never a region. The "fresh" colour means "reported in the last hour" and nothing else. The mood score is the only sentiment signal. It never orders headlines or changes how a pin looks, and the site always shows every score with its reason.
4. **No unverified text.** Headlines appear as published. Generated text appears in two places only, both built from sentences checked against the sources and both labelled as written by AI: the telegram (the word, the event scores and one line per event) and event explanations. Translation is on-device, opt-in, and marked "Translated from X".
5. **A formula sets the word, and code checks it** (decision 26, `packages/core/src/world.ts`). Scores are outcomes for people, never which side gained. Each score quotes a verified sentence (`scoreProblems`). `dayBand` lets the worst significant event set a bad day, so good news never averages a tragedy away. The word must come from the band's fixed list, and a bad day must name the event that set it (`wordProblems`). Never loosen these checks to get a word out. A day without a word is acceptable.
6. **Balance by curation and caps.** The world source list is kept balanced across regions and never adds one side of a conflict without the other. `cluster world` keeps at most `WORLD_PER_SOURCE` (default 15) articles per source per day. Local stories from the GDELT index (decisions 54 and 67) add towns the outlets did not reach: at most `GDELT_PER_REGION` (default 6) in a region no listed outlet reached that day, `GDELT_PER_REACHED_REGION` (default 3) in a region one did, and `GDELT_MAX` (default 8,000) in all. Within a region each town's newest story comes before any town's second; over the day's limit, every region's first stories come before any region's later ones. Time and place decide, never GDELT's tone or themes. No model reads them, they sit at the lowest zoom tier, and each says "via GDELT". A town within 25 km of a place with an outlet's story gets none, so an outlet's city keeps its outlets' stories alone; outlet research continues so GDELT fills less over time.
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
  map/surface.ts         what the designs that draw land and sea their own way share (the frame they are handed)
  map/neon.ts            Night Drive: the ruled sea, wire land, sunset and wire planet
  map/stitch.ts          Cross Stitch: X stitches on aida cloth, backstitched coasts, the embroidery hoop
  map/glass.ts           Rose Window: glass pieces cut from a fixed seed, lead lines, the stone tracery (unit tested)
  map/scenes.ts          Nightclub, Poolside and Snow Globe: mirror ball, dance floor, caustics, lens, snow (decision 71)
  map/sheet.ts           Spreadsheet: filled cells in a screen grid, the globe as a chart object (grid unit tested)
  map/terminal.ts        Market Terminal: the dot-matrix plot, coordinate grid and ticks, the vector globe in its bezel
  map/club.ts            Country Club: embroidery on oxford cloth, the leather desk globe on its brass stand
  map/rail.ts            Sleeper Car: the view from a train window, fields, hills, the embankment with poles
  map/decor.ts           decorations under the dots: Pirate sea creatures, Candy Shop sweets, Space stars and rim (fixed ocean spots, tested)
  map/scenery.ts         pictures that say what a design is: Frog Pond, Bedtime Tea, Arcadia, Lasso (open water sized to fit, tested)
  translate.ts           browser Translator API wrapper
  pins.ts                localStorage pins and prefs
  ui/dom.ts              element builder (text only, never innerHTML)
  ui/extras.ts           chrome some designs add around the map: formula bar and cell headers, terminal readout, crest, station clock
  style.css              twenty-three designs over one layout
public/
  basemap/               Natural Earth physical layers (built by scripts/build-basemap.ts, committed)
  data/sample.json       fictional sample made by `npm run map:sample`, with fictional GDELT local stories (committed)
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

Twenty-six looks (decisions 32, 43 and 57 to 72), each in Map or Globe view, chosen from one Design menu:

- **Morning Edition**: newsprint, black ink, halftone land, blackletter masthead and word. Map by default.
- **Cabinet Map**: parchment, sepia ink, engraved water lines, hachured mountains, one red for fresh reports and the word. Map by default.
- **Wire Room**: phosphor green on black, dot-matrix land, VT323 masthead, scanlines, scrolling ticker. Globe by default.
- **Ops Room**: a slate situation display with one cyan, condensed sans-serif, a plotting grid. Map by default. It borrows the look of operations software, never its friend-or-foe colours or symbols.
- **Blueprint**: cobalt drafting sheet, white linework, hand lettering, orange for fresh reports. Map by default.
- **Pirate**: an old sea chart. Parchment land on sea-green water, sepia ink, dashed rhumb lines, rope and dashed rules in the chrome, a Pirata One masthead and word, red for fresh reports. The sea is crowded like Olaus Magnus's Carta Marina (1539, decision 68): 25 engraved drawings at fixed open-ocean spots (sea serpents, krakens, spouting whales, sea hogs, winged sea dragons, great fish, turtles, a leviathan wrapped round a ship, galleons with no flags, whirlpools and compass roses with rhumb lines), sized by the open sea around each so they grow with zoom and never reach land, and short engraved wave marks over the open water, fixed to the world. Map by default.
- **Space**: the globe as a planet against a static starfield, dark land with a faint city-lights texture, a thin atmosphere rim, Space Grotesk and IBM Plex Mono, amber for fresh reports. The flat map is a star chart, with faint four-point stars in open ocean. Globe by default.
- **Candy Shop**: pink land on sky-blue water, white water lines, rounded pill-shaped chrome, sprinkles and a candy-stripe masthead, Fredoka and Nunito, magenta for fresh reports, sweets at five fixed ocean spots of their own. Map by default. Formerly Cotton Candy; `cotton` still opens it.
- **Stage Select** (`bit8`): after the side-scrolling action games of the 8-bit era. Hard pixels at a third of the resolution, land built from bevelled metal blocks on a tiled sea, square markers, riveted panels, a strip of blocks under the masthead, Press Start 2P, the scale drawn as an energy bar. Map by default.
- **Overworld** (`bit16`): after the world maps of 16-bit role-playing games. Half resolution, pixel grass, sandy shores and lighter shallows, glinting water, blue gradient windows with white frames and a menu pointer, Pixelify Sans and DotGothic16, gold for fresh reports. Map by default.
- **Polygon Kingdom** (`bit64`): an overworld after Super Mario 64 and Ocarina of Time, lettered after Rare's games of that era (decisions 63 to 66). Map view is a camera tilted back 58 degrees (`tilt`, decision 66) over triangle terrain (`lowPoly`, `src/map/terrain.ts`): grass on three flat tiers with orange cliff walls at every step, round trees (never in a cell with a place), rock mountains with snow caps, blue shallows, soft low-resolution textures tied to the world, a pale sky with clouds that pan (`sky`) and haze at the draw distance (`fog`). Bevelled gold markers float over round shadows; fresh reports are red-orange. Panels are pause-menu subscreens. Titan One lettering in yellow with a dark outline, each letter tilted and bobbing (`LETTER_THEMES` in `main.ts`); lumpy cream buttons. Every place stands on land (tested); lakes and rivers are not drawn. Map by default.
- **Realize**: direct inspiration from the Mezmerize and Hypnotize covers. Black ground, dark red smeared land, bone-white coasts and markers, blue for fresh reports, the striped arcs across the top, worn white Anton capitals over a red Permanent Marker word. Map by default.
- **Newsroom**: a television news studio. The world on a glowing LED wall, glossy navy panels, the word as a white caption bar under a red tab, Oswald and Barlow, red for fresh reports, a crawl of the newest headlines. No "live" or "breaking" labels. Globe by default.
- **Frog Pond** (`pond`): murky green water rippling around every shore, and in open water lily pads, lotus flowers, frogs sitting on pads and dragonflies (`scenery`, decision 69). A frog by the name, reeds at the page's edges, lily-pad panels and buttons, Chewy, lotus pink for fresh reports. Map by default.
- **Honeycomb**: after the feel of Bee Movie. Honey land in hexagon cells over a dark hive, hexagon markers, black and yellow stripes, Baloo 2, white for fresh reports. Map by default.
- **Tarot** (`arcana`): a tarot card. Midnight indigo, gold linework and stars, card-framed panels, Cinzel Decorative and Lora, amber for fresh reports. Globe by default.
- **Arcadia**: a painting after Thomas Cole's The Course of Empire (public domain, decision 69). A bay in evening light, olive land in loose strokes, and the paintings' landmarks in open water: the crag with its boulder, a lone column under vines, a temple on a rock, a broken arch, golden clouds. The map hangs in a gilt frame under Cole's sky on a museum wall; panels are wall cards and buttons are brass plaques. IM Fell English, vermilion for fresh reports. Map by default.
- **Bedtime Tea** (`nightcap`): a bedtime tea box. A night sea with small stars, sage land, and a bear in a nightcap asleep in a crescent moon (beside the globe, or over the open Pacific on the map; our own drawing, not a brand's). The map is the box's arched picture window; a teacup by the name, chamomile on the page, a tea bag's tag on the Key button, Lora italic, a warm lamp colour for fresh reports. Globe by default.
- **Campus**: a college campus in maroon and cream. Maroon masthead, varsity lettering (Graduate), pennant buttons, gold for fresh reports. Map by default.
- **Lasso**: a trick roper's frontier (decision 69). A denim sea with orange double stitching along every coast, tan leather land, a rope laid around the sheet or globe, and spinning rope loops over open water. The reticle is a rope loop spun flat. A hat hung on the name, rope-framed panels, stitched leather buttons, Rye and Special Elite, red for fresh reports. Map by default.
- **Night Drive** (`drive`): a 1980s night drive (decision 70, `src/map/neon.ts`). Map view is the tilted camera (`tilt` with `tiltEye`, `tiltFar` and `tiltMinZoom`) low over a black sea ruled by a glowing magenta grid of longitude and latitude, receding to a horizon under a striped setting sun and a purple-to-orange sky. Land is a dark plate in a cyan wire mesh with a glowing coast and low wire mountains from the relief layer. Globe view is a wireframe planet, its far side showing through faintly, with a glowing rim over the same sunset and a ruled floor. Kanit heavy italic in chrome lettering for the name and the word, a Mr Dafoe neon tagline, neon-edged dark panels and buttons. Yellow markers glow; fresh reports are hot pink. Map by default.
- **Cross Stitch** (`stitch`): an embroidered sampler (decision 70, `src/map/stitch.ts`). The frame is a grid of cells on linen aida cloth; each land cell is an X of two crossed stitches in a thread chosen by climate and relief (tundra, forest, grass, tropics, sand, mountains, ice), coasts are backstitched along the cells' edges, and the sea is bare cloth with pale blue half stitches along the shore. In Globe view the cloth is held in a wooden embroidery hoop with a brass screw, which is the globe's outline. Markers are sewn buttons (`dotShape: "button"`), raspberry, blue for fresh reports; the hollow and ringed symbols read as in every design. A Dancing Script name, the word in stitched block letters (Silkscreen filled with X stitches), a band of cross stitches under the masthead, felt-patch buttons and panels with dashed stitching. Map by default.
- **Rose Window** (`glass`): stained glass (decision 70, `src/map/glass.ts`). Land and sea are cut into glass pieces, the Voronoi cells of a jittered grid from a fixed seed, and the coastline is one more lead line, so a piece that crosses it becomes a land piece and a sea piece. Sea pieces are blues, lighter along the coast; land pieces are greens, golds and amethyst by climate and relief, pale opal on ice, never red. The glass darkens toward its lead, as if lit from behind. Globe view is the centre of a round window: a stone ring of pointed lights and small roundels, plain geometry with no figures or symbols. Grenze Gotisch lettering, the word in amber glass with a lead outline, EB Garamond for reading, arched stone-framed panels, ashlar stone behind the map. White glass markers; fresh reports are gold. Globe by default.
- **Nightclub** (`club`, decision 71): the globe is a mirror ball of square facets (pink over land, silver-blue over sea) under drifting glints, with specks of light circling the dark room and spotlight cones sweeping behind it. The map is a light-up dance floor under a tilted camera (`tilt`): square tiles, neon land tiles that each move to the next colour over four seconds, lasers fanning up from the horizon. Neon on black, Monoton and Tilt Neon, wristband buttons, acrylic panels, yellow for fresh reports (the floor never uses yellow, tested). Globe by default.
- **Poolside** (`pool`, decision 71): Hollywood-hills noir at a pool. The map lies on the pool floor in square tiles under rippling light and a slow wobble, framed by coping, tiles and a lane rope; the globe floats on the pool at night under a string of lights, bobbing, its lower part seen through the water. Dusk purple into teal, starbursts and boomerangs, Shrikhand and Jost, amber for fresh reports. Map by default.
- **Snow Globe** (`snow`, decision 71): the globe in a glass snow globe on a wooden base, seen slightly from below; dragging stirs the snow, which settles. The map is seen through curved glass that enlarges the centre like a fisheye, with frost in the corners. Warm wood, a shop sign with snow on top, frosted panels, Fraunces and Nunito, red for fresh reports. Globe by default.
- **Spreadsheet** (`sheet`): office spreadsheet software (decision 74, `src/map/sheet.ts`). The world as filled cells in a grid fixed to the screen, shaded like conditional formatting from pale at the coast to deep green inland and on mountains, with sand and ice cells and cell borders along the coasts; blank sea cells with gridlines. The globe is a chart object with selection handles. A formula bar built from the tuned place's name, column letters and row numbers lined up with the cells (`src/ui/extras.ts`), the selected cell with its fill handle as the reticle, a selected range for the panel, ribbon buttons, sheet tabs for the time bar. Square markers, blue for fresh reports; our own green. Map by default.
- **Market Terminal** (`terminal`): a financial data terminal (decision 74, `src/map/terminal.ts`). Amber and white JetBrains Mono on black; a dot-matrix plot over a coordinate grid with ticks at the frame's edges, a vector globe in a ring of ticks; tiled windows under yellow function-key headers, the reticle's latitude and longitude and a UTC clock in the map's header, lines across the plot for the reticle, the word in reverse video, a ticker of the newest headlines. No prices, arrows, red or green. White character-block markers (`block`), light blue for fresh reports. Map by default.
- **Country Club** (`prep`): preppy heritage clothing (decision 74, `src/map/club.ts`). Land embroidered in hunter green satin stitch on oxford cloth with a stitched edge; the globe a leather desk globe tooled in gold on a brass stand. Navy masthead over a tartan band, an embroidered crest of our own (crossed oars and a laurel), cable-knit toolbar, oxford panels under plain pennants, a grosgrain ribbon round the map, Playfair Display and Libre Baskerville. Gold blazer-button markers, pearl for fresh reports. Map by default.
- **Sleeper Car** (`rail`): long-distance passenger rail (decision 74, `src/map/rail.ts`). The map through a train window with curtains and a blind; Map view is the tilted camera over farmland plots, sea glints and painted peaks to hills under a dusk sky, the globe hangs in the same sky, and an embankment with the next track and telegraph poles passes faster than the land below the map. A split-flap departure board for the panel (flaps turn when the place changes), ticket-stub buttons, a station clock, Limelight and Barlow Condensed. Glowing town-light markers, pale blue for fresh reports. No routes are drawn. Map by default.

The console, Realize, Newsroom, Honeycomb, Bedtime Tea, Campus and Lasso designs borrow a feel, never a game's or album's art, names or layouts, and the site names none of them. So do Spreadsheet, Market Terminal, Country Club and Sleeper Car: no product's, brand's or railway's name, logo, lettering, colours or screens. Settings (design, view, Translate, topics) are saved in the browser only (`src/pins.ts`).

Nightclub, Poolside and Snow Globe are scenes (`scene` in the theme, `src/map/scenes.ts`): the map is drawn once per view into an off-screen canvas, and only their light moves, twelve frames a second, none while the tab is hidden, none at all with reduced motion, and none once the snow has settled. Places go through the same camera as the land (`scenePlace` in `view.ts`), so tuning, tapping, dragging and zooming work as everywhere. Only light falls on the map; the room, snow, frost, glass, spotlights and lasers stay outside it. Nothing may flash: no light swings 10% in brightness within a third of a second (WCAG 2.3.1, tested in `test/scenes.test.ts`).

Night Drive, Cross Stitch and Rose Window set `surface` in the theme: `view.ts` hands them a frame (`src/map/surface.ts`) and they draw land and sea their own way, while places, arcs and tuning stay in the view as in every design. Their pieces, stitches and wires are cut from longitude and latitude or from a grid fixed to the screen, never from any political unit, and they draw nothing in open ocean. `globeScale` shrinks the globe so a hoop or tracery fits around it. Spreadsheet, Market Terminal, Country Club and Sleeper Car (decision 74) set `surface` too (`sheet`, `terminal`, `club`, `rail`); what they add around the map (formula bar, cell headers, readout, crest, clock) is chrome built in `src/ui/extras.ts` and hidden in every other design.

The globe is shaded as a lit sphere (`shade`, `atmosphere` in the theme). The printed designs frame the map with a double neatline (`neatline`). A theme may set `decor` for drawings under the dots (`src/map/decor.ts`) and `scenery` for pictures that say what the design is (`src/map/scenery.ts`). Decorations have no text and no small filled circles, so nothing reads as a place or a dot (a large drawing may be filled with the paper colour, as Pirate's are). They sit only at fixed open-ocean spots or areas far from every outlet's city (checked against both basemaps' coasts and `config/sources.yaml` by `test/decor.test.ts`), and never change a dot. Pirate's drawings are built once as `Path2D` in local units and drawn with a transform, and its wave marks go into one path per frame. Adding an outlet on a remote island can fail that test: move the decoration, not the outlet. A scenery picture is drawn exactly as wide as the open water around its spot (`r`), and `test/scenery.test.ts` checks that whole circle is off land and at least 3 degrees from every place.

A theme is two things kept in step: a `Theme` in `src/themes.ts` (canvas) and a `:root[data-theme=...]` block in `src/style.css` (chrome and fonts). Fonts are self-hosted through `@fontsource`. See the `design-themes` skill. The word is the page's headline: centred in the masthead in every design, with its size set by its length so every word on the lists fits a phone, and always next to its date and the "Chosen by AI" label (decision 40). Anything decorative around the word must not change how it reads (a "STOP" suffix was removed because "Ceasefire stop" reads as a statement).

## Conventions

- TypeScript, ES modules, no framework. Keep dependencies small.
- Third-party text (headlines, summaries, outlet names, quoted passages) goes into the DOM as text via `h()`. URLs go through `safeUrl()`.
- Comments explain why, not what.
