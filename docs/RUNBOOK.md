# Runbook

## Launch

Going live is secrets and one merge. Everything after that runs by itself (decision 34). Secrets go in GitHub under Settings, then Secrets and variables, then Actions.

1. **Database.** Create a free Neon project (one Postgres database, nothing else) and copy its pooled connection string. Add it as the secret `DATABASE_URL`.
2. **Model key.** Create an OpenAI API key and add it as the secret `LLM_API_KEY`. Add prepaid credit under Settings, then Billing: the API is billed apart from ChatGPT, and a key without credit fails every call. Set a hard monthly spend limit in the OpenAI dashboard as a second guard beside `DAILY_SPEND_CEILING_USD`. docs/OPENAI.md walks through the dashboard: the project, the key, billing, limits, and what to ignore.
3. **Cloudflare.** On a free Cloudflare account, either connect this repository to a Worker named `globalgist` in the dashboard (Workers Builds) and add `DATABASE_URL` to its secrets, or create an API token from the "Edit Cloudflare Workers" template and add it as `CLOUDFLARE_API_TOKEN`, with the account id as `CLOUDFLARE_ACCOUNT_ID`. "Deploy the site" below compares the two.
4. **Map files in R2.** Create the bucket `globalgist-maps` and make sure the daily run has a token that can write to it. "Map files in R2" below has the steps. Do this before merging: the deploy fails if the bucket doesn't exist.
5. **Merge the pull request into `main`.**

If `main` was merged before the secrets existed, the deploy skipped. Run "Deploy site" once from the Actions tab after adding them. Everything below then follows on its own.

What happens on its own:

- "Deploy site" publishes the site at `https://globalgist.<account>.workers.dev` and copies `DATABASE_URL` into the Worker.
- When the deploy finishes, "Daily run" starts if today's map doesn't exist yet. It checks the model key first, then builds the day in ten to twenty minutes. Until then the site says the first map is being made.
- Every day just after midnight UTC "Daily run" builds the day that just ended (midnight to midnight UTC, decision 81), then deletes world data older than 30 days and fetched page text older than two, so the free database never fills. GitHub often starts scheduled runs late, by up to several hours. Until the run finishes the site keeps the last word under its own date and says the next one is being chosen. A day whose word fails the checks shows the last word from the week before, under its own date, and says the day had none.
- Between daily runs, "Refresh local stories" runs every three hours and right after each daily run. It replaces the latest map's local stories with the last 24 hours of GDELT and stores the map again, in about two minutes and with no model calls, so the map's towns stay current through the day. The outlets' stories, the events and the word change only with the daily run (decision 80). Run it from the Actions tab to refresh by hand.
- Before anything goes to R2, the daily run and the refresh check the file with `map check`: valid JSON, a day's map, outlet stories, an explained event or a local story, and every listed tile on disk. A file that fails stops the run, and the file already stored stays up. The refresh and the export only publish a day whose telegram stage finished (with or without a word), so a daily run that failed part way never reaches the site (decision 85).
- If GDELT has no readable file for the window, the local stage keeps the stories it had instead of emptying the map. Uploads to R2 are tried three times.
- If the newest finished map is three days old, the refresh fails after storing, so a daily run GitHub dropped or cancelled still sends you an email.
- "Site check" runs once a day, after the refresh that follows the daily run. It loads the live site from outside, checks the headers, the day's file and a tile, asks for paths that must 404, and opens the page in a real browser at desktop and phone width. Screenshots are kept on the run's page for a week. It reads the repository variable `SITE_URL`, then `SITE_DOMAIN`, then the workers.dev address. Run it from the Actions tab after any change.
- GitHub emails you when a scheduled run fails. A failed day leaves the previous map up. The email goes to whoever last changed the workflow's schedule, and only with failed-workflow notifications on (GitHub, Settings, Notifications, Actions).

"Preflight" (in the Actions tab) is optional: it checks the key, the model ids and every feed, and reports on its summary page. To fix feeds that fail, commit a `probe.tsv` of `id<TAB>url` lines to a branch and run Preflight from that branch: it prints each outlet's best feed found from GitHub's servers, one line each, at the end of the log (decision 89). Remove the file before merging.

