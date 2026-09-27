---
name: run-app
description: Start the Capy news map locally, open a specific design (Morning Edition, Cabinet Map, Wire Room) in flat or globe view, tune to a place, and take screenshots to check a change visually. Use when asked to run, preview, screenshot or visually verify the app.
---

# Run the app

1. Install if needed: `npm install` (in cloud sessions set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`).
2. Dev server: `npm run dev`, then open http://localhost:5173. Without `public/data/latest.json` the app loads `public/data/sample.json` and shows a "Sample data" banner. That is expected.
3. URL parameters pick the state directly:
   - `?theme=morning|cabinet|wire`
   - `&view=2d|3d`
   - `&place=<place id>` flies to that place, e.g. `ll:-1.3,36.8` (Nairobi in the sample). Live data uses `g:<gdelt feature id>`.

## Screenshots

```
npm run build
npm run screenshots                 # writes docs/screenshots/*.jpg
SHOT_DIR=/some/dir npm run screenshots
```

The script serves `dist/` with `vite preview`, visits every design in both views at desktop and phone sizes, and opens the reader once per design. It uses `/opt/pw-browsers/chromium` when `PLAYWRIGHT_BROWSERS_PATH` is set (cloud sessions), or `CHROMIUM_PATH` if you set it. Never run `playwright install` in a cloud session.

Look at the images before reporting a visual change as done. Check: dots visible and not crowding at phone width, crosshair centred on the tuned dot, panel text readable in all three themes, no labels drawn on the map.

## Live data locally

If `data.gdeltproject.org` is reachable: `npm run ingest` writes `public/data/latest.json`, and the dev server picks it up on reload. Delete that file to go back to sample data.
