# Decisions

One entry per decision. A reversal is a new entry that names the one it reverses. Never edit an entry.

Decisions 1 to 12 are stated in full in SPEC.md sections 4 and 5. This file records what changed after the spec was written.

## 13. Boundary rule is a script, not an ESLint plugin (September 4, 2026)

SPEC.md section 8 said an ESLint boundary rule. Milestone 0 uses `tools/check-boundaries.mjs`, forty lines with no dependencies, run as `npm run lint`. Reason: one fewer toolchain to configure and the rule is readable in full. Revisit when a real linter is added.

## 14. Web package excluded from the root typecheck (September 4, 2026)

The Worker compiles against Cloudflare types, not Node types. It has its own tsconfig and is checked by `wrangler` at deploy. The root `npm run typecheck` covers core, db, and pipeline.

## 15. Starter source list is unverified (September 4, 2026)

The build environment could not reach any news host. `config/sources.yaml` ships with the candidate list and `npm run stage -- sources check` exists so the list can be verified locally in one command. Davis owns the list.

## 16. Article pages are fetched for text (September 4, 2026)

Feeds mostly carry a title and a lead, and a citation needs a passage to point at. The enrich stage fetches each article page once, extracts the main text with Readability, and stores up to 30,000 characters. The page text is used for verification and for quoted excerpts, never republished whole. A page that yields nothing leaves the article with what the feed gave.

## 17. Delivery is its own hourly job (September 4, 2026)

The day runs once at 09:00 UTC. Delivery runs every hour and sends editions whose reader's local hour has reached their delivery hour. This is how "per reader, from the start" costs nothing: one more cron line.

## 18. Feedback survives re-runs (September 4, 2026)

Re-running cluster for a date deletes that date's events and everything derived from them, except feedback. Feedback keeps the event title and drops the id. Reader signals are never destroyed by a prompt change.

## 19. Tests run on a real Postgres engine (September 4, 2026)

Integration tests use PGlite with the real migrations. The model is a scripted fake behind the same interface as the real client. The suite runs with no network and no key, and exercises the schema, the cascades, the citation check, the selection validator, the retry, and delivery idempotence.

## 20. The stake paragraph is labeled (September 4, 2026)

The paragraph on why an event matters to this reader is written from the profile and the verified sentences. It cannot be verified against a source the way the explanation can. It is labeled on the page: "Written from your profile, not from the sources." The honesty boundary is visible, not hidden.

## 21. Selection is validated and retried once (September 4, 2026)

The model's selection is checked in code: every id must be a usable event, no duplicates, no overlap between selected and rejected, at most one outside-interests slot, at least three chosen when three exist, and the headline rules. Problems are sent back once with the errors spelled out. A second failure fails that reader's edition loudly rather than shipping a bad one.

## 22. First adversarial review, eight findings fixed (September 4, 2026)

An independent review of the whole tree found eight real defects before any live run. All are fixed and each has a test.

1. A sentence citing one real passage and one invented passage kept both; the invented excerpt would have been quoted on the page. Now every citation is checked on its own and only the passing ones survive.
2. Evening delivery hours in American time zones never sent, because delivery filtered by the UTC run date. Delivery now considers every unsent edition and sends once the reader's local date and hour have passed the run date's delivery hour.
3. A dead model stage turned into a quiet day for every reader. Explain now stops the day when requests fail and nothing is usable, and select refuses to write quiet editions while failed explanations exist.
4. Re-running select replaced an edition already in a reader's inbox and sent it again; re-running cluster broke its links. Select skips readers with a sent edition. Cluster refuses to run after a send unless forced, and says so.
5. Spend under-counted: cache writes were never priced. They are now, at 1.25 times the input rate.
6. An unset GitHub Actions variable arrives as an empty string and broke config defaults. Empty strings are treated as absent.
7. The Worker accepted non-numeric ids and impossible dates, and recorded feedback for any event. Ids and dates are validated, and feedback is accepted only for an event in that reader's edition on that date.
8. Feedback links were plain GETs, which mail link scanners would trigger. GET now shows a one-button form; POST records.

Also from the review: the Worker was excluded from the CI typecheck. It is included now.

## 23. The code lives in capy, alongside a second product (September 27, 2026)

