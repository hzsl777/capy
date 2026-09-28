# CONTEXT.md, capy

Read this first in any new session. It is the whole picture as of September 27, 2026: where the ideas came from, what was decided, what is built, what is not, and what happens next. The detailed documents it points to are docs/SPEC.md, docs/DECISIONS.md, docs/RUNBOOK.md, and docs/BRAINSTORM.md.

## 1. Who and why

Davis H.S. (pen name; GitHub hzsl777) is a CPA-track accountant and tax operator, finishing a B.B.A at Francis Marion University, relocating to New York City. Davis works in multi-entity accounting and tax and already uses Python, n8n, and local AI tools at work. Davis's professional site and publication is Three Angle Press (hzsl777/hzsl777.github.io). Capy is separate from that site and not bound by its rules, with two exceptions Davis keeps everywhere: no em dashes, ever, and prose passes the deslop discipline (lead with the answer, one idea per sentence, stable terms, no hedge stacks, no quality adjectives without a mechanism or number).

Davis's standing instruction for this project, verbatim in spirit: this has to be an actual product that is useful and works, is actually AI, and is not just lying. Not vibe-coded. Decide the engineering up front so nothing is rebuilt.

## 2. The two ideas, in Davis's words

2DayAI (September 4, 2026). People feel bombarded by news. Use AI compression, driven by a robust interest survey that tailors over time, to get the day's news down to one concise headline you can click into and see the stories and explanations. One word or one sentence, built around the user's interests and perhaps their feeds elsewhere.

Capy (the original prompt, relayed September 27, 2026). Like Radio Garden, but for news: a globe or map where you go anywhere and see what is being published there. Black and white paper map to match a newspaper vibe, or 3D like Radio Garden; something like the Victoria game series crossed with newspaper design. All content ingestion free, free to make, publicly facing. Do not specifically name any country given geopolitical news; get to specific articles by region. Objective for everyone, no controversy in the UX itself. Davis's own fold: the 2DayAI headline becomes the "telegram headline" per place on the map.

## 3. What was decided, with Davis, in order

September 4, 2026, brainstorm and spec:

- First audience is professionals with a stake in the news (finance, tax, law, policy), because that is Davis's own use case, then generalize to everyone.
- The name 2DayAI means "today", not "two-day".
- The AI writes the headline. No human editor pass, no templates. The guardrail is the citation chain.
- Next steps were: a spec, then a prototype, with the engineering decided up front.
- Stack: whatever is best practice long term. Chosen: TypeScript on Node 22, one language across pipeline and web.
- Budget: zero until the concept proves itself, then a little at a time. The only unavoidable cost is the model call.
- Model: Sonnet 5 for the prototype, on cost. One config value.
- Repository: a new one, separate from the site.
- Builder: Claude builds the scaffold; Davis and Claude iterate on judgment cases; review passes from other models (Codex, Grok) at defined handoffs.
- Davis is reader one and the lab rat. Onboarding, the profile format, and the selection prompt are shaped on Davis before anyone else.
- Delivery hour per reader from the start.

September 27, 2026, the fold:

- Capy is the home. The 2DayAI pipeline is the objective layer the map needs, so one pipeline, two products, one database.
- The map is deferred until 2DayAI holds up for a week with Davis as reader one, so the second product does not starve the first.
- Pins are publishers, placed where they publish from, as Radio Garden places stations. Not where events happen. This needs no geocoding and never labels a disputed place.
- The map draws coastlines only. No borders, no country names.
- 2D paper map first, a globe later if wanted. Capy is not bound by Three Angle Press's zero-JS rule.

September 27, 2026, later the same day (decision 25):

- Build the working site now, integrated with 2DayAI. This reverses the "after milestone 4" timing above.
- One word heads the site and sums up the day's conflict reporting worldwide. The code calls it the telegram. The events behind it, their sourced explanations and the sources sit one click down.

September 28, 2026 (decision 26):

- The word is the emotion the day's stories evoke, read from all world news, not only conflict.
- A formula sets it. The model scores each event from -2 to 2 by what happened to people. The worst significant event decides a bad day (Davis: "we have to be very careful here"). The model then picks the word from a fixed list for that step on the scale from Grave to Good.
- The public site is called GlobalGist (decision 27). The repository stays capy.

September 28, 2026 (decision 28):

- Keep it as cheap as possible, with no paid Anthropic key, while the word stays a reliable read of the day. Test models side by side on real days and pick the cheapest one that reads the day right.

Everything numbered is in docs/DECISIONS.md (decisions 1 to 12 in the spec, 13 to 29 in DECISIONS.md). A reversal is a new entry, never an edit.

## 4. What the product is

One content model, three presentations. The reader who wants simplicity stops at the top. The reader who wants depth keeps going and finds the same facts, not a different article.

| Level | What the reader sees |
|---|---|
| 0 | The headline. One word to fifteen words. The subject line of the email. |
| 1 | Three to five events, one line each, plus a "left out today" list with a five-word reason and a link to say it should have been in. |
| 2 | One event explained: what happened, why it matters, what changes next. Every sentence carries a numbered citation. Plus one labeled paragraph on why it matters to this reader. |
| 3 | The sources: article, publisher, date, and the quoted passage that supports each sentence. |

