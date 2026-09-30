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

## 45. An outlet for every country and territory (September 29, 2026)

Davis wants every country and territory on the map to have at least one news outlet. Decision 31 left 78 without one.

1. The world desk grows from 237 outlets to 312 in 281 cities. 72 of the 75 places that had no outlet now have one whose pin falls there, checked by matching each pin to its nearest city in the place list. Each outlet is pinned at the city its newsroom works from. They were gathered by web search, and most feeds are unconfirmed: 69 entries point at a homepage and ingest finds the feed (decision 31). Stabroek News (Guyana) and the Saipan Tribune (Northern Mariana Islands) have closed, so Kaieteur News and Marianas Variety are used instead. Sermitsiaq.AG does not allow its feeds in public news lists, so Greenland has KNR.
2. The order of preference was an independent national outlet or public broadcaster, then a national agency, then a regional outlet. State media is marked in a comment. Djibouti, Equatorial Guinea and the Seychelles have a state outlet only: no independent outlet works inside the first two, and the Seychelles' independent daily has no usable news site.
3. Belarus and Nicaragua have independent press only in exile. Each gets a state outlet in the country (BelTA in Minsk, El 19 Digital in Managua) together with an independent one pinned where it publishes (Nasha Niva in Vilnius, Confidencial in San José).
4. North Korea gets KCNA in Pyongyang, marked as state media, beside NK News and Daily NK, which already publish from Seoul. KCNA's site is often offline and has no known feed, so it may fail and be paused (decision 36); if it does, North Korea keeps the Seoul outlets.
5. Sudan gets Ayin Network, an independent outlet publishing from Nairobi, beside Radio Dabanga (Amsterdam) and Sudan Tribune (Paris). No outlet inside Sudan was added: the national news agency works for the army-backed government, one side of the war, and the other side has no equivalent outlet, so adding it would break the balance rule.
6. Skipped: Antarctica and South Georgia (no local press), Western Sahara (contested; an outlet from one side would break the balance rule, the international desks already cover it, and stories are placed where they happen), and Kiribati and Tuvalu (their press is a weekly print paper, state radio and government bulletins on social media, with no reliable news site; RNZ covers both from Wellington).
7. Montenegro's Vijesti is tagged `cnr` (Montenegrin), so the map names the language as its readers do.

## 46. Five zoom tiers, dots sized by importance, and a daily coverage count (September 29, 2026)

Davis wants every country, every region within it and every stateless nation represented, and asked that the map rank what shows by importance as you zoom, with dots sized to match, so a much fuller map stays usable. This changes neutrality rule 3 in packages/map/AGENTS.md, which kept dot size to report count alone.

1. Five zoom tiers instead of three. The whole world shows places with a story rated 4 or 5 by the grouping model, or reported by outlets in four or more cities. Each step in adds the next tier: importance 3 or three cities, importance 2 or two cities, importance 1, then anything ungrouped. (Tuned on the first live day, where importance 5 alone left about ten dots on the world view.)
2. Dot size follows the place's most important story and its report count, so one major story reads larger than a busy city of minor ones. Merged dots take the largest weight among their places. Colour still means only "reported in the last hour", and lists stay newest first.
3. The daily summary counts the countries and territories (225) and first-level regions (2,589) with at least one story, and lists the countries with none, so coverage can be followed day by day. Regions come from Natural Earth's populated places, added to the city list. The count is internal; the site still names no countries or regions.
4. Growing coverage toward every region and every stateless nation is outlet work: an outlet for every country and territory (decision 45), then outlets for regions of the largest countries and for communities without a state, balanced as the add-news-source skill requires.

## 47. A malformed optional field never costs a grouping batch (September 29, 2026)

The second live test failed like the first: in a batch of 300 articles, the model wrote an unknown location as a location with an empty city instead of null, the answer failed its schema twice, and the day was thrown away. Decision 41 fixed one such field; this fixes the class.

1. In each grouping event only the article ids decide what is written. Every other field falls back instead of failing: a malformed location becomes "no location", an unknown topic "other", an out-of-range importance 2, a missing reason blank. Titles of any length are accepted and cut to 120 characters in code, in the batch answers and the merge answer.
2. The schema shown to the model states these defaults, so the model sees what an omitted field means.

## 48. Outlets for stateless nations, minority peoples and Indigenous communities (September 29, 2026)

Davis wants every stateless nation, minority people and Indigenous community on the map. The world desk gains 66 outlets in one block at the end of the world-desk section of `config/sources.yaml`. They were found by web search. The session could not reach the hosts, so 11 feeds are ones seen in search results and the rest are homepages marked `# feed unconfirmed` (decision 31). `npm run stage -- sources check` settles them.

