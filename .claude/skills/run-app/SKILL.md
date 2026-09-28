---
name: run-app
description: Start the GlobalGist news map locally, open a specific design (Morning Edition, Cabinet Map, Wire Room) in flat or globe view, tune to a place, and take screenshots to check a change visually. Use when asked to run, preview, screenshot or visually verify the app.
---

# Run the app

Paths in this skill are relative to `packages/map/`. Run npm scripts from the repository root.

1. Install if needed: `npm install` at the repository root.
2. Sample data: `npm run map:sample` runs the fictional world fixture through the real pipeline stages in memory and writes `public/data/sample.json` (committed; rerun it after changing stages or the read model).
3. Dev server: `npm run map:dev`, then open http://localhost:5173. Without `public/data/latest.json` the site loads the sample and shows a "Sample data" banner. That is expected.
4. URL parameters pick the state directly:
   - `?theme=morning|cabinet|wire`
   - `&view=2d|3d`
   - `&place=<place id>` flies to that place, e.g. `ll:-1.29,36.82` (Nairobi in the sample). Place ids are `ll:<lat>,<lon>` of the publisher's city.

## Screenshots

```
npm run map:build
npm run map:screenshots                 # writes docs/map/screenshots/*.jpg
SHOT_DIR=/some/dir npm run map:screenshots
```

The script serves `dist/` with `vite preview`, visits every design in both views at desktop and phone sizes, and per design opens the reader, the telegram and one explanation. It uses `/opt/pw-browsers/chromium` when `PLAYWRIGHT_BROWSERS_PATH` is set (cloud sessions), or `CHROMIUM_PATH` if you set it. Never run `playwright install` in a cloud session. The script uses `playwright-core`, so installs never download browsers; elsewhere set `CHROMIUM_PATH` or install a browser yourself.

Look at the images before reporting a visual change as done. Check: dots visible and not crowding at phone width, crosshair centred on the tuned dot, panel text readable in all three themes, no labels drawn on the map.

## Live data locally

With `DATABASE_URL` set: `npm run stage -- map export --out packages/map/public/data/latest.json`, then reload. Delete that file to go back to the sample.
