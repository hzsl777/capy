---
name: design-themes
description: Change the look of GlobalGist's twenty-three designs (Morning Edition, Cabinet Map, Wire Room, Ops Room, Blueprint, Pirate, Space, Candy Shop, Stage Select, Overworld, Polygon Kingdom, Realize, Newsroom, Frog Pond, Honeycomb, Tarot, Arcadia, Bedtime Tea, Campus, Lasso, Night Drive, Cross Stitch, Rose Window, Pop-up Book, Toy Train Set, Chalkboard, Sketchbook) or add a new one, covering canvas map styling, UI chrome, fonts, and the 2D/3D projections. Use for any visual or styling request on the map or panel.
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
4. Pictures that say what a design is (a frog on a pad, a moon with a bear) go in `src/map/scenery.ts` as small SVG pictures with a spot and an open-water radius `r`; add the list to `test/scenery.test.ts`. Line drawings go in `src/map/decor.ts`, called once from `render()` in `view.ts` under the dots. Use fixed lon/lat spots (or areas, like Pirate's `WAVE_FIELDS`) in open ocean and add every list to `test/decor.test.ts`, which checks they are clear of land and far from every outlet's city. No text, and no small filled circles that could read as a dot; a large drawing may be filled with the paper colour so water lines don't show through it. Size a drawing from the open sea around its spot (Pirate's `r`), so it never reaches land at any zoom. Build shapes once as `Path2D` and draw them with a transform; the canvas redraws every frame while dragging. Backgrounds outside the globe can be CSS on `.map` (see the Space starfield).
5. Add the id to `themes` in `scripts/screenshots.ts`.
6. Check the look in both views and at phone width with the `run-app` skill's screenshot flow.

## Rules that don't change between designs
- No text on the map canvas, no borders (see packages/map/AGENTS.md "Neutrality rules").
- "Fresh" must stay distinguishable from ordinary dots: by colour, or, for monochrome designs, by a dotted outer ring (set `fresh` equal to `dot` and `drawDots` adds it). The solid outer ring means importance 4 or 5 in every design (decision 57); keep the three symbols readable.
- Pixel designs set `pixel` (the canvas renders at 1/pixel resolution). `dotShape` is one of the outlines in `src/map/marks.ts` (circle, square, diamond, bevel, button, hex, pad, star4, star5, star6, flower, gumdrop, shield, house, loop); shape never carries meaning. The map and the Key both draw from `markPath`, so a new shape goes there and nowhere else, and hollow, filled and ringed must all still read in it.
- Check the phone toolbar stays one row at 360 pixels wide with the design's fonts.
- `tilt` (a tilted camera in Map view) and `lowPoly` (triangle terrain) are Polygon Kingdom's. Under a tilt, places are drawn through `placeAt()` in `view.ts` so markers, arcs and tuning follow the camera; draw thousands of shapes as SVG path text in one `Path2D`, not as separate calls.
- Any design may take `tilt`: `tiltEye` sets the perspective, `tiltFar` the draw distance and `tiltMinZoom` how far out Map view may zoom (Night Drive). A design that draws the world a way of its own sets `surface` and gets a frame from `view.ts` (`src/map/surface.ts`; Night Drive, Cross Stitch and Rose Window in `neon.ts`, `stitch.ts`, `glass.ts`). Keep static parts (skies, hoops, tracery) in an offscreen canvas keyed by frame size and globe radius, and measure a frame while dragging against Polygon Kingdom's.
- A surface's draw function may return the milliseconds until it wants its next frame (Toy Train Set's trains, Sketchbook's line boil, Chalkboard's smudge, decision 76). The frame carries `time` (held at 0 with `still` set for reduced motion), the drag's `trail` and the `anchors` (every place shown). The view never asks for a frame while the tab is hidden or for reduced motion. Keep the static part in `stillLayer()` from `src/map/handmade.ts`, so a moving frame only copies it. Things at sea go in a spot list with a radius and into `test/handmade.test.ts`; wide soft strokes use `wideCoast()`. `tiltOut` makes the tilt follow the zoom (Pop-up Book).
- Keep text contrast readable: body text at least 4.5:1 against `--panel`.
- Respect `prefers-reduced-motion` for anything animated.
- Performance: the canvas redraws every frame while dragging, using the 110m basemap. Anything expensive goes behind `if (!this.interacting)`.