Each "Daily run" writes a short summary on its page in the Actions tab: the word, how many feeds were read, failed or paused, the stories and explanations, the local stories and their towns, the coverage line, the model spend, and a table of the feeds that need a person. A failed run says which stage failed and lists the stages that finished.

The coverage line reads like this one, from the first real day of decision 78 (September 30, most of a day): "Coverage: stories in 9,961 of 171,587 listed towns and cities (and 5,389 other places), 210 of 247 countries and territories, and 1,936 of 2,589 regions." Towns and cities are the city list and GeoNames' places of 1,000 people or more; "other places" are places more than 5 km from any of them, mostly GDELT's own point for a village neither list names, and sometimes an outlet pinned away from its city's listed point. Below the tables, "Countries and territories with no story today" lists each by its code and largest listed city (or, for a territory only the town list has, its first town): that is where outlet research helps most (see the add-news-source skill). `npm run stage -- coverage --date <date>` prints the same line and list from the database at any time (decision 78). Since decision 86 the region total is 2,547: Natural Earth spells 42 regions a second, garbled way ("BZchar" for Béchar, "Goi" for Goiás), and the gazetteer now counts each once under its right name.

## Turn on 2DayAI

Parked for now (decision 40): the site comes first, and 2DayAI is planned as an opt-in on the site later. "Deliver" has no schedule until then. When it comes back, restore the schedule in `.github/workflows/deliver.yml` and follow the steps below.

The email briefing uses the same database, model key and daily run as the map. It turns on by itself once it has readers and a way to send mail (decision 35).

1. **Readers.** Copy `config/readers/r00.example.yaml` for each reader and fill in the real email, timezone, delivery hour, topics and stake sentences. Ids are `r01`, `r02` and so on. Put all of them in one secret, `READER_PROFILES`, separated by a line with `---`. The profiles hold emails, so they never go in the repository. The next daily run adds the readers and makes their editions.
2. **Mail.** Open a free Resend account, verify a sending domain, and add the API key as the secret `RESEND_API_KEY`.
3. **Addresses** (repository variables, the Variables tab next to Secrets). Email links open the edition and its feedback buttons on the site, so they need its address: with a custom domain (`SITE_DOMAIN`, see "A custom domain") nothing more is needed; without one, set `WEB_BASE_URL` to `https://globalgist.<account>.workers.dev`. `MAIL_FROM` is the sender, for example `2DayAI <edition@globalgist.com>` on the domain Resend verified.

"Deliver" runs every two hours and sends each edition once its reader's local delivery hour has passed. It refuses to send while the site address or `MAIL_FROM` still hold the placeholder defaults, and says which one to set. To check an edition before any email goes out, run "Deliver" locally with `--dry-run`.

Removing a reader: take their document out of `READER_PROFILES`. They get no new editions from the next run.

## First-time setup

1. Open a free Neon project. Copy the connection string to the `DATABASE_URL` secret in this repository and to `.env` locally.
2. Create a model API key. OpenAI is the default (decision 29). Add the key as the `LLM_API_KEY` secret. To use another provider, set the repository variable `LLM_PROVIDER` too. See "Choose a model" below. Not needed for milestone 0.
3. Open a free Resend account and verify a sending domain. Add `RESEND_API_KEY`. Only 2DayAI needs it; see "Turn on 2DayAI".
4. Run `npm run db:migrate` once locally to create the tables.
5. Run `npm run stage -- sources check` and remove any feed that fails from `config/sources.yaml`.

## First real run, for Davis

1. `.env` with `DATABASE_URL` and `LLM_API_KEY` (and `LLM_PROVIDER` if not OpenAI).
2. Write `config/readers/r01.yaml` from `r00.example.yaml` with your real email and profile. The file is gitignored and read only on your machine; the daily workflow reads the `READER_PROFILES` secret.
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
- the map's data at `/data/latest.json` and `/data/<date>.json`, and the day's local stories in tiles at `/data/local/<date>/<tile>.json` (decision 78): the files the daily run stores in R2, streamed as they are, or read from the database for a day with no stored file; cached for five minutes
- the 2DayAI reader pages

