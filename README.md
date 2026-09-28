# capy

News, compressed and sourced. Two products in one repository.

- **2DayAI**: one headline per reader per day, from a hand-written interest profile, with the stories, explanations, and sources one click down. Delivered by email. Built and tested, not yet run live. Code in `packages/core`, `db`, `pipeline`, `web`.
- **GlobalGist** (the map): a public news map in the spirit of Radio Garden. One word heads it: the emotion the day's world reporting evokes, on a scale from Grave to Good. Turn a flat map or a globe, and the panel lists what outlets at the place under the crosshair reported, newest first. Open the word to see every event's score and reason, the sourced explanations, and the sources. The map has no borders, country names or labels. Code in `packages/map`, served by the Worker in `packages/web`.

Start with CONTEXT.md. Both products read one database written by one pipeline (decisions 23 and 25 in docs/DECISIONS.md).

## 2DayAI

See docs/SPEC.md for the design, docs/DECISIONS.md for what changed after the spec, docs/RUNBOOK.md to operate it.

### How it does not lie

Every explanation sentence carries a citation: an article id and a passage. Code checks that the passage appears verbatim in that article. A sentence that fails is removed before anything downstream sees it. An event with fewer than three surviving sentences is unusable and cannot be selected for anyone. The headline is generated from the selected events' verified sentences, never from raw articles. The one paragraph written from a reader's profile rather than the sources is labeled as such on the page.

## GlobalGist, the map

| Morning Edition | Cabinet Map | Wire Room |
|---|---|---|
| ![Morning Edition](docs/map/screenshots/desktop-morning-telegram.jpg) | ![Cabinet Map](docs/map/screenshots/desktop-cabinet-3d.jpg) | ![Wire Room](docs/map/screenshots/desktop-wire-explained.jpg) |

Screenshots use the fictional sample: invented outlets and places, run through the real pipeline.

- **Pins are publishers**, at the city they publish from (the `desk: world` entries in `config/sources.yaml`). Nothing is geocoded, so the map never draws or names a disputed place.
- **The word.** Each day the `telegram` stage scores every explained world event from -2 to 2 by what happened to people. Each score quotes the sentence it rests on. Code places the day on a five-step scale. The worst significant event sets a bad day, so good news never averages a tragedy away. The model then picks the word from that step's fixed list. The site shows every score and its reason.
- **Four depths.** The word, then the events with one line each, then each event's explanation with numbered citations, then the sources with the passages quoted. Headlines appear as the outlets published them.
- Three designs, flat or globe, a 24-hour replay, topic filters, pinned places, and on-device translation.

## Run it

Requires Node 22. Copy `.env.example` to `.env` for 2DayAI.

```
npm install
npm run check                          # boundaries, typecheck, tests for every package. No network, no key.

# 2DayAI
npm run stage -- sources check         # fetch every feed in config/sources.yaml and report
npm run db:migrate                     # apply migrations to DATABASE_URL
npm run stage -- day --date 2026-09-04 # ingest, enrich, readers sync, cluster, explain, select
npm run stage -- show --reader r01     # print that reader's edition for the date
npm run stage -- deliver --dry-run     # what would be sent right now
npm run stage -- spend                 # model spend for the date

# The map
npm run map:sample                     # fictional world day through the real stages, in memory, into the sample data
npm run map:dev                        # http://localhost:5173 on the sample, with a banner
npm run stage -- map export            # the latest real day from DATABASE_URL, as the site sees it
npm run web:deploy                     # build the map and deploy it with the Worker (Cloudflare)
```

`LLM_BATCH=false` in `.env` makes a local 2DayAI run immediate instead of waiting on the Batches API.

## Layout

- `packages/core`: pure code. Types, Zod schemas, validators, renderers, versioned prompts. Imports nothing else in the workspace.
- `packages/db`: Drizzle schema, migrations, shared read models. Imports core. `@2dayai/db/node` holds the postgres-js client.
- `packages/pipeline`: stages, the CLI, the model module in `src/llm/` (the only place the SDK is imported). Imports core and db.
- `packages/web`: Cloudflare Worker: the map site and its data, reader pages, feedback. Imports core and db.
- `packages/map`: the map site. Imports core's types only and reads its data from the Worker.
- `config/sources.yaml`: every feed, on the briefing desk (2DayAI) or the world desk (the map, with a place per outlet). `config/readers/`: reader profiles, gitignored except the example.

`npm run lint` fails on any import that crosses those lines.

## Hosting

The Worker serves the map, its data and the reader pages on Cloudflare's free plan, so the repository can stay private. `.github/workflows/deploy-site.yml` deploys on code changes once `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are set. The daily run needs no deploy because the Worker reads the database. Actions has 2,000 free minutes a month on a private repository: the daily run, delivery every two hours, and CI fit inside it.