Davis's capy idea is a Radio Garden for news: a public map where a place shows what is being published there. The pipeline built for 2DayAI is the objective layer that map needs, so the code moves into hzsl777/capy rather than a repository of its own. 2DayAI and the map are two thin products over one pipeline and one database. The map is deferred until 2DayAI holds up for a week with Davis as reader one (milestone 4), so the second product does not starve the first.

Three design points fixed now so the pipeline does not need rework later:

1. Pins are publishers, placed where they publish from, not where events happen. This is how Radio Garden places stations. It needs no geocoding, and it never labels a disputed place. The source list gains a latitude and longitude per source when the map starts.
2. The map draws coastlines only. No borders, no country names. The unit of place is the publisher pin and a region radius around it.
3. The region's telegram line is the 2DayAI headline with the reader replaced by a place: a sibling of the select stage that runs per region instead of per profile. Level 1 (titles and links) is free everywhere; explanations and the telegram line are generated only for the top events per region, so model spend scales with regions shown, not with articles ingested.

Capy is private, so Actions has 2,000 free minutes a month. Delivery moves to every two hours and dependencies are cached to fit.

## 24. A map prototype exists ahead of decision 23's schedule (September 27, 2026)

At Davis's request in a parallel session, a working map prototype was built before milestone 4 and merged here as `packages/map`. Decision 23 stands as the plan of record. The prototype is a design study: three looks (Morning Edition, Cabinet Map, Wire Room), flat and globe views, the crosshair and panel, an in-app reader, story arcs across places, a replay slider and topic filters. It is not deployed, and its deploy workflow runs only by hand.

It runs on stand-in data: the free GDELT index, read by `packages/map/pipeline`, with each article placed at the first city it mentions. Before the map ships, it changes to match decision 23:

1. Pins become publishers, at the places they publish from. The source list gains coordinates and the prototype's GDELT placement (`choosePlace`) is retired. The prototype's RSS adapter already pins each source to its home city.
2. Each region shows its telegram line, generated by the region sibling of select from verified sentences only, and labeled as generated. The headlines under it stay as published.
3. The map reads the shared database through a read model instead of its own static JSON. Whether a static export stays, to keep hosting free, is decided then.

Kept from the prototype and consistent with decision 23: no borders and no country names, coastlines and physical features only. Also kept: no text drawn on the map itself, outlets balanced within each place, and a reader that shows the outlet's own preview and frames the full page only when the outlet allows it.

Until the map work starts, `packages/map` imports nothing from the workspace.

## 25. The map ships now, on the shared pipeline, with a one-word conflict telegram (September 27, 2026)

Davis asked for the working site now, integrated with 2DayAI, headed by one word that sums up the day's conflict reporting worldwide. This reverses the timing in decision 23 (map after milestone 4) and carries out decision 24's three changes.

1. Desks. Sources carry `desk: briefing` (2DayAI editions, unchanged) or `desk: world` (the map), and world sources carry the city they publish from. Pins are publishers, as decision 23 fixed. The map's GDELT stand-in is removed.
2. World clustering is its own stage and prompt (`cluster world`, `cluster-world.v1`) with a topic per event, so the briefing prompt and its behaviour stay as they were. Select only sees briefing events.
3. Explain covers every briefing event, and world events that are about conflict or of importance 4 or 5, at most `WORLD_EXPLAIN_MAX` (default 25) a day, to keep spend in line with decision 23's "spend scales with what is shown".
4. The telegram is a sibling of select that runs once for the world. The model picks one to five conflict events and one word. Code rejects the word unless it is a single word, appears in the verified sentences of the chosen events, is not a proper noun there, and is not on a short list of contested or alarm words. One retry with the problems listed, then the stage fails loudly. "Quiet" is reserved for a day with nothing above routine. No verified conflict reporting means no word at all, never "Quiet". Why one word: it is 2DayAI's level 0 taken to its limit, and lifting it from checked sentences keeps it from carrying a verdict the sources did not state.
5. Hosting. The Worker serves the map's static build and its data (`/data/latest.json`) from the database through `loadMapView`, so the site is live the moment the daily run finishes, the repository can stay private, and there is no export job. `map export` exists for inspection and `demo` builds the sample data by running the fictional fixture through the real stages.
6. The map's neutrality rules now allow generated text in two places only, both from verified sentences and both labelled: the telegram (word and lines) and event explanations. Headlines stay as published.