The Worker's config is `wrangler.toml` at the repository root. Its build step builds the map and drops the sample data, so a plain `npx wrangler deploy` from the root is a full deploy (decision 38). There are two ways to run it. Pick one: with both, every push deploys twice.

**Cloudflare's Git integration (Workers Builds).** In the Cloudflare dashboard, Workers & Pages, the Worker connected to this repository:

- The Worker's name must be `globalgist`, the `name` in `wrangler.toml`. A Worker with another name fails the build.
- Settings, then Build: root directory `/`, build command empty, deploy command `npx wrangler deploy` (the defaults).
- Settings, then Variables and Secrets: add `DATABASE_URL` as a secret, the same Neon pooled string as the GitHub secret.
- Leave `CLOUDFLARE_API_TOKEN` out of GitHub, so the "Deploy site" workflow skips. It still starts "Daily run" when it finishes.

**GitHub Actions.** Add the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Create the token from the "Edit Cloudflare Workers" template. After that, `.github/workflows/deploy-site.yml` deploys on every code change to `main` and copies `DATABASE_URL` into the Worker (decision 34). Disconnect the Git integration in the dashboard if it was set up.

To deploy by hand, run `npm run web:deploy`.

Set the repository variable `MAIL_FROM` to the verified Resend sender. Email links use the custom domain below, or `WEB_BASE_URL` when it is set.

### A custom domain

The site runs on the Cloudflare Worker, so the domain goes on Cloudflare, not GitHub Pages. Pages only serves static files, but the map's data comes from the Worker, and Pages on a private repository needs a paid GitHub plan (decision 37).

1. **If you tried GitHub Pages first:** in the repository's Settings, then Pages, remove the custom domain and set the source to none, so Pages stops publishing the repository. A Pages site is public even when the repository is private. Don't add a `CNAME` file back to the repository: it is how Pages claims a domain. At the registrar, delete any A, AAAA or CNAME records that point at GitHub (`185.199.108.153` to `.111.153`, or `<user>.github.io`).
2. **Put the domain on Cloudflare.** Either buy it in the Cloudflare dashboard (Domain Registration, sold at cost), and its DNS is on Cloudflare already. Or, for a domain bought elsewhere: Add a domain, pick the Free plan, then at the registrar replace the nameservers with the two Cloudflare shows. It is active when Cloudflare emails you, usually within an hour and sometimes up to a day.
3. **GitHub Actions deploy only: let the token manage the domain.** Edit the API token and give it, for that zone, Workers Routes: Edit and DNS: Edit. Without them the deploy fails at the custom domain with an authentication error.
4. **Attach the domain to the Worker.** With Workers Builds: the Worker's Settings, then Domains & Routes, then Add, then Custom domain, once for `globalgist.com` and once for `www.globalgist.com`; then set the repository variable `SITE_DOMAIN` to `globalgist.com` for the email links. With the GitHub Actions deploy: set `SITE_DOMAIN` to `globalgist.com` and run "Deploy site", which attaches the domain and `www.` to the Worker. Cloudflare creates the DNS records and the HTTPS certificate itself, which takes a few minutes. Don't add DNS records for them by hand: a record already on either name blocks the deploy, and has to be deleted first.

**The build knows the address.** The page's canonical address and its share image (decision 92) carry `globalgist.io`, written in `packages/map/vite.config.ts` (decision 94). A build variable `SITE_DOMAIN` under the Worker's Settings, Build, Variables overrides it, for a move to another domain.

The workers.dev address keeps working too. Email links follow `SITE_DOMAIN`, so `WEB_BASE_URL` can stay unset. With the domain on Cloudflare, it can also be verified in Resend for `MAIL_FROM`, for example `2DayAI <edition@globalgist.com>`: Resend lists the DNS records to add in Cloudflare.

The daily run needs no deploy: it stores the new day's file in R2, and the Worker serves it.

### The clock

GitHub's own schedule started the daily run hours late or not at all, and skipped refreshes for hours (decision 91). The Worker's cron triggers (`[triggers]` in `wrangler.toml`) fire on time and ask GitHub to start the runs: the daily run at 00:07 UTC, only if its day is missing, and the refresh every three hours at minute 41. GitHub's schedule stays only as the daily run's backup. The Worker needs one secret to do it:

