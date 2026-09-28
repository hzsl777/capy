# Runbook

## First-time setup

1. Open a free Neon project. Copy the connection string to the `DATABASE_URL` secret in this repository and to `.env` locally.
2. Create a model API key. OpenAI is the default (decision 29). Add the key as the `LLM_API_KEY` secret. To use another provider, set the repository variable `LLM_PROVIDER` too. See "Choose a model" below. Not needed for milestone 0.
3. Open a free Resend account and verify a sending domain. Add `RESEND_API_KEY`. Not needed until milestone 3.
4. Run `npm run db:migrate` once locally to create the tables.
5. Run `npm run stage -- sources check` and remove any feed that fails from `config/sources.yaml`.

## First real run, for Davis

1. `.env` with `DATABASE_URL` and `LLM_API_KEY` (and `LLM_PROVIDER` if not OpenAI).
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

The Worker in `packages/web` serves three things:

- the public map, which is the static build of `packages/map`
- the map's data at `/data/latest.json` and `/data/<date>.json`, read from the database and cached for five minutes
- the 2DayAI reader pages

Once, on a free Cloudflare account:

```
cd packages/web
npx wrangler secret put DATABASE_URL
```

Then add the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Create the token from the "Edit Cloudflare Workers" template. After that, `.github/workflows/deploy-site.yml` deploys on every code change to `main`. To deploy by hand, run `npm run web:deploy`. It builds the map, removes the sample data from the build, and deploys.

Set the repository variable `WEB_BASE_URL` to the Worker URL so email links point at it, and `MAIL_FROM` to the verified Resend sender.

The daily run needs no deploy: the Worker reads the new day from the database.

## The world desk and the telegram

World sources are the `desk: world` entries in `config/sources.yaml`. Each one has the city it publishes from. The daily run does three things with them:

1. `cluster world` groups their articles into events.
2. `explain` explains events of importance 3 or more, at most `WORLD_EXPLAIN_MAX` (default 25).
3. `telegram` scores each explained event, computes the day's band, and picks the word from that band's list (decision 26).

To look at a day without the site:

```
npm run stage -- map export --date 2026-09-27 --out /tmp/map.json
```

To see the whole site with no database, no key and no network, run `npm run map:sample`, then `npm run map:dev`. The first command runs the fictional world fixture through the real stages in memory and writes `packages/map/public/data/sample.json`.

The telegram makes two model calls, and code checks each one:

- The score call must score every event and copy one of its verified sentences as the reason.
- The word call must pick from the band's list and, on a bad day, name the event that set it.

If a call fails its check twice, the run fails and the site shows no word for that day. Read the reason in the `runs` table detail before you change a prompt. `telegram_scores` holds every score and its reason.

## Choose a model

The provider and model are repository variables, read by the daily workflow (decision 28):

| Variable | Default | Example |
|---|---|---|
| `LLM_PROVIDER` | `openai` | `mistral`, `deepseek`, `groq`, `anthropic` |
| `MODEL` | the provider's cheap general model (`gpt-5.4-nano` for OpenAI) | `gpt-6-luna` |
| `MODEL_TELEGRAM` | `gpt-5.4-mini` for OpenAI, otherwise same as `MODEL` | `gpt-5.4-mini` |
| `LLM_THINKING` | `telegram` | `off`, `all` |
| `DAILY_SPEND_CEILING_USD` | `0.25` | |

The key is always the `LLM_API_KEY` secret.

Pick by measurement, not by price alone:

1. Add a key for each provider you want to compare as its own secret: `OPENAI_API_KEY`, `MISTRAL_API_KEY`, `DEEPSEEK_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`. The default comparison needs only the OpenAI key; setups without a key are skipped.
2. Run the "Model eval" workflow from the Actions tab. Leave the setups empty for the default comparison, or list your own.
3. Download the `model-eval` artifact and read `report-<date>.md`.
4. Repeat on two or three different days, at least one of them a heavy news day.
5. Set `LLM_PROVIDER`, `MODEL` and `MODEL_TELEGRAM` to the cheapest setup whose reports you would publish.

Locally, the same run is `npm run stage -- eval --setups "openai:gpt-5.4-mini; openai; mistral"`. It saves the day's articles to `.eval/snapshot-<date>.json` (gitignored) and reuses them, so later runs compare setups on the same articles. To see the report's layout with no key and no network, run `npm run stage -- eval --fixture --fake`.

In the report:

- **Cost for the day** is the model spend, from the rates in `packages/pipeline/src/llm/pricing.ts`. Check them against the provider's price page.
- **Sentences kept** is the share of explanation sentences whose quoted passage was found in the article. A low share means the model misquotes its sources.
- **Score retry** and **Word retry** mean the first answer broke a rule in code. Frequent retries mean a day without a word is likely.
- **Same band as first** compares each setup with the first one listed. Put the setup you trust most first.
- Below the table, each setup lists every score with its reason. Read these. The code checks cannot tell whether the model judged the day correctly.

## Change the schema

Edit `packages/db/src/schema.ts`, then `npm run db:generate`. Commit the migration under `packages/db/migrations/`. The daily workflow applies migrations before running.

## Change a prompt

Copy `packages/core/prompts/<name>.v<n>.md` to `v<n+1>`, edit the copy, point the stage at the new version. Attach a before-and-after run on the same past date to the pull request.

## Rotate a key

Replace the secret in GitHub, then in `.env`. Nothing in the repository holds a key. CI runs a secret scan on every push.

## Watch spend

`select sum(cost_usd) from llm_calls where run_date = current_date;`

The daily workflow fails when a day passes `DAILY_SPEND_CEILING_USD`.
