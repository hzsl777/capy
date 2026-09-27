# capy

News, compressed and sourced. One pipeline, two products.

- **2DayAI**: one headline per reader per day, from a hand-written interest profile, with the stories, explanations, and sources one click down. Delivered by email. Built and tested; not yet run live.
- **The map** (planned, after 2DayAI proves out): a public black and white paper map with no borders and no country names. Pins are publishers, placed where they publish from, as Radio Garden places stations. Each region gets one telegram line a day and the same sourced explanations underneath.

Both read one database written by one pipeline. See docs/SPEC.md for the design, docs/DECISIONS.md for what changed after the spec, docs/RUNBOOK.md to operate it.

## How it does not lie

Every explanation sentence carries a citation: an article id and a passage. Code checks that the passage appears verbatim in that article. A sentence that fails is removed before anything downstream sees it. An event with fewer than three surviving sentences is unusable and cannot be selected for anyone. The headline is generated from the selected events' verified sentences, never from raw articles. The one paragraph written from a reader's profile rather than the sources is labeled as such on the page.

## Run it

Requires Node 22. Copy `.env.example` to `.env`.

```
npm install
npm run check                          # boundaries, typecheck, tests. No network, no key.
npm run stage -- sources check         # fetch every feed in config/sources.yaml and report
npm run db:migrate                     # apply migrations to DATABASE_URL
npm run stage -- day --date 2026-09-04 # ingest, enrich, readers sync, cluster, explain, select
npm run stage -- show --reader r01     # print that reader's edition for the date
npm run stage -- deliver --dry-run     # what would be sent right now
npm run stage -- spend                 # model spend for the date
```

`LLM_BATCH=false` in `.env` makes a local run immediate instead of waiting on the Batches API.

## Layout

- `packages/core`: pure code. Types, Zod schemas, validators, renderers, versioned prompts. Imports nothing else in the workspace.
- `packages/db`: Drizzle schema, migrations, shared read models. Imports core. `@2dayai/db/node` holds the postgres-js client.
- `packages/pipeline`: stages, the CLI, the model module in `src/llm/` (the only place the SDK is imported). Imports core and db.
- `packages/web`: Cloudflare Worker for reader pages and feedback. Imports core and db.
- `config/sources.yaml`: the feed list. `config/readers/`: reader profiles, gitignored except the example.

`npm run lint` fails on any import that crosses those lines.