1. **Make the token.** On GitHub, your picture, then Settings, Developer settings, Personal access tokens, **Fine-grained tokens**, Generate new token. Name it `globalgist-clock`, expiration one year (put a reminder in your calendar to renew it), Repository access **Only select repositories**: `capy`. Under Repository permissions set **Actions** to **Read and write**; leave everything else at No access (Metadata: Read-only is added by itself). Generate, and copy the token.
2. **Give it to the Worker.** In the Cloudflare dashboard: Workers & Pages, `globalgist`, Settings, **Variables and Secrets**, Add. Type **Secret**, name `GITHUB_DISPATCH_TOKEN`, value the token. Deploy. Secrets set there survive every later deploy.
3. **Check it.** In the same Worker, Settings, Trigger Events lists the two cron lines. After the next minute 41, the Actions tab shows a "Refresh local stories" run started by `workflow_dispatch`. A failed start shows in the Worker's Logs with the reason ("GITHUB_DISPATCH_TOKEN is not set", or "GitHub answered 401" for a token that is wrong or expired).

Until the secret is set, the refresh runs only after each daily run, and the daily run waits for GitHub's schedule.

### Map files in R2

A day's map is several megabytes. Building it from the database takes longer than the 10 ms of CPU a request gets on Cloudflare's free plan, so the daily run stores the finished file in R2 and the Worker streams it (decision 73). Since decision 78 the day's file holds the outlets' stories, the events and the word, tens of kilobytes, and the day's GDELT local stories go in tiles beside it: one file per 10-degree cell of longitude and latitude that has any, about 250 files and 10 to 15 MB (3 to 4 MB compressed) on a day of 40,000 to 50,000 local stories, stored as `local/<date>/<tile>.json`. The site asks for the tiles in view only when someone zooms in all the way. R2's free tier (10 GB stored, a million writes and ten million reads a month) covers this many times over.

1. **Turn on R2.** In the Cloudflare dashboard, open R2 Object Storage. The first time, Cloudflare asks for a payment method to activate R2, even on the free tier; nothing is charged within the free limits.
2. **Create the bucket.** Create bucket, name it exactly `globalgist-maps` (the name in `wrangler.toml`), location Automatic, storage class Standard. Leave public access off: no public bucket URL and no custom domain on the bucket. The Worker reads it through its binding, and nothing else needs to.
3. **Give the daily run a token that can write to it.**
   - With the GitHub Actions deploy: edit the token in `CLOUDFLARE_API_TOKEN` (My Profile, then API Tokens) and check it has Account, then Workers R2 Storage, then Edit. The "Edit Cloudflare Workers" template includes it. Nothing else to add.
   - With Cloudflare's Git integration: create a token with only Account, then Workers R2 Storage, then Edit, for this account. Add it as the GitHub secret `R2_API_TOKEN`, and add the account id as `CLOUDFLARE_ACCOUNT_ID`. Don't add `CLOUDFLARE_API_TOKEN`, or every push deploys twice.
4. **Deploy.** The next deploy binds the bucket to the Worker as `MAPS`. The next daily run stores the day's tiles under `local/<date>/` (with `wrangler r2 bulk put`, 20 at a time), then `<date>.json` and `latest.json`. To store today's files straight away, run "Daily run" from the Actions tab with the stage `local`, which takes a few minutes and costs no model calls.
5. **Optional: let old tiles expire.** Each day adds 10 to 15 MB of tiles. In the bucket's Settings, under Object lifecycle rules, add a rule for the prefix `local/` that deletes objects 30 days after upload. Without it the free 10 GB lasts about two years.

Check it worked: the bucket lists `latest.json` and a `local/<date>/` folder in the dashboard, and the "Store the map for the site" step of the daily run is green. Until the first file is stored, the Worker builds the day's file from the database with only the list of tiles, and each tile from the database when it is asked for.

## The world desk and the telegram

World sources are the `desk: world` entries in `config/sources.yaml`. Each one has the city it publishes from. The daily run does four things with them:

