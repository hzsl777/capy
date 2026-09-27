@AGENTS.md

## Claude Code notes

Project skills live in `.claude/skills/`:

- `run-app`: start the app, switch designs and views, take screenshots.
- `neutrality-review`: checklist to run before finishing any UI, basemap or selection change.
- `add-news-source`: add a hand-picked RSS outlet to `pipeline/sources.json`.
- `ingest-pipeline`: run and debug the GDELT pipeline, including offline with fixtures.
- `design-themes`: change one of the three looks or add a new one.

In cloud sessions, a SessionStart hook runs `npm ci` when `node_modules` is missing. GDELT hosts may be blocked by the session's network policy; use the fixture flow in `ingest-pipeline` when they are.
