@AGENTS.md

## Claude Code notes

Project skills live in `.claude/skills/`:

- `run-app`: start the map site, switch designs and views, take screenshots.
- `neutrality-review`: checklist to run before finishing any map UI, basemap, telegram or world-selection change.
- `add-news-source`: add an outlet to the world desk in `config/sources.yaml`, with its place.
- `ingest-pipeline`: run and debug the world desk: cluster world, explain, the telegram and the map's read model.
- `design-themes`: change one of the map's three looks or add a new one.

2DayAI's operating steps are in docs/RUNBOOK.md.

In cloud sessions, a SessionStart hook runs `npm ci` when `node_modules` is missing. News hosts and the Anthropic API may be blocked by the session's network policy; `npm run check` and `npm run map:sample` need neither.