1. `cluster world` groups their articles into events. It keeps the newest `WORLD_PER_SOURCE` (default 15) articles per source and sends them in batches of at most `WORLD_CLUSTER_BATCH` (default 300), newest first so each batch mixes places. With more than one batch, one merge call names the batch events that report the same story, and code joins them after checking every key. The run report counts `batches`, `merged` and `mergeDropped`. If any batch fails, the stage fails and writes nothing.
2. `explain` explains events of importance 3 or more, at most `WORLD_EXPLAIN_MAX` (default 25).
3. `telegram` scores each explained event, computes the day's band, and picks the word from that band's list (decision 26).
4. `local` adds local stories from the towns none of them reached (decisions 54, 67 and 78). It reads the day's GDELT files (one every 15 minutes, English and translated, about 192 a day) and takes the newest `GDELT_PER_TOWN` stories (default 2; 0 turns the stage off) of every town GDELT tags, every town's newest before any town's second. `GDELT_MAX` (default 80,000) is a safety valve, not the day's limit: a normal day is expected at 25,000 to 45,000, and the summary says how many it left out if it ever binds. A town within 3 km of a place with an outlet's story is that place and gets none; the next municipality gets its own. Set either as a repository variable to change it. No model is involved. Run it alone with `npm run stage -- local --date <date>`. If GDELT is down the day still goes out, and the summary says so. The run report's `townsTagged` is how many towns GDELT's articles were placed at that day.

GDELT's towns are checked against the city list and GeoNames' places of 1,000 people or more, with every seat of local government however small (`packages/pipeline/data/towns.txt`, 164,257 towns). Rebuild that file with `npm run towns:build` when you want newer GeoNames data: it reads a pinned copy from PyPI and checks its checksum, so update the URL and checksum in `packages/pipeline/scripts/build-towns.ts` together.

Feeds look after themselves (decision 36):

- A feed found behind a homepage is remembered in the `sources` table, so later days fetch it directly. Changing the outlet's URL in `sources.yaml` forgets it.
- A feed that fails 7 days running is paused and tried again each Sunday. One success resets it. `fail_streak` and `last_ok_at` in `sources` show where each outlet stands.
- The daily summary lists failing feeds worst first. Replace or remove an outlet that stays paused, and keep the list balanced (see the add-news-source skill).

If a busy day's grouping answer runs past the model's output limit, that batch is split in half and asked again, up to three times, before the stage fails.

To look at a day without the site:

```
npm run stage -- map export --date 2026-09-27 --out /tmp/map.json
npm run stage -- coverage --date 2026-09-27
```

`map export` writes the day's local stories as tiles in `local/<date>/` beside the file (here `/tmp/local/2026-09-27/`); `--manifest f` also lists them for `wrangler r2 bulk put`.

To see the whole site with no database, no key and no network, run `npm run map:sample`, then `npm run map:dev`. The first command runs the fictional world fixture through the real stages in memory and writes `packages/map/public/data/sample.json`.

The telegram makes a score call and a word call, and code checks each one:

- The score call must score every event and copy one of its verified sentences as the reason. It runs `TELEGRAM_SCORE_RUNS` times (default 3), one after another, and each event keeps its middle score with the reason from a run that gave it (decision 36). The run report's `split` counts events the runs disagreed on. Set the repository variable to 1 to save about two cents a day.
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
| `LLM_SERVICE_TIER` | `flex` for OpenAI (half price, slower; falls back to the default tier when refused) | `default` |
| `DAILY_SPEND_CEILING_USD` | `1.00` | |

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

Copy `packages/core/prompts/<name>.v<n>.md` to `v<n+1>`, edit the copy, point the stage at the new version. Attach a before-and-after run on the same past date to the pull request. docs/PROMPTS.md explains each prompt, what is sent around it, and what code checks after it.

## Rotate a key

Replace the secret in GitHub, then in `.env`. Nothing in the repository holds a key. CI runs a secret scan on every push.

## Watch spend

`select sum(cost_usd) from llm_calls where run_date = current_date;`

The daily workflow fails when a day passes `DAILY_SPEND_CEILING_USD`.