## 26. The word is an emotion on a scored scale, read from all world news (September 28, 2026)

Davis asked for the daily word to be the emotion the day's stories evoke, set formulaically on a spectrum from bad to good, with the score feeding the model's choice. This replaces point 4 of decision 25 (a word lifted from the sources, conflict events only).

1. Scope: every explained world event, not only conflict. Explain now covers world events of importance 3 or more, most important first, up to the cap, so good news has explanations to be scored from.
2. Score: the model scores each explained event from -2 to 2 by what happened to people (loss of life or mass displacement at -2, lives saved or a lasting agreement at 2), never by which side gained, and copies one of the event's verified sentences as the reason. Code rejects a missing, duplicate or uncopied reason.
3. Formula, in code: when any significant event (importance 3 or more) scored below zero, the worst of them sets the day. Davis chose "worst event decides" so that good news never averages a tragedy away. Only a day with nothing significant below zero is averaged, weighted by importance.
4. Word: the model picks from a fixed list for the band (Grave, Hard, Mixed, Hopeful, Good), with four emotion words each in `MOOD_WORDS`. On a bad day it must list the event that set it. Code rejects anything else. Changing a list is a new decision.
5. Two model calls instead of one (`telegram-score.v1`, `telegram-word.v1`), each with one retry. The retired `telegram.v1` never produced output and is removed.
6. The site shows the scale beside the word and, one tap down, every event's score with its reason. The mood score is the only sentiment signal anywhere: it never orders headlines or changes how a pin looks.

## 27. The public site is called GlobalGist (September 28, 2026)

Davis named the site GlobalGist: the gist of the whole world's news, which is what the one word gives. TeaGlobe and plain Gist were considered the same afternoon. GlobalGist keeps the idea and stands apart from GitHub Gist and "The Gist" podcast and newsletter, which helps with a domain and with search. The name and tagline are set once in `packages/map/src/brand.ts`. Every design's masthead, the page title and the about text use them. The per-design publication names (The Capy Dispatch, Atlas of Current Events, CAPY/WIRE) are gone. The repository and package names (capy, @capy/map) are internal and unchanged. 2DayAI keeps its name for the email product.

## 28. The pipeline runs on the cheapest model that reads the day right, chosen by measurement (September 28, 2026)

Davis wants the site as cheap as possible without a paid Anthropic key, while the word stays a reliable read of the day. This replaces spec decision 8's model choice (Sonnet 5). Decision 7 still holds: model code lives only in `packages/pipeline/src/llm/`.

1. Visitors cost nothing in model calls. The pipeline runs once a day and the site serves stored results, so spend depends on the day's news, not on traffic.
2. Provider is config: `LLM_PROVIDER` is deepseek (the default), gemini, openrouter, openai-compatible or anthropic, with `LLM_API_KEY` and an optional `MODEL`. Every provider but Anthropic uses the OpenAI chat format over plain `fetch`, with no new dependency. These APIs have a JSON mode but no schema-constrained output, so the stage's JSON Schema goes into the system prompt and Zod checks the answer. A bad answer fails at the boundary as before, and every rule in code (citations, scores, the word) is unchanged.
3. `MODEL_TELEGRAM` lets the two telegram calls use a stronger model than the bulk stages. Clustering and explaining use most of the tokens. The telegram uses few tokens and needs the most judgment.
4. `npm run stage -- eval` (and the manual "Model eval" workflow) runs several setups on one saved day of world articles, each on its own in-memory database, through the real cluster world, explain and telegram stages. The report gives cost, how many explanation sentences survived the citation check, retries, the word and band, and every score with its reason, so Davis can judge the diagnosis and not only the price. The model is chosen from these reports, one real day or more, before going live.
5. Without Anthropic there is no batch discount and no effort setting. Per-event calls run four at a time. The daily spend ceiling drops to $0.25.
6. Known risk: deepseek-chat caps output at 8K tokens, and the cluster world answer lists every article once. A busy day can pass that, and the stage then fails loudly. The eval shows whether it happens. The fix would be a model with more output room for that stage, or splitting the call.
7. DeepSeek and Gemini prices in `pricing.ts` are the last known list prices and were not checked from this session. The provider's bill is the real figure.

