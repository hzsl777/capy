# 2DayAI

Your day, in one line. A pipeline that compresses a day of news into one headline per reader, with the stories, explanations, and sources one click down.

Status: milestone 0. Ingest works. Cluster, explain, select, headline, and delivery follow in order. See docs/SPEC.md for the design and docs/DECISIONS.md for why.

## Run it

Requires Node 22. Copy `.env.example` to `.env` and fill in what the command needs (`sources check` needs nothing).

```
npm install
npm run check                       # boundaries, typecheck, tests. No network.
npm run stage -- sources check      # fetch every feed in config/sources.yaml and report
npm run db:generate                 # after editing packages/db/src/schema.ts
npm run db:migrate                  # apply migrations to DATABASE_URL
npm run stage -- ingest             # today's articles into the database
npm run stage -- ingest --date 2026-09-03
```

## Layout

- `packages/core`: pure code. Types, Zod schemas, validators, prompt loader, versioned prompts. Imports nothing else in the workspace.
- `packages/db`: Drizzle schema, migrations, client. Imports core.
- `packages/pipeline`: stages and the CLI. The only place that calls the model, in `src/llm/`. Imports core and db.
- `packages/web`: Cloudflare Worker for reader pages and feedback. Imports core and db.
- `config/sources.yaml`: the feed list. `config/readers/`: reader profiles, gitignored except the example.

`npm run lint` fails on any import that crosses those lines.
