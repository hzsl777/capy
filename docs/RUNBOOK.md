# Runbook

## First-time setup

1. Open a free Neon project. Copy the connection string to the `DATABASE_URL` secret in this repository and to `.env` locally.
2. Create an Anthropic API key. Add it as the `ANTHROPIC_API_KEY` secret. Not needed for milestone 0.
3. Open a free Resend account and verify a sending domain. Add `RESEND_API_KEY`. Not needed until milestone 3.
4. Run `npm run db:migrate` once locally to create the tables.
5. Run `npm run stage -- sources check` and remove any feed that fails from `config/sources.yaml`.

## First real run, for Davis

1. `.env` with `DATABASE_URL`, `ANTHROPIC_API_KEY`, `LLM_BATCH=false`.
2. Write `config/readers/r01.yaml` from `r00.example.yaml` with your real email and profile.
3. `npm run stage -- sources check` and prune the list.
4. `npm run stage -- day` and read the JSON report: articles in, events, usable explanations, sentences dropped, editions, spend.
5. `npm run stage -- show --reader r01` and judge the headline, the lines, the explanations, and the sources.
6. `npm run stage -- deliver --dry-run` to see what would go out, then without the flag once Resend is set up.

Judge every day on the three phase-one conditions in SPEC.md section 1. When a prompt needs to change, copy it to the next version and re-run the same date, so the two outputs sit side by side.

## Run a day locally

```
npm run stage -- day --date 2026-09-04
```

Every stage is idempotent per date. Re-run it and it overwrites its own output for that date. Feedback is kept. Two guards: select never replaces an edition that was already sent, and cluster refuses to run for a date with a sent edition unless you pass `--force`, because re-clustering breaks the links in that email.

## Re-run one stage

```
npm run stage -- ingest --date 2026-09-04
npm run stage -- cluster --date 2026-09-04
npm run stage -- explain --date 2026-09-04
npm run stage -- select --date 2026-09-04
npm run stage -- cluster world --date 2026-09-04
npm run stage -- telegram --date 2026-09-04
```

## Deploy the site

The Worker in `packages/web` serves three things: the public map (the static build of `packages/map`), the map's data at `/data/latest.json` and `/data/<date>.json` (read from the database on each request, cached five minutes), and the 2DayAI reader pages.

Once, on a free Cloudflare account:

```
cd packages/web
npx wrangler secret put DATABASE_URL
```

Then add the repository secrets `CLOUDFLARE_API_TOKEN` (a token with the "Edit Cloudflare Workers" template) and `CLOUDFLARE_ACCOUNT_ID`. From then on `.github/workflows/deploy-site.yml` deploys on every code change to `main`. By hand: `npm run web:deploy` (builds the map, drops the sample data from the build, deploys).

Set the repository variable `WEB_BASE_URL` to the Worker URL so email links point at it, and `MAIL_FROM` to the verified Resend sender.

The daily run needs no deploy: the Worker reads the new day from the database.

## The world desk and the telegram

World sources are the `desk: world` entries in `config/sources.yaml`, each with the city it publishes from. The daily run clusters them (`cluster world`), explains conflict events and events of importance 4 or 5 (at most `WORLD_EXPLAIN_MAX`, default 25), and writes the telegram (`telegram`). To look at a day without the site:

```
npm run stage -- map export --date 2026-09-27 --out /tmp/map.json
```

To see the whole site with no database, no key and no network, `npm run map:sample` runs the fictional world fixture through the real stages in memory and writes `packages/map/public/data/sample.json`; then `npm run map:dev`.

If the telegram stage fails twice on the rules (one word, found in the verified sentences, not a name, not a contested word), the run fails loudly and the site shows no word for that day. Look at the `runs` table detail for the reason before changing the prompt.

## Change the schema

Edit `packages/db/src/schema.ts`, then `npm run db:generate`. Commit the migration under `packages/db/migrations/`. The daily workflow applies migrations before running.

## Change a prompt

Copy `packages/core/prompts/<name>.v<n>.md` to `v<n+1>`, edit the copy, point the stage at the new version. Attach a before-and-after run on the same past date to the pull request.

## Rotate a key

Replace the secret in GitHub, then in `.env`. Nothing in the repository holds a key. CI runs a secret scan on every push.

## Watch spend

`select sum(cost_usd) from llm_calls where run_date = current_date;`

The daily workflow fails when a day passes `DAILY_SPEND_CEILING_USD`.