## 29. OpenAI's small models are the default, from a research pass (September 28, 2026)

Davis asked which model is best for cost and for a correct read of the day. Four web research passes covered DeepSeek, Gemini, the other cheap providers, and quality evidence. Most figures came from search results because the session's network blocked the providers' own pages, so they need checking. This changes point 2 of decision 28 (DeepSeek as the default) and corrects points 6 and 7.

1. Default: `gpt-5.4-nano` for cluster world and explain, `gpt-5.4-mini` for the two telegram calls, with reasoning on for the telegram only (`LLM_THINKING`). On the Vectara leaderboard for faithful summaries (September 22, 2026), nano had the lowest hallucination rate of any model checked (3.1%) and mini 5.5%. Explanations must quote sources word for word, so this rate is the closest public measure of what the explain stage needs. The estimated cost is about $0.10 to $0.15 a day.
2. `gpt-6-luna` (released September 22, about half nano's price) is the first challenger in the default eval. It has no faithfulness numbers yet.
3. DeepSeek is not the default. `deepseek-chat` and `deepseek-reasoner` were retired on July 24, 2026, and the current ids are `deepseek-flash` and `deepseek-v4-pro`. NIST (2025), CEIAS (April 2026) and LatticeFlow (September 2026) found Chinese-state positions in DeepSeek, Qwen, Kimi and GLM weights, not only in their hosted services. For a neutral map, that rules them out for explanations and the word. DeepSeek stays in the eval for grouping only, where it is cheap and strong on long input. Its peak hours (06:00 to 10:00 UTC on weekdays) cover the 09:00 run and double its price.
4. Gemini is not recommended. The 2.5 models refuse new projects since September 18. The 3.x Flash models score worse on faithfulness than 2.5 Flash-Lite, and Gemini's RECITATION stop ends answers that reproduce source text word for word, which is how our explanations work. Forum reports also describe frequent 503 errors.
5. Mistral Small (EU) is the fallback from a different vendor. gpt-oss-120b on Groq is cheap but scored 14.2% on Vectara.
6. The same models are available with half-price batch or "flex" processing on OpenAI. That is not wired up yet.
7. The research also found that model raters disagree with themselves across runs. Scoring each event more than once and taking the median would steady the word. This is a candidate change to the telegram, for Davis to decide after the first real days.

## 30. Zoomed out, the map shows widely reported or important stories first (September 28, 2026)

Davis wants the map to scale up by importance as you zoom out, with every story still there when you zoom in. This changes neutrality rule 3 in packages/map/AGENTS.md ("no ranking of headlines") for one purpose only: which places show at which zoom.

1. Zoomed out (level 0), a place shows when one of its stories was reported from three or more places, or the grouping model rated its event 4 or 5. Level 1 adds two places or importance 3. Level 2, the closest zoom, shows everything. Davis chose "both combined" over reach alone, knowing that the model's importance now decides part of what the public sees first.
2. It decides visibility only. Lists stay newest first, dot size stays report count, and the fresh colour stays "reported in the last hour". A place's panel at a wide zoom lists that level's stories and says how many more show as you zoom in, with a link to show them.
3. Nearby places merge into one dot by screen distance, sized by their combined count, with a thin inner ring. Its panel names every city in it. It never names a region.
4. A day without event data (a demo, or a day before grouping ran) shows every place at every zoom.
5. Also in this change: the map turns on its own from a random longitude until a place lands under a small reticle, stops on any touch, and turns again after a minute without input. This replaces Shuffle.

## 31. Hundreds of local outlets, batched grouping, and feeds found automatically (September 28, 2026)

Davis wants stories from as many places as possible. Pins stay at the publisher's city (decision 23), so coverage grows by adding outlets.

1. The world desk grows from 18 outlets to 237 in 209 cities, gathered by web search across six regions with the balance rules of add-news-source. State media is marked in comments. Known gaps: no outlet inside Sudan (the two independent Sudanese outlets publish from Amsterdam and Paris), none for Belarus, Moldova or Nicaragua, and exile outlets are pinned where they publish, not where they report on.
2. The search budget ran out partway, so about 150 entries point at the outlet's homepage. Ingest now fetches the configured URL, and when it is a web page, follows the feed link the page declares, or tries a few common feed paths. Only a response that parses as RSS or Atom counts. `sources check` prints the feed it found, so the list can be corrected, and an outlet with no findable feed simply fails and is left off the map that day.
3. Ingest fetches eight feeds at a time.
4. `cluster world` keeps the 15 newest articles per outlet (was 25), groups them in batches of 300, and then runs one small merge call (`cluster-world-merge.v1`) that joins batch events reporting the same story. Code checks every merge group, drops an invalid one rather than guessing, and deletes the previous day's world events only after every call succeeds.
5. Estimated cost with the decision 29 default rises to roughly $0.25 to $0.40 a day at full coverage. `eval` measures the real figure.

## 32. Five designs, and Map / Globe (September 28, 2026)

Davis kept Morning Edition and Cabinet Map, asked for Wire Room in green and black, and added two looks. The designs sit in one menu so the toolbar stays short.

1. Wire Room: phosphor green on black, a VT323 masthead, scanlines.
2. Ops Room: a situation display in slate with one cyan, condensed sans-serif, a fine plotting grid. It borrows the look of operations software, not its symbols: no friend or foe colours, nothing that assigns sides.
3. Blueprint: a cobalt drafting sheet with white linework and hand lettering, orange for fresh reports.
4. The view toggle reads Map / Globe. The globe is shaded as a lit sphere with a halo. The printed designs frame the map with a double neatline.
5. Toolbar: Shuffle is gone (the spin replaces it, S still spins), Translate appears only where the browser can translate, Pinned only once something is pinned, "How this works" is a quiet "About" on the right, and the word is the one control for opening its reasons.

## 33. Launch: fewer fetches, fewer tokens, and a preflight (September 28, 2026)

Davis wants the site shipped tonight or tomorrow morning, with the code and the pipeline as lean as they can be and model spend as low as quality allows.

1. The daily run fetched the full page of every article before grouping, up to 3,500 pages a day at 237 outlets. It now fetches only what a stage reads: briefing articles before the briefing is grouped, and after grouping, the articles of the events explain will quote. That is a few dozen to a few hundred pages.
2. With no reader profiles, the 2DayAI briefing (its grouping and explanations) is skipped, so the map's world desk runs alone.
3. Model tokens. `cluster-world.v2` keeps every rule of v1 and asks for a skip reason of at most four words and an importance reason of at most eight, because those reasons are output across hundreds of events. Each article sends its headline, outlet and the first 200 characters of its summary (was 400, plus the place). World explanations read up to 16,000 characters of source text (was 45,000); briefing explanations keep 45,000.
4. OpenAI calls ask for the flex tier, half price for slower answers, and fall back to the default tier when flex is refused, so a discount can never fail the day. Cost logs record which tier served each call.
5. Estimated spend at full coverage on the decision 29 models: roughly $0.10 to $0.20 a day. The daily ceiling rises to $1.00 so it stops a runaway day and not a normal one.
6. `npm run stage -- llm check` sends one tiny call per configured model. The manual "Preflight" workflow runs it with the migrations and a full feed check, and reports on the run's summary page.
7. The daily and delivery workflows skip instead of failing while their secrets are missing. The Worker is renamed `globalgist`. The site says the first map is being made until a day exists. Static assets get security and cache headers, and the build drops source maps.

## 34. Nothing to run by hand (September 28, 2026)

Davis may not have time to run anything, so the launch and every day after it must need no command.

1. "Deploy site" copies the `DATABASE_URL` repository secret into the Worker after each deploy, in place of a manual `wrangler secret put`.
2. A finished deploy starts "Daily run" with `day --if-missing`, which skips when the date's map already exists. Going live is the secrets and one merge. Later deploys don't pay for a second run.
3. Each daily run starts with `llm check`, so a bad key or model id fails in seconds with a plain message instead of midway.
4. Neon's free plan holds 0.5 GB. At 237 outlets a day adds several megabytes, mostly fetched page text, so the database would fill in months. A last `prune` stage deletes world-desk days older than `WORLD_RETENTION_DAYS` (default 30) and clears page text older than two days, which explain no longer needs. 2DayAI's briefing history is not touched. A failed prune never costs the day its map.

## 35. 2DayAI runs on the daily workflow, with readers in a secret (September 28, 2026)

Davis asked for 2DayAI to be wired up for production. The code for every stage was done (milestones 2 and 3), but the daily workflow could never see a reader: profiles live in `config/readers/`, which is gitignored because they hold emails.

1. The daily run reads reader profiles from the `READER_PROFILES` secret as well as from `config/readers/`. The secret holds YAML documents separated by `---`, one per reader, in the format of `r00.example.yaml`. A reader defined in both places is refused, so there is never a doubt which profile is live. An invalid document is named by its position, never printed, because it holds an email.
2. With profiles present, the briefing stages run by themselves (decision 33). Without them the map runs alone, as before.
3. `deliver` refuses to send while `WEB_BASE_URL` or `MAIL_FROM` still hold their placeholder defaults, and names the variable to set. An email with links to a placeholder host would reach a reader and could not be taken back.
4. 2DayAI's select stage counts as a judgment stage with the telegram: it runs on `MODEL_TELEGRAM` (`gpt-5.4-mini`) with reasoning on. Picking a reader's three to five events and writing the day's headline is the product (SPEC.md section 1), and one call per reader is cheap.
5. The example profile gains an `email` line, so it passes validation when copied, and a test keeps it valid.

## 36. Feeds that look after themselves, a steadier word, and a run summary (September 28, 2026)

Davis asked for the first week's and the later sprint items in todo.txt to be done in code where they can be. This answers point 7 of decision 29, which left the median score for Davis to decide: Davis asked for the later sprint to be covered.

1. Feed health, in new columns on `sources`. A feed found behind a homepage (decision 31) is remembered and fetched directly on later days; changing the URL in `sources.yaml` forgets it. A source that fails 7 days running is paused and retried on Sundays; one success resets it. A day run twice counts one failure.
2. A cluster-world batch whose answer runs past the output limit is split in half and asked again, up to three times, before the stage fails. The advice to lower `WORLD_CLUSTER_BATCH` by hand is no longer needed for that case.
3. Once OpenAI refuses the flex tier in a run, the rest of that run asks for the default tier straight away, instead of trying flex and failing on every call.
4. The telegram's score call runs `TELEGRAM_SCORE_RUNS` times (default 3) and each event keeps its middle score, with the reason from a run that gave it. Every run must pass the same checks. The three calls run one after another so the provider's cache bills most of the repeated input at a tenth. Estimated extra cost: two to three cents a day on gpt-5.4-mini flex. The scale, the word lists and the band formula are unchanged. The About page says the day is scored three times.
5. Each daily run writes a summary to its GitHub Actions page: the word, feed counts, stories, explanations, spend, and tables of failing, paused and discovered feeds. A failed run names the failure and lists the stages that finished.
6. The map sends a Content-Security-Policy header. Everything loads from the site itself, except publisher images and the article reader's frame of the publisher's page. It was tested in Chromium across the designs with no violations (the bundled fonts need `data:`).
7. On phones, the toolbar keeps Map / Globe and Topics in the row and moves Design, Translate, Pinned and About into a "More" menu, instead of scrolling sideways.

## 37. The custom domain goes on the Cloudflare Worker, not GitHub Pages (September 28, 2026)

Davis wants the site at globalgist.com and tried GitHub Pages, whose DNS check failed.

1. GitHub Pages can't host this site. Pages serves static files only, and the map reads each day from `/data/latest.json`, which the Worker builds from the database. Pages on a private repository also needs a paid GitHub plan.
2. The domain goes on Cloudflare (bought there, or moved there by changing nameservers) and attaches to the Worker as a custom domain, with `www.` beside it. Cloudflare creates the DNS records and the certificate. The workers.dev address keeps working.
3. One repository variable, `SITE_DOMAIN`, turns it on. The deploy workflow adds the domains to the Worker config only when it is set, so a deploy never fails for a domain that isn't on Cloudflare yet. Email links use it too, unless `WEB_BASE_URL` overrides it.

## 38. The Worker config moves to the repository root (September 29, 2026)

Davis connected the repository to Cloudflare's Git integration (Workers Builds). Its default deploy, `npx wrangler deploy` from the repository root, failed: the config was in `packages/web/`, so Wrangler found none and refused to guess in a workspace root.

1. `wrangler.toml` moves to the root, with paths to `packages/web/src/index.ts` and `packages/map/dist`.
2. Its `[build]` step builds the map and removes the sample data, so every deploy, from any path, ships the real site and never the fictional day. `npm run web:deploy` is now plain `wrangler deploy`.
3. Either Workers Builds or the "Deploy site" workflow deploys, not both. With Workers Builds, `DATABASE_URL` is a secret on the Worker and the custom domain is attached in the dashboard. The workflow still starts "Daily run" when it finishes, even when it skips.

## 39. Out of credit fails at once, and any call can be tried in the Playground (September 29, 2026)

The first real daily run failed because the OpenAI account had no credit. Each model then spent about 90 seconds retrying before failing, because an empty balance answers with the same HTTP 429 as a busy server. Davis also asked for the calls to be ready to try in the OpenAI Playground.

1. A 429 that says `insufficient_quota` or `credit_balance_exhausted` fails at once, without retries and without the switch to the default tier, and says to add credit or raise the spend limit. Other 429s still wait and retry.
2. `npm run stage -- prompt <name>` prints one call for the Playground: the settings the pipeline uses (model, JSON object, reasoning effort, no tools), the system message exactly as sent, and a sample user message from the fictional world day. It needs no key and no database. docs/PROMPTS.md maps each Playground setting.

## 40. The word is the headline, and 2DayAI email is parked (September 29, 2026)

Davis wants one big word on the site and no email briefing for now, with 2DayAI coming back later as an opt-in on the site.

1. The day's word moves to the centre of the masthead and becomes the largest text on the page. Its size follows its length, so a short word like "Joy" is large and the longest, "Encouragement", still fits a 375-pixel phone. The date, the "Chosen by AI" label and the scale sit beside it on wide screens and under it on phones. Nothing is added around the word, and the label stays next to it (neutrality rule 4).
2. 2DayAI email is parked. The code and decision 35 stay as they are, and with no reader profiles the daily run skips the briefing stages at no cost (decision 33). "Deliver" loses its two-hourly schedule, which spent about 360 Actions minutes a month on skipped runs. It can still be run by hand.
3. When 2DayAI returns, it is an opt-in on the site with no account or login: a visitor asks for the briefing, and the site keeps only what is needed to send it. That design is its own decision.

## 41. One bad answer no longer costs the day, and smaller fixes from the first live run (September 29, 2026)

The first live run with credit failed in the grouping stage: in one batch of five, the model returned one event with no articles among about a hundred, the answer failed its schema, and the whole day was thrown away. Davis also asked about the preview note, the tagline and the Translate button.

1. An event with no articles is dropped by code instead of failing its batch. A batch that fails for any other reason is asked once more before the stage fails. The rule that a batch still failing writes nothing stands (decision 31).
2. The tagline is "One World. One Word." It now shows on phones too.
3. A story with no feed summary shows its headline and link without the note "The outlet didn't publish a preview for this story", which read as an error on every such story.
4. Translate also translates the preview text, and the button shows only when the browser can translate and the day has a story in another language.
5. Each daily run keeps the day's map as a downloadable file for a week (the `map` artifact), so a day can be checked, or loaded into a demo, without database access.

## 42. The map looks the same while it moves (September 29, 2026)

Davis saw the water "stutter" when clicking and dragging. The map switched to a lighter drawing whenever it was touched: coarser coasts, lakes and rivers, two ripple lines instead of four or five, no ice shading, and rougher outlines. Letting go switched it back, so every click made the water jump.

1. Detail now follows how large the world is on screen, never whether it is moving. The whole world at once uses the light basemap, where the fine one adds nothing visible; zoomed in (a globe radius of 520 pixels or more) uses the fine one. Ripple lines, ice shading and outline precision are the same in every frame.
2. To keep dragging smooth with full ripple lines, the coastline is projected once per frame and reused for every stroke, and only what is on screen plus a margin is drawn. Measured in headless Chromium without a GPU, dragging runs at 30 to 46 frames a second, against 35 to 53 before with the lighter drawing.
3. The light basemap gains Natural Earth's 110m ice, so the world view keeps its ice shading.
4. Coasts are stroked from a coastline that leaves out the edges the data adds along the 180th meridian and the pole, which drew a straight line through Chukotka and Antarctica.

## 43. Three more designs: Pirate, Space and Cotton Candy (September 29, 2026)

Davis asked for three playful looks beside the five from decision 32. They follow the same rules: no borders, no names or labels on the map, and dot size and colour keep their meaning.

1. Pirate: an old sea chart in sepia ink on sea-green water, with a compass rose, rope and dashed rules, and a Pirata One masthead and word. Red marks fresh reports. Map by default.
2. Space: the globe as a planet against a static CSS starfield, with a thin atmosphere rim and a faint city-lights texture on land. Amber marks fresh reports. The flat map reads as a star chart. Globe by default.
3. Cotton Candy: pink land on sky-blue water with rounded chrome in Fredoka and Nunito. Magenta marks fresh reports. Map by default.
4. Decorations are allowed on the canvas when they are clearly decorative: Pirate's small ink sea creatures (serpents, a kraken, whales) and Space's four-point stars on the flat map. They are drawn under the dots, in open strokes with no text and no filled shapes, at fixed spots in open ocean. A test checks every spot against the basemap's land and keeps it at least 14 degrees (creatures) or 8 degrees (stars) from every outlet's city in `config/sources.yaml` and the sample. On the globe, a creature fades out toward the rim and is hidden on the far side.
5. Each design styles the word by font, weight, spacing and colour only, so its size still follows its length. "Encouragement" fits a 375-pixel phone in all three.
6. Fonts are self-hosted from `@fontsource`: Pirata One, Space Grotesk, Fredoka and Nunito.

## 44. Stories sit where they happened (September 29, 2026)

Davis wants the map to show where news happens, not where outlets are based: a Paris newspaper's stories about Russia, Madrid, Venezuela and Australia all sat in Paris. This reverses the "pins are publishers" rule of decision 23 and neutrality rule 2 in packages/map/AGENTS.md, which avoided geocoding so the map would never place or name a disputed location.

1. The grouping prompt (`cluster-world.v3`) asks, for each event, the city or town where it happened, its two-letter country code and a rough point, or null when the articles name only a country or a region, span several places, or leave it unclear.
2. Code decides the point, never the model alone. A city on a fixed list of 7,342 world cities (Natural Earth populated places, public domain, `packages/pipeline/data/places.json`, rebuilt by `npm run places:build`) gets the list's point and name. Same-named cities are told apart by the country code, which is never shown. A town not on the list, like Rafah, gets the model's point only when it lies within 250 km of a listed city of the same country. Anything else stays at the outlet's city, as before.
3. Nothing is ever placed at a country or a region, and no country name appears anywhere. The map still has no borders. Place names are the list's English names.
4. Every report shows its outlet's city next to the outlet's name. "Also reported in N other places" becomes "Also reported by N other outlets". Reach, which decides what shows when zoomed out (decision 30), still counts the outlets' cities, since it measures how widely a story was reported.
5. A story's city within 25 km of an outlet's city shares that dot, so one city is one dot.
6. The daily run summary counts how many stories were placed. The About text says how placement works.

## 46. Five zoom tiers, dots sized by importance, and a daily coverage count (September 29, 2026)

Davis wants every country, every region within it and every stateless nation represented, and asked that the map rank what shows by importance as you zoom, with dots sized to match, so a much fuller map stays usable. This changes neutrality rule 3 in packages/map/AGENTS.md, which kept dot size to report count alone.

1. Five zoom tiers instead of three. The whole world shows places with a story rated 5 by the grouping model, or reported by outlets in five or more cities. Each step in adds the next tier: importance 4 or three cities, importance 3 or two cities, importance 2, then everything.
2. Dot size follows the place's most important story and its report count, so one major story reads larger than a busy city of minor ones. Merged dots take the largest weight among their places. Colour still means only "reported in the last hour", and lists stay newest first.
3. The daily summary counts the countries and territories (225) and first-level regions (2,589) with at least one story, and lists the countries with none, so coverage can be followed day by day. Regions come from Natural Earth's populated places, added to the city list. The count is internal; the site still names no countries or regions.
4. Growing coverage toward every region and every stateless nation is outlet work: an outlet for every country and territory (decision 45), then outlets for regions of the largest countries and for communities without a state, balanced as the add-news-source skill requires.
