---
name: design-themes
description: Change the look of GlobalGist's twenty-three designs (Morning Edition, Cabinet Map, Wire Room, Ops Room, Blueprint, Pirate, Space, Candy Shop, Stage Select, Overworld, Polygon Kingdom, Realize, Newsroom, Lily Pond, Honeycomb, Arcana, Arcadia, Nightcap, Campus, Lasso, Nightclub, Poolside, Snow Globe) or add a new one, covering canvas map styling, UI chrome, fonts, and the 2D/3D projections. Use for any visual or styling request on the map or panel.
---

# Designs

Paths in this skill are relative to `packages/map/`. Run npm scripts from the repository root.

Each design has two halves that must stay in step:

1. **Canvas** (`src/themes.ts`): a `Theme` object with ocean/land colours, land texture (`halftone`, `matrix`, `none`), number of engraved water lines, graticule, rivers, relief ink, dot colours, the flat projection, and `decor` (drawings under the dots from `src/map/decor.ts`, or `null`). The globe always uses the orthographic projection.
2. **Chrome** (`src/style.css`): a `:root[data-theme="<id>"]` block of tokens (`--page`, `--panel`, `--ink`, `--muted`, `--rule`, `--accent`, `--on-accent`, fonts), plus any theme-specific rules further down (search for `data-theme="<id>"`).

Every design shows the same name and tagline from `src/brand.ts`. The row above it and the typography differ per design in `renderMasthead()` in `src/main.ts`. Don't give a design its own publication name.

## Adding a design

1. Add the id to `ThemeId` and an entry in `THEMES`.
2. Add a token block in `style.css`. Pick fonts from `@fontsource` (`npm i @fontsource/<font>`) and import the weights in `src/main.ts`. Don't load fonts from a third-party CDN.
3. Style `.telegram-word` and `.telegram-big` for the design with `font-family`, `font-weight`, `letter-spacing` and colour only, never the `font` shorthand, so the length-based size (`--len`) still applies. Check that "Encouragement" fits a 375-pixel phone.
4. Decorations on the canvas go in `src/map/decor.ts`, called once from `render()` in `view.ts` under the dots. Use fixed lon/lat spots in open ocean and add them to `test/decor.test.ts`, which checks they are clear of land and far from every outlet's city. Open strokes only: no text, no filled circles that could read as a dot. Backgrounds outside the globe can be CSS on `.map` (see the Space starfield).
5. Add the id to `themes` in `scripts/screenshots.ts`.
6. Check the look in both views and at phone width with the `run-app` skill's screenshot flow.

## Rules that don't change between designs
- No text on the map canvas, no borders (see packages/map/AGENTS.md "Neutrality rules").
- "Fresh" must stay distinguishable from ordinary dots: by colour, or, for monochrome designs, by a dotted outer ring (set `fresh` equal to `dot` and `drawDots` adds it). The solid outer ring means importance 4 or 5 in every design (decision 57); keep the three symbols readable.
- Pixel designs set `pixel` (the canvas renders at 1/pixel resolution). `dotShape` may be a circle, square or diamond; shape never carries meaning.
- Check the phone toolbar stays one row at 360 pixels wide with the design's fonts.
- `tilt` (a tilted camera in Map view) is Polygon Kingdom's and Nightclub's; `lowPoly` (triangle terrain) is Polygon Kingdom's. Under a tilt, places are drawn through `placeAt()` in `view.ts` so markers, arcs and tuning follow the camera; draw thousands of shapes as SVG path text in one `Path2D`, not as separate calls.
- Keep text contrast readable: body text at least 4.5:1 against `--panel`.
- Respect `prefers-reduced-motion` for anything animated.
- **No flashing** (WCAG 2.3.1). Nothing may flash more than three times a second or change brightness sharply over a large area: no strobe, no neon flicker, no light that swings 10% in brightness within a third of a second. Colour shifts take seconds. `test/scenes.test.ts` checks this for Nightclub's floor colours and the mirror ball's glints; add a check like it for any new moving light.
- `scene` (Nightclub `club`, Poolside `pool`, Snow Globe `snow`, decision 71) gives a design its own camera and moving light (`src/map/scenes.ts`, `renderScene` in `view.ts`). The map is drawn once per view into an off-screen canvas and only the light is repainted, twelve frames a second, none while the tab is hidden, none with reduced motion. Places go through the same camera as the land (`scenePlace`), so a new camera needs its warp there and, if it enlarges the centre, in `sceneMag` for dragging. Only light may fall on the map; rooms, snow, frost, glass, spotlights and lasers stay outside it. `globeScale` draws the globe smaller to leave room around it.
- Performance: the canvas redraws every frame while dragging, using the 110m basemap. Anything expensive goes behind `if (!this.interacting)`.
