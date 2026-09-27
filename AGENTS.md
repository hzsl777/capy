# Capy: agent guide

Capy is a public web app that shows world news on a map by place, in the spirit of Radio Garden. You turn a flat map or a globe, the place under the crosshair is "tuned", and the side panel lists what outlets there are reporting. Tapping a headline opens an in-app reader.

Everything must stay free to run: free data (GDELT, Natural Earth, optional RSS), a static site on GitHub Pages, and an hourly GitHub Actions job. There is no server and no database. Don't add a paid API, a hosted backend, or anything that needs a secret unless the owner asks for it.

## Neutrality rules (hard rules)

The app is public and covers contested places. These rules apply to every change. Run the `neutrality-review` skill before finishing any change to the UI, the basemap, or the pipeline's selection logic.

1. **No political geography.** The basemap has land, coastlines, lakes, rivers, relief and ice. No borders, no disputed-area lines, no country fills, no country names anywhere in the UI. Never add a Natural Earth `admin_*` or `boundary_*` layer.
2. **No labels on the map.** The map shows dots only. A place name appears only in the panel, as the short name GDELT gives (first segment, e.g. "Nairobi"). Don't append a country.
3. **No ranking.** Lists are newest first. Don't sort, size or colour by popularity, tone, sentiment, "importance" or engagement. Dot size reflects report count and nothing else. The "fresh" colour means "reported in the last hour" and nothing else.
4. **No rewriting.** Show headlines as published. No generated summaries, no generated headlines, no editorial labels on stories or places. Translation is on-device, opt-in, and always marked "Translated from X".
5. **Balance by construction.** Outlets take turns within a place and each outlet is capped across the map (`pipeline/balance.ts`). Don't loosen these caps to fill the map.
6. **No full article text.** The reader shows the outlet's own preview (og:description, og:image). The full page opens in an iframe only when the outlet's headers allow framing; otherwise it links out. Never scrape or store article bodies.
7. **Neutral copy.** UI text is plain and descriptive. No adjectives about events or places. No em dashes in UI copy or docs.

## Layout

```
index.html               page shell, toolbar, about dialog
src/
  main.ts                app state and all panel/toolbar/timebar/ticker rendering
  types.ts               data contract shared with the pipeline (edit this first)
  data.ts                load + filter + formatting helpers (unit tested)
  themes.ts              canvas colours per design; CSS tokens live in style.css
  map/view.ts            canvas map: projections, drag/zoom/pinch, tuning, drawing
  map/basemap.ts         loads the TopoJSON basemap
  translate.ts           browser Translator API wrapper
  pins.ts                localStorage pins and prefs
  ui/dom.ts              element builder (text only, never innerHTML)
  style.css              three themes over one layout
pipeline/
  ingest.ts              entry point; GDELT + RSS -> public/data/latest.json
  gdelt.ts, gkg.ts       GKG 2.1 download and parsing
  place.ts, topics.ts    one place per article; topic tags
  balance.ts, cluster.ts selection and cross-place story grouping
  enrich.ts              preview metadata + framing check (robots-aware)
  rss.ts, sources.json   optional hand-picked outlets
  sample.ts              placeholder data for dev (public/data/sample.json)
scripts/
  build-basemap.ts       Natural Earth -> public/basemap/*.json (output committed)
  screenshots.ts         every design x view into docs/screenshots
test/                    vitest; fixtures/gkg-sample.csv for offline ingest
```

## Commands

```
npm install
npm run dev              dev server with sample data (http://localhost:5173)
npm run typecheck
npm test
npm run build            typecheck + production build into dist/
npm run sample           regenerate public/data/sample.json
npm run ingest           live GDELT ingest (needs network to data.gdeltproject.org)
npm run ingest -- --fixture test/fixtures/gkg-sample.csv --out /tmp/out.json
npm run basemap          rebuild the basemap (needs raw.githubusercontent.com)
npm run build && npm run screenshots
```

Before pushing: `npm run typecheck && npm test && npm run build`.

## Data contract

`src/types.ts` defines `NewsFile`, written by the pipeline and read by the app. Change it there first, then update both sides and `toNewsFile` in `pipeline/ingest.ts`. Times are unix seconds, and the app measures time windows from `generatedAt`, not the viewer's clock. `source: "sample"` makes the app show a sample-data banner. The deploy workflow deletes `sample.json` so the public site can never fall back to it.

## Designs

There are three looks, each in flat (2D) or globe (3D) view:

- **Morning Edition**: newsprint, black ink, halftone land, blackletter masthead. Flat by default.
- **Cabinet Map**: parchment, sepia ink, engraved water lines, hachured mountains, one red for fresh reports. Flat by default.
- **Wire Room**: dark desk, dot-matrix land, amber for fresh reports, scrolling ticker. Globe by default.

A theme is two things kept in step: a `Theme` in `src/themes.ts` (canvas) and a `:root[data-theme=...]` block in `src/style.css` (chrome and fonts). Fonts are self-hosted through `@fontsource`, so no third-party font requests. See the `design-themes` skill.

## Conventions

- TypeScript, ES modules, no framework. Keep dependencies small.
- Third-party text (headlines, previews, outlet names) goes into the DOM as text via `h()`. URLs go through `safeUrl()`.
- The pipeline must degrade, not crash: a missing GDELT slot, a dead feed or a slow outlet is logged and skipped.
- Tests sit next to the behaviour they pin down. Add a test when you change placement, balance, clustering, topic rules or the data contract.
- Comments explain why, not what.