Headline rules: declarative, no question, no exclamation, no colon-led teaser, no withheld subject, at most fifteen words. A quiet day is a legitimate headline ("Nothing today needs you."). The product must be willing to say nothing happened; manufacturing urgency is the bombardment it claims to fix. Subscription, not ads, for the same reason.

The interest model in version 0 is a hand-written YAML profile per reader: topics with weights 1 to 5, muted topics, stake facts in plain sentences, timezone, delivery hour. Feedback (more, less, wrong, promote) is recorded and read by Davis weekly; version 1 turns it into weight adjustments. One slot per edition is reserved for the highest-importance event outside the reader's interests, labeled, so the line never becomes a bubble.

## 5. How it does not lie

This is the spine and it is not optional.

1. Explain returns sentences as objects, each with citations: an article id and a verbatim excerpt.
2. Code checks each citation on its own: the excerpt must appear verbatim (whitespace and curly quotes normalized, at least twelve characters) in that article's stored text. Failing citations are dropped individually, so an invented excerpt never survives beside a real one.
3. A sentence with no surviving citation is dropped.
4. An event with fewer than three surviving sentences is unusable and cannot be selected for anyone that day.
5. Select and the headline are generated from the verified sentences of usable events only, never from raw articles.
6. The stake paragraph is written from the profile and cannot be verified against a source, so the page labels it: "Written from your profile, not from the sources."
7. Every citation the model offered is kept in an audit table with its verified flag.
8. A dead model stage stops the day. It never turns into a quiet edition.

## 6. Architecture

Three runtimes on free tiers, one language, one database as the contract between them.

| Part | Runs on | Job |
|---|---|---|
| Pipeline | GitHub Actions cron, 09:00 UTC daily; delivery every two hours | ingest, enrich, readers sync, cluster, explain, select, deliver |
| Database | Neon Postgres | every artifact of every run, plus feedback and spend |
| Web | Cloudflare Worker (Hono) | the public map (static build of packages/map) and its data from the database. 2DayAI reader pages and feedback (server-rendered, no client JS) |

Packages, with import boundaries enforced by tools/check-boundaries.mjs:

- packages/core: pure code. Zod schemas, validators (headline rules, citation verification), renderers, versioned prompt files. Imports nothing from the workspace, no Node APIs.
- packages/db: Drizzle schema, migrations, shared read models (loadEditionView, recordFeedback). Imports core. @2dayai/db/node holds the postgres-js client.
- packages/pipeline: stages, CLI, the model module in src/llm/ (the only place the Anthropic SDK is imported). Imports core and db.
- packages/web: the Worker. Imports core and db.
- packages/map: the public map site (Vite, canvas, d3-geo). Imports core's types only and reads its data from the Worker over HTTP.

Model layer: every call declares a Zod schema, and a bad response fails at the boundary. The provider is config (decisions 28 and 29): OpenAI's gpt-5.4-nano with gpt-5.4-mini for the word by default, over the OpenAI chat format with the schema in the prompt and Zod checking the answer. Anthropic stays available with structured outputs, effort per stage (cluster low, explain medium, select high) and the Batches API (half price, up to an hour of latency, LLM_BATCH=false for immediate local runs). Every call logged with tokens, cache reads and writes, and cost; the day fails loudly past DAILY_SPEND_CEILING_USD. Prompts are versioned files in packages/core/prompts; editing one in place is a bug; outputs record the version.

Idempotency: every stage re-runs per date and overwrites its own output. Two guards: select never replaces an edition already sent; cluster refuses to run for a date with a sent edition unless forced, because re-clustering breaks the links in that email. Feedback survives every re-run.

Cost estimate, Sonnet 5, ten readers, batched: about 0.40 USD a day. One reader: about a third of that.

## 7. What is built and verified

Milestones 0 through 3, three build commits plus a review round, merged onto capy's initial commit on September 27, 2026.

- Ingest from RSS with a 24-hour window ending 09:00 UTC per run date; article pages fetched and extracted with Readability for citation text.
- Cluster in one model call; unknown article ids from the model are dropped and counted.
- Explain, batched, with the verification above.
- Select per reader, validated in code (ids exist, no duplicates, no overlap, one outside-interests slot, at least three when three exist, headline rules), one retry with the problems spelled out, then a loud failure.
- Deliver by the reader's local date and hour through Resend; every unsent edition considered, so evening hours in American time zones send after UTC midnight.
- Worker: edition page, event page with numbered citations and quoted excerpts, feedback as a GET confirmation form and a POST write, scoped to the reader's own edition.
- World desk (decision 25): world sources pinned at the city they publish from, `cluster world` with a topic per event, and explanations for events of importance 3 or more, up to a cap.
- Telegram (decision 26): the model scores every explained event and quotes a reason. Code computes the day's band, where the worst significant event decides a bad day. The model picks the word from that band's fixed list. Code checks every step.
- The map site (packages/map): three designs, flat and globe, and the word under the masthead. The drill-down goes from the word to its events, then to explanations with numbered citations to the quoted sources. The Worker serves the site and builds its data from the database (`/data/latest.json`).
- CLI: sources check, ingest, enrich, readers sync, cluster [--force], cluster world, explain, select, telegram, show, deliver [--dry-run], day [--fixture], map export, demo, spend, feedback.
- CI: boundaries, typecheck including the Worker and the map, tests, the map build, secret scan. Tests run whole days on PGlite (a real Postgres engine) with the real migrations and a scripted model, including the world desk, the telegram retry and the Worker's map endpoints. No network, no key.

