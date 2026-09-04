# Runbook

## First-time setup

1. Open a free Neon project. Copy the connection string to the `DATABASE_URL` secret in this repository and to `.env` locally.
2. Create an Anthropic API key. Add it as the `ANTHROPIC_API_KEY` secret. Not needed for milestone 0.
3. Open a free Resend account and verify a sending domain. Add `RESEND_API_KEY`. Not needed until milestone 3.
4. Run `npm run db:migrate` once locally to create the tables.
5. Run `npm run stage -- sources check` and remove any feed that fails from `config/sources.yaml`.

## Run a day locally

```
npm run stage -- day --date 2026-09-04
```

Every stage is idempotent per date. Re-run it and it overwrites its own output for that date.

## Re-run one stage

```
npm run stage -- ingest --date 2026-09-04
```

## Change the schema

Edit `packages/db/src/schema.ts`, then `npm run db:generate`. Commit the migration under `packages/db/migrations/`. The daily workflow applies migrations before running.

## Change a prompt

Copy `packages/core/prompts/<name>.v<n>.md` to `v<n+1>`, edit the copy, point the stage at the new version. Attach a before-and-after run on the same past date to the pull request.

## Rotate a key

Replace the secret in GitHub, then in `.env`. Nothing in the repository holds a key. CI runs a secret scan on every push.

## Watch spend

`select sum(cost_usd) from llm_calls where run_date = current_date;`

The daily workflow fails when a day passes `DAILY_SPEND_CEILING_USD`.
