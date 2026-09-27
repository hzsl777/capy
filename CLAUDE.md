@AGENTS.md

## Claude Code notes

Project skills live in `.claude/skills/`. The map's skills:

- `run-app`: start the map, switch designs and views, take screenshots.
- `neutrality-review`: checklist to run before finishing any map UI, basemap or selection change.
- `add-news-source`: add a hand-picked RSS outlet to the map's `packages/map/pipeline/sources.json`.
- `ingest-pipeline`: run and debug the map's GDELT pipeline, including offline with fixtures.
- `design-themes`: change one of the map's three looks or add a new one.

2DayAI's operating steps are in docs/RUNBOOK.md.

In cloud sessions, a SessionStart hook runs `npm ci` when `node_modules` is missing. News hosts, GDELT and the Anthropic API may be blocked by the session's network policy; both products have offline fixture flows.