An independent adversarial review found eight real defects before any live run (fabricated excerpt beside a verified one, evening delivery never sending, dead stage shipping as a quiet day, re-runs resending, spend undercount, empty env strings, Worker input handling, feedback on GET). All fixed with tests; decision 22.

## 8. What is not done, plainly

- Nothing has run against the live model or live feeds. The sandbox that built this could not reach any news host and held no API key.
- The fourteen starter feeds in config/sources.yaml are unverified. Run sources check and prune.
- No reader profile exists yet. config/readers/r01.yaml is Davis's to write from r00.example.yaml.
- No Neon database, no Resend account, no Worker deployment yet.
- The prompts (cluster.v1, explain.v1, select.v1) have never produced output. Expect a v2 of each after the first real week.
- The headline evaluation set (twenty rated headlines) is deliberately deferred until real editions exist.
- The world-desk feeds in config/sources.yaml (eighteen outlets) are unverified, like the briefing list. Run sources check and prune.
- The telegram and world-cluster prompts (telegram-score.v1, telegram-word.v1, cluster-world.v1) have never produced output. Judge the first real scores and words before trusting them.
- No model has been chosen. The default is OpenAI (decision 29, from a research pass), and decision 28 says to confirm it with eval reports on real days first.
- No Cloudflare secrets yet, so the deploy-site workflow skips. The site has run only locally, on the fictional sample.

## 9. Milestones

| Milestone | Delivers | State |
|---|---|---|
| M0 | Workspace, schema, ingest, CLI, CI | done |
| M1 | Cluster and explain with verified citations | done |
| M2 | Davis's profile, select, headline printed to the terminal | code done; profile and first run pending |
| M3 | Resend delivery, Worker pages, feedback | code done; accounts and deploy pending |
| M4 | Tuning loop: Davis rates headlines and drill-downs daily for a week; prompts revised by version | not started |
| M5 | Nine more readers, two weeks | not started |
| Map | World desk, publisher pins, the mood telegram, map site served by the Worker | code done (decisions 25 and 26); feeds, secrets and first live run pending |

After M5 the decision is: build the learned interest model, or stop.

## 10. Davis's next steps, in order

1. Add repository secrets: DATABASE_URL (free Neon project), LLM_API_KEY (OpenAI by default, decision 29), RESEND_API_KEY (free Resend account with a verified sender). Set repository variables WEB_BASE_URL and MAIL_FROM once the Worker is deployed.
2. Locally: copy .env.example to .env with the same values. Then choose the model by measurement: run the "Model eval" workflow on two or three real days and read the reports (docs/RUNBOOK.md, "Choose a model").
3. Write config/readers/r01.yaml with a real email, timezone, delivery hour, weighted topics, muted topics, and stake sentences.
4. npm run stage -- sources check; remove what fails.
5. npm run db:migrate, then npm run stage -- day --fixture --date 2026-09-04, then npm run stage -- show --reader r01. That is the first real headline on three known articles, for a few cents.
6. A real day: npm run stage -- day, then show. Judge on the three phase-one conditions: the headline reads as true and worth the glance; the drill-down holds without a false claim; the aggregation catches what Davis wanted and leaves out what Davis would skip.
7. Deploy the site and Worker: add CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID, then push to main (docs/RUNBOOK.md, "Deploy the site"). Then deliver for real.
8. Hand docs/SPEC.md and the three prompts to Codex and Grok for the defined review passes (spec section 11). Record accepted changes as new decisions.

## 11. How to work in this repository

- One decision, one entry in docs/DECISIONS.md. Reversals are new entries.
- A prompt change is a new version file plus a before-and-after run on the same past date attached to the pull request.
- Every model output passes a Zod schema at the boundary. No JSON parsing outside packages/pipeline/src/llm.
- Tests never call the network. Use fixtures and the FakeLlm.
- No secrets in the repository, ever. A secret scan runs in CI.
- No em dashes anywhere, in code comments, docs, prompts, or rendered output. The test suite checks rendered HTML for them.
- Reviews from other models are inputs. Davis decides. Claude implements.

## 12. Related places

- hzsl777/hzsl777.github.io, branch claude/2dayai-news-compression-x9e0bz, pull request 6: the original brainstorm and spec drafts under docs/ideas/, now superseded by the copies in this repository's docs/. That branch needs nothing further.
- Three Angle Press rules (voice, design, no resume) do not apply here except the em dash rule and the deslop discipline.
