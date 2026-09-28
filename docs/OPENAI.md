# The OpenAI dashboard

A guide to platform.openai.com for this project: what to set up once, what to check now and then, and what to ignore. Menu names are from OpenAI's help pages and release notes as of September 2026. They move around, so if one isn't where this says, search the settings for its name.

The prompts themselves are in the repository, not in the dashboard. docs/PROMPTS.md explains them.

## The short version

1. One project for this repository, with its own key.
2. The key in the GitHub secret `LLM_API_KEY`, and nowhere else.
3. Prepaid credit on the account, with auto recharge off or low.
4. A hard monthly spend limit on the project, for example $10.

That's all the pipeline needs. Everything else in the dashboard is optional.

## Organization and projects

The name at the top left is your organization, and next to it the current project. Billing belongs to the organization. Keys, limits and usage can be split by project.

Make a project just for this repository, named something like "GlobalGist". Its spend limit then covers only this work, and its usage page shows only these calls. Switch to it before creating the key.

## API keys

Project, then **API keys**, then **Create new secret key**.

- Name it after where it lives, for example "github-actions".
- Permissions: **Restricted** is safest. The pipeline only calls chat completions (`/v1/chat/completions`), so it needs write access to model capabilities and nothing else. If `llm check` fails with a permissions error, set it to **All** for this project's key.
- The key is shown once. Paste it straight into GitHub: Settings, Secrets and variables, Actions, secret `LLM_API_KEY`. For local runs, put it in `.env`, which is gitignored.

To replace a key: create the new one, update the secret, run "Preflight" or wait for the next daily run, then delete the old key here. The key list also shows when each key was last used, which is the quickest way to spot a key that leaked.

## Billing

Settings, then **Billing**.

- The API is prepaid. Add credit, for example $10. At the estimated $0.10 to $0.25 a day for the map, that lasts one to three months.
- **Auto recharge** tops the balance up when it runs low. Leave it off at first, or set a low amount. With it off, an empty balance stops the calls and the site keeps showing the last good day.
- Credits have an expiry date, shown on the billing page.
- The account needs a payment on file before the first call works. The first payment also moves the account to usage tier 1 (see Limits).

## Limits

Settings, then **Limits**, for the organization, and the same page under the project.

- **Hard spend limit** (since July 2026): a monthly dollar cap on the organization or a project. Once spend reaches it, calls fail with HTTP 429 and `insufficient_quota` until the next month. OpenAI says a little can pass the cap before it takes effect. Set one on the project. $10 a month leaves room for a busy month and an eval run.
- **Alerts**: an email when spend passes a share of the limit. Set one at 50 percent so a surprise shows up early.
- **Rate limits and usage tier**: tokens and requests per minute for each model. Tier 1 is enough for this pipeline. When a limit is hit, the code waits and retries.
- **Model access**, if shown: the project can be limited to the models it uses (`gpt-5.4-nano` and `gpt-5.4-mini`, plus any you try in the eval).

The pipeline has its own guard as well. `DAILY_SPEND_CEILING_USD` (default $1.00) stops a day before a call would pass it. The dashboard limit is the second guard, and it also covers a leaked key.

## Usage

**Usage** in the dashboard shows spend and tokens per day, per model and, since August 2026, per key.

- Compare it with the `llm_calls` table now and then (RUNBOOK, "Watch spend"). If the two differ by more than a few percent, the prices in `packages/pipeline/src/llm/pricing.ts` are out of date.
- Calls on the flex tier cost half. If none show as flex, OpenAI isn't serving flex for these models. Set the repository variable `LLM_SERVICE_TIER` to `default` to skip the extra attempt.
- **Cached input** is the part of each prompt OpenAI had already seen, billed at a tenth. It should be a large share on the telegram's three scoring calls.

## Logs

**Logs** will stay empty for this project, and that's expected. OpenAI keeps chat completions there only when the request asks it to, and the pipeline doesn't. The record of each call is in the database instead: `llm_calls` for tokens and cost, `runs` for each stage's result or error.

## Data controls

Settings, then **Data controls**. By default OpenAI doesn't train on API traffic. Leave any sharing option off: 2DayAI sends reader profiles, which describe real people's work and situation.

## What to ignore

None of these are used by this project:

- **Playground**: for trying prompts by hand. Fine for experiments, but the pipeline doesn't read anything saved there.
- **Prompts** (saved prompts in the dashboard): the pipeline's prompts are files in the repository, versioned with the code.
- **Assistants, Agents, Agent Builder, Realtime**: other ways to use the models. Not used.
- **Batch**: a half-price queue with up to a day's wait. The pipeline uses the flex tier instead, which costs the same and answers in minutes.
- **Fine-tuning, Evals, Storage, Vector stores**: not used. The model eval is this repository's own ("Model eval" workflow).
- **Admin keys, Webhooks**: not needed.

## When a call fails

The daily run's summary page in GitHub Actions says which stage failed. The error from OpenAI is in the log and in the `runs` table.

| Error | Meaning | Fix |
|---|---|---|
| 401 | The key is wrong or deleted | Replace the `LLM_API_KEY` secret |
| 403, or a permissions message | A restricted key without chat access | Edit the key's permissions |
| 404 or "model not found" | The model id changed or the project can't use it | Check the model list and the project's model access, then `MODEL` / `MODEL_TELEGRAM` |
| 429 `insufficient_quota` | Hard spend limit reached, or no credit left | Add credit or raise the limit |
| 429 rate limit | Too many tokens a minute | Retried by the code. If it keeps failing, lower `WORLD_CLUSTER_BATCH` |
| 5xx | OpenAI is having trouble | Retried by the code. Re-run "Daily run" later with the day's date |

Every daily run starts with `llm check`, one tiny call per model, so the first four fail in seconds with a plain message instead of midway through the day.
