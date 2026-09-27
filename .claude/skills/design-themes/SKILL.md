---
name: design-themes
description: Change the look of Capy's three designs (Morning Edition, Cabinet Map, Wire Room) or add a new one, covering canvas map styling, UI chrome, fonts, and the 2D/3D projections. Use for any visual or styling request on the map or panel.
---

# Designs

Paths in this skill are relative to `packages/map/`. Run npm scripts from the repository root.

Each design has two halves that must stay in step:

1. **Canvas** (`src/themes.ts`): a `Theme` object with ocean/land colours, land texture (`halftone`, `matrix`, `none`), number of engraved water lines, graticule, rivers, relief ink, dot colours, and the flat projection. The globe always uses the orthographic projection.
2. **Chrome** (`src/style.css`): a `:root[data-theme="<id>"]` block of tokens (`--page`, `--panel`, `--ink`, `--muted`, `--rule`, `--accent`, `--on-accent`, fonts), plus any theme-specific rules further down (search for `data-theme="<id>"`).

Masthead text per design is in `THEMES[id].masthead` and `renderMasthead()` in `src/main.ts`.

## Adding a design

1. Add the id to `ThemeId` and an entry in `THEMES`.
2. Add a token block in `style.css`. Pick fonts from `@fontsource` (`npm i @fontsource/<font>`) and import the weights in `src/main.ts`. Don't load fonts from a third-party CDN.
3. Check the look in both views and at phone width with the `run-app` skill's screenshot flow.

## Rules that don't change between designs
- No text on the map canvas, no borders (see packages/map/AGENTS.md "Neutrality rules").
- "Fresh" must stay distinguishable from ordinary dots: by colour, or, for monochrome designs, by an outer ring (set `fresh` equal to `dot` and `drawDots` adds the ring).
- Keep text contrast readable: body text at least 4.5:1 against `--panel`.
- Respect `prefers-reduced-motion` for anything animated.
- Performance: the canvas redraws every frame while dragging, using the 110m basemap. Anything expensive goes behind `if (!this.interacting)`.