1. Every outlet is pinned at the city its newsroom publishes from, which for exile and diaspora outlets is abroad: Phayul in Dharamsala, Radio Free Asia Uyghur in Washington, Tamil Guardian in London, Shan Herald in Chiang Mai, Oromia Media Network in Minneapolis, Amazigh World News in Boston, QHA in Kyiv, Caucasian Knot in Moscow.
2. An outlet from one side of a conflict or sovereignty dispute is added only beside the state side, either added here or already listed:
   - Kurds in Syria: Hawar News (linked to the Autonomous Administration) beside the new SANA entry. Kurds in Turkey: Mezopotamya Agency beside the new Anadolu Agency entry and `hurriyet-daily-news`. Kurds in Iraq: `rudaw` and `shafaq-news` were already listed.
   - Druze of Suwayda: Suwayda 24 beside SANA.
   - Basques, Catalans and Galicians: Berria, Catalan News, VilaWeb and Nós Diario beside the new Agencia EFE entry and `el-pais-english`. Scots: The National (pro-independence) beside `scotsman` and `bbc-world`.
   - Tibetans and Uyghurs: Phayul and Radio Free Asia Uyghur beside `xinhua-english`, `china-daily` and the new Tianshannet (Xinjiang government) entry.
   - Tamils: Tamil Guardian beside the new state-owned Daily News and `daily-mirror-lk`.
   - Rohingya, Karen and Shan: Kaladan Press, Karen News and Shan Herald beside `global-new-light-of-myanmar`.
   - Sahrawi: Sahara Press Service (the Polisario Front's state media) beside the new Maghreb Arabe Presse entry, `morocco-world-news` and `hespress-english`.
   - Oromo: Oromia Media Network beside the new Ethiopian News Agency entry and `addis-standard`. Puntland: Garowe Online beside `somali-guardian`.
   - Crimean Tatars: QHA beside the new RIA Novosti Crimea entry (Russian state media in Simferopol), `tass` and `kyiv-independent`.
   - Chechnya: Caucasian Knot beside the Chechen government's Grozny-Inform.
   - Abkhazia and South Ossetia: the de facto authorities' agencies Apsnypress and RES beside the new Georgian Public Broadcaster entry and `civil-ge`.
   - Transnistria: Novosti Pridnestrovya (de facto authorities) beside the new Moldpres entry (Moldovan state).
   - Northern Cyprus: Yenidüzen beside `cyprus-mail`, on the same Nicosia pin. Kosovo: KoSSev (Serbian community in Mitrovica) beside `prishtina-insight` and `n1-serbia`.
   - Papua: Jubi beside the new ANTARA entry and `jakarta-post`. New Caledonia: Radio Djiido (founded by the FLNKS) beside the French public broadcaster's Nouvelle-Calédonie La 1ère.
   - Mapuche: Mapuexpress beside `biobiochile`.
3. Already covered, nothing added: Palestinians (`wafa`, `maan-news`, `ramattan` beside the Israeli outlets), Kashmir (`greater-kashmir` and `jammu-kashmir-times-mzd`), Anglophone Cameroon (`mimi-mefo-info` and `cameroon-tribune`), Somaliland (`somaliland-chronicle` and `somali-guardian`), Hong Kong independent press (`hong-kong-free-press`), Baloch (`balochistan-express`), Kosovo Albanians (`prishtina-insight`), Quebec (`le-devoir`, now with Le Soleil).
4. Place names for contested cities use the common English form: Sukhumi, Tskhinvali, Simferopol, Nicosia, Mitrovica. The panel shows the name only, never a country.
5. Skipped:
   - Kurds in Iran: no outlet with a known newsroom city. Kurdpa gives no location, and Hengaw is a human rights monitor, not a newsroom.
   - Inner Mongolia: the only exile source found is a human rights organisation's news page, not a newsroom.
   - Manipur: the Imphal papers are valley-based, and no Kuki-Zo outlet with a working news site was found to balance them during the conflict between the two communities.
   - The Balochistan Post: it does not say where its newsroom is, and it is aligned with one side of an armed conflict.
   - Pashtun exile radio: Radio Mashaal closed on March 31, 2026. Tribal News Network in Peshawar was added instead.
   - Hazara, Tuareg, Circassians and Garifuna: no news outlet with a website and a known newsroom was found. The Tuareg case would also need balancing against an armed movement.
   - Ogoni: the Ogoni news site found mostly republishes other papers. The Tide in Port Harcourt covers the Niger Delta.
   - Zanzibar: the government paper's website could not be confirmed.
   - Bougainville: no newsroom site with a confirmed location. The New Dawn FM blog was last active years ago.
   - Sermitsiaq.AG (Greenland): its terms forbid public use of its RSS feeds without permission. KNR covers Greenland.
   - China Tibet Online: its newsroom city could not be confirmed. Xinhua and China Daily cover the state side.
6. Newsroom cities to confirm: Karen News (pinned at Mae Sot from older reports), Kaladan Press (founded in Chittagong), Mapuexpress (Temuco). The Mezopotamya Agency domain changes after each court block in Turkey, so its URL may need updating.

## 49. An outlet for every region of the ten most populous countries (September 29, 2026)

Davis wants every governing unit of every country represented. Stories sit where they happen (decision 44), so an outlet publishing from a region brings that region's stories onto the map. This adds 188 world-desk outlets in one block at the end of the world desk in `config/sources.yaml`: one outlet for each first-level region that had none in India, China, the United States, Indonesia, Pakistan, Nigeria, Brazil, Bangladesh, Russia and Mexico. Each is pinned at the city it publishes from, at the city list's point where the city is on it.

1. Coverage is counted as the daily summary counts it (decision 46): each outlet's pin goes to the nearest listed city and that city's region. Regions with an outlet, before and after: India 7 to 25 of 35, China 1 to 27 of 30, United States 13 to 51 of 51 (the 50 states and Washington), Indonesia 2 to 30 of 33, Pakistan 4 to 5 of 7, Nigeria 2 to 11 of 35, Brazil 2 to 27 of 32, Bangladesh 1 to 4 of 6, Russia 1 to 8 of 90, Mexico 2 to 32 of 32. In all, 35 to 220 of 351.
2. Some counts come from the city list, not from the ground. Brazil's list has five broken labels (Amapi, Goi, Maranh, Par, Rondinia) that repeat Amapá, Goiás, Maranhão, Pará and Rondônia, so every one of Brazil's 27 units has an outlet. India's list files Gujarat's cities under "Dadra and Nagar Haveli", which Gujarat Samachar in Ahmedabad covers. The Pointer publishes from Asaba in Delta State, but the nearest listed city is Onitsha, so it counts for Anambra and Delta shows as open. Tribun Batam publishes from Batam, whose nearest listed city is Singapore, so the Riau Islands show as open. Pins stay at the real city in both cases.
3. China's 26 provincial outlets are provincial party dailies and their news sites, each marked `# state media`: independent regional press does not exist there. Shanghai Daily is in English, the rest in Chinese. Macau gets the Macau Daily Times, a private English daily. Hong Kong keeps Hong Kong Free Press.
4. Russia is covered by federal district, not by its 80 or more subjects: Central (TASS, already listed), Northwestern (Fontanka.ru), Southern (161.ru, Rostov-on-Don), North Caucasian (Chernovik, Makhachkala), Volga (Business Online, Kazan), Ural (It's My City, Yekaterinburg), Siberian (Tayga.info, Novosibirsk) and Far Eastern (VL.ru News, Vladivostok). Chernovik, It's My City and Tayga.info are independent. The others are privately owned and publish under Russian media law. None of the new ones is state-owned. Nothing is added for Crimea.
5. Nigeria's additions include four state-government papers (The Tide, The Nigerian Observer, The Pointer, The Hope), each marked. The United States block mixes public radio, daily papers and nonprofit newsrooms, including Cowboy State Daily in Wyoming, and adds WAMU as a local newsroom for Washington. Puerto Rico already had El Nuevo Día.
6. Feeds: the session's shared web-search budget ran out early and news hosts were blocked. 6 feeds were seen in search (Arkansas Advocate, The Lens, Mississippi Today, Searchlight New Mexico, Billy Penn at WHYY, VTDigger). The other 182 entries are homepages taken from knowledge and marked `# feed unconfirmed`. Ingest follows the feed link each page declares (decision 31). Run `npm run stage -- sources check` and remove what fails.
7. Left open: India's Puducherry and Lakshadweep (no outlet found this session); Nigeria's Abia, Adamawa, Akwa Ibom, Bauchi, Benue, Borno, Delta, Ekiti, Enugu, Gombe, Imo, Jigawa, Kaduna, Katsina, Kebbi, Kwara, Nassarawa, Niger, Ogun, Plateau, Sokoto, Taraba, Yobe and Zamfara (no outlet whose site could be named with confidence); Bangladesh's Barisal and Khulna; Pakistan's former tribal areas; Indonesia's Riau Islands (see 2); and Russia's other subjects. Left to the parallel contested-areas and stateless-nations work: Ladakh and India's northeast (Arunachal Pradesh, Manipur, Meghalaya, Mizoram, Nagaland, Sikkim, Tripura), Xinjiang, Tibet, Inner Mongolia, Papua, West Papua, Gilgit-Baltistan and Crimea.
8. Cost and balance: the world desk grows from 237 to 425 outlets. At `WORLD_PER_SOURCE` (15) the new outlets can add up to 2,820 articles a day to the grouping stage. The list now leans toward these ten countries, which is what Davis asked for. The rest of the world is decision 45's work.

## 50. Every story on the map is grouped and ranked (September 29, 2026)

The first complete live day showed 2,632 stories, but only about 300 had been grouped into events. The grouping stage reads each outlet's 15 newest articles (1,303 that day); of those it set aside 454 as not news and left 570 ungrouped. Everything outside a group had no importance, topic or place, so it could not be ranked, sized or placed where it happened, and ads showed as stories. The cross-batch merge proposed five joins and the checks refused all five.

1. Articles the model neither groups nor sets aside go back to it once, in their own batches. Whatever is still left becomes a one-article event of importance 1. A failed second pass does not fail the day.
2. Once a day is grouped, the map shows only articles that belong to a story. Articles set aside as not news, and articles past an outlet's daily cap, stay off the map.
3. Merge keys are read however the model brackets or capitalises them ("[B1-E3]" is "b1-e3").
4. Tests give the in-memory database a minute to start, since a full parallel run could pass the old 10 second limit with nothing wrong.

## 51. A broken model answer costs the day its word, never the day (September 29, 2026)

The first three full runs at 560 outlets each stopped on one bad model answer: quoted passages with null characters where accented letters belonged, one article listed twice in a story, and a score whose reason was not copied exactly from its event's sentences (the checks from decisions 26 and 36). Each time the whole day failed, and the grouped and explained stories never reached the map. A few thousand model answers a day make rare slips daily events.

1. Control characters other than tab and line breaks are removed from model answers, feed text, page text and run records before anything is written. Postgres refuses the null character in text and JSON.
2. An article the model lists twice in one story joins it once, on both desks.
3. A telegram score run that still breaks the rules after its retry is set aside, and another is asked, up to two more than `TELEGRAM_SCORE_RUNS`. The day's scores are the middle of the runs that passed. The checks themselves are unchanged: no rejected score is ever used.
4. If no score run passes, or the word breaks the rules twice, the day has no word and says why in the run summary. Its stories, explanations and places still go out. Decision 26 already allows a day without a word.
5. An outage, a spent credit balance or the spend ceiling is not a broken rule and still fails the stage loudly.

## 52. Feeds and pages are read in the encoding they declare (September 29, 2026)

Every feed and page was read as UTF-8. Folha de S.Paulo publishes its feed in ISO-8859-1, so each accented letter in its Portuguese headlines became the replacement character (U+FFFD), 937 of them on the first live day. The model then quoted that broken text back with null characters, which stopped the first 560-outlet run (decision 51).

1. A response is decoded with the charset its Content-Type names, then the one its XML declaration or HTML meta tag names, then UTF-8. When they disagree, the reading with the fewest broken characters wins.
2. An article already stored with broken characters takes the clean headline, lead and body the next time its feed reads cleanly. It does not count as a new article.

## 53. Feeds are looked for harder before an outlet counts as failing (September 29, 2026)

The first full 560-outlet day read 336 feeds. Of the 224 that failed, 119 were homepages that link to no feed, 64 answered 403 and 24 were down or timed out. Every failing outlet is a place that stays empty on the map.

1. The fetcher names itself the usual crawler way, `Mozilla/5.0 (compatible; GlobalGist/1.0; +<repository>)`, and says which formats it accepts. Many sites refuse a bare bot name with 403 but serve this one. It still says who is asking.
2. Discovery tries twelve common feed paths instead of five, adding the ones the failing outlets' platforms use (`/index.rss`, `/?feed=rss2`, `/atom.xml`, Blogger's `/feeds/posts/default`, Arc's `/arc/outboundfeeds/rss/` and others).
3. When the configured address answers with an HTTP error, those paths are tried too. A host that is down or times out is not asked again, so a dead site costs one request, not thirteen.
4. A feed found this way is remembered as before (decision 36), so the search happens once.

## 54. GDELT fills the regions no outlet reached (September 29, 2026)

The first full 560-outlet day put stories in 126 of 225 countries and territories and 297 of the 2,589 first-level regions (states, provinces, departments) on the city list. Davis wants every governing unit to have its news. Reaching every region with hand-picked outlets means about 2,000 more outlets to research, many with broken feeds, and grouping all their articles would cost several dollars a day. Davis chose GDELT plus outlets.

1. GDELT is an open index of news sites worldwide in more than 65 languages. Every 15 minutes it publishes each article it read with its URL, title and the places it names. A new stage, `local`, runs after the word. For each region with no story on the day's map, it keeps up to `GDELT_PER_REGION` (default 3) of the newest articles about a town there.
2. The town is the city-level place the article names most. It is placed only if it is on the city list or within 250 km of a listed city in its country, the same rule as decision 44; the listed city nearest GDELT's point wins a shared name. An article that names only a country or state is not used.
3. No model reads these stories, so they cost nothing. They live in their own table, never join an event, sit at the lowest zoom tier, carry no topic and are never explained or scored. GDELT's tone and theme fields are not used.
4. The site marks each one "via GDELT" and the About page says what GDELT is. The headline is shown as published and links to the outlet.
5. Outlets come first. A region with a story from a listed outlet gets no GDELT stories, and outlet research continues, so GDELT fills less over time.
6. A GDELT outage costs the day only its local stories. They are kept three days.

## 55. The masthead reads like a front page, and every control fits one row (September 29, 2026)

Davis looked at the site on a phone. The date sat under the word, and the "More" menu from decision 36 (item 7) did not open, because the toolbar scrolled sideways and clipped it. This replaces that item.

1. On a phone the masthead reads top to bottom like a newspaper: the name and slogan, the date between two rules, "Today's word" and the word, then "Chosen by AI from N events". On a wide screen the word sits in the centre under "Today's word", with the date, the note and the scale on the right.
2. Map or Globe and the design are native dropdowns, so they open over the page and suit touch screens. Topics and Translate stay beside them. On a phone the design shows its first word ("Morning", "Cabinet"), and About is a "?" in the masthead's top corner, so the four controls fit one row in every design from 360 pixels wide. If Pinned joins them, the row wraps instead of scrolling.
3. The Topics and Pinned menus open across the width of the screen, anchored to the toolbar, so nothing clips them.

## 57. Symbols by importance, a Key, saved settings and six more designs (September 29, 2026)

Davis asked for a clearer order of stories on the map, a plain label for how the word is chosen, settings that stay put, and more designs.

1. A place's symbol follows the grouping model's importance for its top story: hollow for importance 1 and for GDELT local stories, filled for 2 and 3, filled with an outer ring for 4 and 5. Size still grows with the number of reports. The most important are drawn last, so they sit on top. Colour still means only "reported in the last hour"; in single-colour designs a fresh place gets a dotted ring instead. A thin inner ring still marks merged places.
2. A "Key" beside the zoom buttons shows these symbols in the current design's colours and says they follow the model's 1 to 5 rating.
3. The note under the word reads "Chosen by AI from today's N events" ("the day's" for an earlier day), since the word comes from scoring every event of the day.
4. The design, Map or Globe, Translate and the chosen topics are saved in the browser and come back on the next visit. Nothing leaves the device. A link's `?view=` still wins over the saved view.
5. Cotton Candy is renamed Candy Shop and gets candy drawings (wrapped sweets, lollipops, swirls) at the same fixed ocean spots as Pirate's creatures. A saved or linked `cotton` opens Candy Shop.
6. Five designs are added: 8-Bit, 16-Bit and 64-Bit, after the feel of the side-scrolling action, role-playing and 3D adventure games of each console era (pixel rendering, square dots and tiled or shimmering water for the first two, gold-trimmed windows on a globe for the third), without copying any game's art, names or layouts; Realize, after the colours and hand-drawn look of two 2005 album covers; and UFO, a dark globe with green linework and small saucers at the same ocean spots. No game, band or album is named on the site.
7. Wire Room's word is phosphor text between two terminal rules instead of a solid green block.

## 58. The console designs get names and their own graphics, and the Key opens beside the map (September 29, 2026)

Davis found the three console designs plain and too alike, Realize's lettering off, UFO too close to the other dark green designs, and the Key in the way of the map. This changes items 2 and 6 of decision 57.

1. The console designs are renamed and each gets its own kind of graphics:
   - **Stage Select** (was 8-Bit): hard pixels at a third of the resolution, land built from bevelled metal blocks, a tiled sea, square markers, and a strip of blocks under the masthead.
   - **Overworld** (was 16-Bit): finer pixels, pixel grass, sandy shores, lighter shallows along every coast, glinting water, round markers, a pixel serif for text, and a pointer beside whatever menu is open.
   - **Polygon Kingdom** (was 64-Bit): the globe and map covered in flat-shaded triangles (a subdivided icosahedron, shaded by a fixed hash, the same everywhere), diamond markers, and faceted gold-trimmed windows.

   Their ids (`bit8`, `bit16`, `bit64`) stay, so saved choices and links keep working.
2. Realize uses scrawled and brush lettering (Rock Salt, Caveat Brush), paint strokes in yellow and violet over the red-orange land and pink strokes over the sea, a word painted half warm and half cool, cut-paper panels, and controls that alternate red and violet.
3. UFO becomes a 1950s saucer picture: deep teal sea and sky, clay land, moon-white coasts, a full moon behind the globe, yellow for fresh reports, and a period display face with a plain one for the word and headlines.
4. The Key is a small button on the map. It opens a panel beside the map (over the story list on a wide screen, as a sheet at the bottom of a phone) with a close button. Escape or a click anywhere else also closes it.
5. On a phone the design menu is only as wide as the chosen design's name, so the toolbar stays one row in every design at 360 pixels.

Marker shape (circle, square or diamond) is part of a design and never carries meaning. The three symbols of decision 57 read the same in every shape.

## 59. The scale says what it measures, the note shows the whole count, and three designs change (September 29, 2026)

Davis found the scale's names (Grave, Hard, Mixed, Hopeful, Good) insensitive and not accurate, asked whether the word comes from every story, and gave feedback on the designs. This changes the scale names in decision 26 and items 1 to 3 of decision 58.

1. The five steps are named for what the scoring rules measure, outcomes for people in the day's top events: **Severe harm, Harm, Mixed, Relief, Resolution**. They no longer read as a verdict on the day. The model sees the same names. The word lists do not change.
2. The note under the word shows the whole count: "Chosen by AI from the 24 most important events in today's 1,826 reports". Every report is grouped into events and rated for importance; only the most important (3 or more, up to `WORLD_EXPLAIN_MAX`) are checked against their sources and scored. GDELT's local stories are never grouped, so they are not counted. The About page and the word's panel explain the same steps.
3. **Realize** takes direct inspiration from the Mezmerize and Hypnotize covers: a black ground, dark red smeared land, bone-white coasts and markers, the covers' blue for fresh reports, the striped arcs across the top, white stamped poster capitals (Anton, worn with a noise mask) over red marker lettering (Permanent Marker) for the word. No band name or artwork is copied.
4. **Polygon Kingdom** drops the flat triangles for depth, after Super Mario 64 and the Zelda games of that console: land lit from the upper left and raised above the sea on dirt-coloured sides, lighter shallows and surf, a glint on the globe, a bright sky with clouds, gems for markers, gold lettering with depth, raised gold buttons and gold-framed windows.
5. **UFO** is removed. A saved choice of it opens the default design.
6. **Newsroom** is added: a television news studio. The world on a glowing LED wall, studio lights, glossy navy panels, the word as a white caption bar under a red "Today's word" tab, Oswald and Barlow, red for fresh reports, and a crawl of the newest headlines along the bottom (the newest first, as every list on the site is). It shows no "live" or "breaking" label.

## 60. Local outlets for regions with none, kept only where the feed checks out; Polygon Kingdom's terrain (September 29, 2026)

The source list added 485 researched local outlets for regions no outlet reached, under a comment that called this decision 56. That entry was never written; this is it. Item 3 changes item 4 of decision 59.

1. The outlets were researched from the list of regions with no story after the first 560-outlet day. The `sources check` run on September 29 fetched each one. 245 fetched as the outlet they name, 225 failed (151 homepages that link to no feed, 34 refused with 403, the rest down, timing out or broken), and 15 returned another publication's feed.
2. Kept: the 245, plus four whose feed is on the outlet's own site with a generic title (Bao Thanh Hoa, Bao Phu Tho, VOCM) or is the same paper's national front page (La Stampa for Turin). Each keeps the feed address the check found, not its homepage. Dropped: the 225 failures and 11 feeds that belong to someone else (a podcast, a neighbouring paper, or a national network's feed standing in for a local edition: The Citizen, Stuff, SunStar, France 3). GDELT (decision 54) covers those regions until a working local feed is found.
3. **Polygon Kingdom** takes its geometry from Super Mario 64:
   - coasts cut into long straight edges (simplified to 0.9 degrees, drawn without curving);
   - the land raised on cliff walls, one flat shade per face by how steeply its edge runs;
   - blurry low-resolution textures: mottled grass on top, orange-brown rock on the walls, mottled water;
   - mountains as two-faced pyramids;
   - no outlines.

   Lakes and rivers are left out in this design, since they no longer line up with the cut coasts.
4. Realize's striped arcs gain the covers' blue, so the blue is not only on fresh markers.

## 61. The note says how the word weighs the day; Polygon Kingdom becomes an overworld (September 29, 2026)

Davis found "Chosen by AI from the 24 most important events" hard to accept for a reader: who decides what is most important? Polygon Kingdom still did not feel like the 64-bit era. This changes item 2 of decision 59 and item 3 of decision 60.

1. The note under the word reads "Chosen by AI, weighing today's news, good and bad. How it's chosen", and the link opens the word's panel with every event, its score and the sentence it rests on. The About page and the panel say "events rated 3 or higher" instead of "most important", and name the rule plainly: good news and bad are weighed together, and one grave event can set a bad day on its own.
2. **Polygon Kingdom** is an overworld after Super Mario 64 and Ocarina of Time (`src/map/terrain.ts`):
   - the land is a grid of triangles 1.5 degrees across with a height at every corner: low hills everywhere, spikes where the relief data has mountains;
   - each triangle is flat-shaded by its slope, lit from the upper left: grass low down, rock higher up, snow on the tallest peaks;
   - triangles are raised toward the viewer and drawn far to near, on orange cliff walls along the coast;
   - the picture is drawn at half resolution and enlarged smoothed, soft like the console's output;
   - the globe's outline is a 22-sided polygon that fades into haze toward the rim;
   - markers are coins, and fresh reports are red coins;
   - chunky outlined counter lettering over an open sky, dark see-through message boxes, raised gold buttons.

   The terrain is built once per basemap from a half-degree raster of the land. Dragging stays as fast as in the other designs. Lakes, rivers and islands smaller than a triangle are not drawn in this design; their places still show.

## 62. Seven more designs (September 29, 2026)

Davis asked for designs after a frog pond, a beehive in the spirit of Bee Movie, a tarot card, Thomas Cole's The Course of Empire in black and white, a bedtime tea box with a sleepy bear, UMass and Will Rogers, each under its own name. None uses a logo, a mascot, a character or a real person's name.

1. **Lily Pond**: murky green water with ripples around every shore, lily-pad land, rounded lily-pad panels, Chewy, lotus pink for fresh reports.
2. **Honeycomb**: honey land built from hexagon cells over a dark hive, hexagon markers, black and yellow stripes, Baloo 2, white for fresh reports.
3. **Arcana**: midnight indigo with gold linework and stars, panels framed like cards, Cinzel Decorative for the name and the word and Lora for reading, amber for fresh reports.
4. **Arcadia**: a black-and-white engraving after The Course of Empire (public domain): hatched land, ruled water, engraved mountains, a grey sky behind the map, a double frame, a compass. It is named for the painting of the pastoral state; "Empire" as a design name on a news map could read as comment. Single-colour, so fresh reports get a dotted ring.
5. **Nightcap**: a watercolour bedtime in periwinkle and sage, a moon and stars behind the globe, Lora italic, a warm lamp colour for fresh reports.
6. **Campus**: maroon and cream, a maroon masthead, varsity lettering (Graduate), pennant-shaped buttons, gold for fresh reports.
7. **Lasso**: a frontier newspaper in dusty tan and faded denim, rope rules, wood type (Rye) and typewriter text (Special Elite), a compass, red for fresh reports.

Every design keeps the rules in packages/map/AGENTS.md: no text on the map, the three marker symbols by importance (a hexagon in Honeycomb), one colour or a dotted ring for fresh reports, and a one-row toolbar at 360 pixels.

## 63. Polygon Kingdom follows the audit: a tilted camera over triangle terrain (September 29, 2026)

An audit of Polygon Kingdom found why it did not read as the 64-bit games: saturated blue everywhere where those games have a pale sky and distance fog, tiny flat-shaded triangles that looked like confetti, no camera angle, and two things too close to Nintendo's trade dress (Mario-style outlined yellow lettering and slotted coins with red coins). Davis asked for every step of the audit, including the tilted camera. This changes item 2 of decision 61.

1. **Tilted camera.** In Map view the flat map is seen from behind and above, tilted back 40 degrees in perspective, so the far side recedes toward a horizon under a sky. The frame's centre does not move, so tuning, tapping and the reticle work as before; a vertical drag is corrected for the tilt. Map view is this design's default. Past the draw distance the ground fades into haze and is not drawn; places there appear when you drag closer, as anything off screen does. A marker never shrinks with distance, because its size means the number of reports.
2. **Terrain** (`src/map/terrain.ts`): a grid of triangles 3, 1.5 or 0.75 degrees across by zoom, with smooth rolling hills, mountains from the relief layer capped so a range is a row of peaks and not a wall, and light worked out once per corner when the grid is built, as those games baked vertex colours. Grass is smooth; rock shows its facets; only the highest peaks carry snow, shaded lavender. A triangle is land when its centre or two corners are, and any triangle holding a place on the map is always land, so no island with news disappears at a coarse grid (tested).
3. **Palette and haze.** A pale sky from `#6fb4f0` to `#e6f5fb` with clouds that pan with the camera, bright grass, orange cliff walls, blue shallows along every coast, and water and land in soft low-resolution textures that move with the world. The haze is the horizon's colour and is opaque at the draw distance.
4. **Markers** are bevelled gold discs floating just above the ground over a round shadow; fresh reports are `#ff4a3d`. The three symbols of decision 57 are unchanged.
5. **Chrome.** A menu title in Russo One, white into ice blue with a navy outline and stepped depth; cream plastic buttons with Nunito; dark see-through message boxes; navy for small text so it reads on the sky. Luckiest Guy, the coins and the red coins are gone.
6. **Globe.** Terrain is raised outward from the centre and drawn over the outline, so peaks break the 22-sided silhouette. The glint, the rim shading and the round halo are gone.
7. **Speed.** Paths are handed to the canvas as text, one per colour and band, instead of thousands of separate calls. A frame of terrain takes about 12 ms on the tilted map and 8 ms on the globe in a software-rendered browser, on par with the other designs.

## 64. Polygon Kingdom's panels look like a pause menu (September 29, 2026)

Davis felt the story panel, a dark see-through box, did not read as the menus of Ocarina of Time and Majora's Mask. This changes the message boxes in item 5 of decision 63.

1. The story panel, the Key and the menus are pause-menu subscreens: a warm amber panel lit from the top, in a thick bevelled gold frame with rounded corners.
2. The panel's title sits in a dark banner between two gold arrow tabs, like the tabs that turn to the next subscreen. They carry no letters or button names.
3. Each story sits in an inset slot. The slot you point at or reach with the keyboard gets a gold selection cursor, four corner brackets that pulse. Place names are gold, "Also reported by" is blue, as the games coloured names in their text.
4. A small gold triangle bobs in the panel's bottom corner, like the one that waits at the end of a text box.
5. Motion stops for readers who ask for reduced motion. No Nintendo art, lettering or icons are used.

## 65. Polygon Kingdom's fields step in tiers, and its lettering takes after Rare (September 29, 2026)

Davis felt the grass still did not look like Super Mario 64's, and asked for text and controls closer to Banjo-Kazooie and Rare's games of that era. This changes items 2 and 5 of decision 63.

1. **Tiers.** Grass no longer rolls in small bumps. Each grass triangle sits flat on one of three plateau levels, and straight orange cliff walls close every step between levels and where grass meets a mountain's foot. Only real mountain ranges slope, in rock with snow on the highest peaks.
2. **Trees.** Round-topped trees on trunks stand on some of the grass. None stands in a grid cell that holds a place on the map, so a tree can never cover or be mistaken for a marker (tested).
3. **Lettering.** The name, the word and the panel title are set in Titan One: chunky rounded capitals in warm yellow with a thick dark outline and a solid drop, each letter tilted its own way and bobbing slightly out of step. Screen readers read the whole word. Motion stops for readers who ask for reduced motion. The letters' look is Rare's spirit, not their lettering, and no game is named.
4. **Buttons** are lumpy hand-made shapes in warm cream with a thick dark outline, each tilted a little, bouncing when pointed at and pressing down when open.
5. A frame of terrain takes about 19 ms on the tilted map and 14 ms on the globe in a software-rendered browser.

## 66. Polygon Kingdom's camera sits lower (September 29, 2026)

Davis asked for the camera that best gives the 64-bit overworld feel before testing on desktop. Tried side by side at 40, 50, 58 and 64 degrees with three camera distances, the flatter settings still read as a map seen at a slant. This changes item 1 of decision 63.

1. **Angle.** The map is tilted back 58 degrees instead of 40, with the camera one screen height from the ground instead of farther out, so near ground is larger and the far side falls away faster toward the horizon. At 64 degrees the land in front filled the screen and the far side was too thin to read.
2. **Zoom floor.** In Map view this design cannot zoom out past 1.8, where the whole map seen low would be a thin strip under a large sky. The Globe view and every other design keep their zoom range.
3. **Clouds** repeat without a seam as the camera pans.
4. Tuning, tapping, the reticle and marker sizes work as before; a vertical drag is still corrected for the tilt.

## 69. Four designs show what they are, and Arcana becomes Tarot (September 29, 2026)

Davis could not tell what Lily Pond, Nightcap, Arcadia and Lasso were meant to be: each was a palette, with nothing in it that said frog pond, bedtime tea, Thomas Cole or trick roping. Arcana and Arcadia sat next to each other in the menu and sounded alike. This changes the four designs from decision 62.

1. **Scenery.** A design may set `scenery`: small pictures drawn on the map from SVG made once (`src/map/scenery.ts`). Each sits at a fixed spot in open water with a radius `r`, and is drawn exactly that wide, so it grows with zoom and never reaches land. `test/scenery.test.ts` checks the whole circle is off land on both coastline files and at least 3 degrees from every outlet's city and every sample place. No picture carries text, and none is small enough to be taken for a marker.
2. **Frog Pond** (was Lily Pond): lily pads, lotus flowers, frogs sitting on pads and dragonflies, with ripples, over every ocean. A frog by the name, reeds at the edges of the page, lily-pad buttons.
3. **Bedtime Tea** (was Nightcap): a night sea with stars, and a bear in a nightcap asleep in a crescent moon, beside the globe or over the open Pacific on the map. The map is the arched picture window of a tea box, with a teacup by the name, chamomile on the page and a tea bag's tag on the Key button. The bear is our own drawing, not a brand's character.
4. **Arcadia**: from a grey engraving to a painting after The Course of Empire (public domain): a bay in evening light, olive land in loose strokes, and the paintings' landmarks in the water (the crag with its balanced boulder that stands in all five, a lone column under vines from Desolation, a temple on a rock, a broken arch, golden clouds). The map hangs in a gilt frame under Cole's sky on a museum wall; panels are wall cards.
5. **Lasso**: after a trick roper. A denim sea with orange double stitching along every coast, tan leather land, a rope laid around the sheet or globe, rope loops spinning over open water, and a reticle that is a rope loop spun flat (it holds still for readers who ask for reduced motion). A hat on the name, rope-framed panels, stitched leather buttons. No person is named or drawn.
6. **Tarot**: Arcana's menu name. The id `arcana` stays, so saved settings keep working; so do `pond` and `nightcap`.
