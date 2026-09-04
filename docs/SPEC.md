# 2DayAI, product and engineering spec

Version 0.2, September 4, 2026. Companion to 2DAYAI.md (the brainstorm). This document makes the engineering decisions up front so the prototype is built once. Decisions are numbered so they can be referenced and, if needed, reversed with a note rather than silently.

Decisions taken with Davis on September 4, 2026: first audience is professionals with a stake in the news, then generalize; the name means "today"; the next steps are this spec, then a prototype; the AI writes the headline; the running budget is zero until the concept proves itself; the code lives in a new public repository, hzsl777/2dayai; Claude builds the scaffold, then Davis and Claude iterate on judgment cases, with review passes from other models. Later the same day: the model is Sonnet 5; Davis is reader one and the only reader through version 0.1; delivery hour is per reader from the start.

## 1. What the prototype must prove

One question: does one line beat a list.

The test runs in two phases.

Phase one, version 0.1, has one reader: Davis. The pipeline is built and tuned against Davis's own profile until three things hold for a week running: the headline reads as true and worth the glance, the drill-down from headline to story to sources holds up without a false claim, and the aggregation catches what Davis would have wanted and leaves out what Davis would have skipped. Davis is the lab rat by choice, so onboarding, the profile format, and the selection prompt are shaped on one real person before they are generalized.

Phase two, version 0.2, adds nine hand-picked readers for two weeks. It succeeds if a majority still open the daily email at the end and at least half have sent feedback through the links. It fails if opens fall below half by week two.

Everything in this spec serves those tests. Nothing is built that the tests do not need.

One content model, three presentations. The headline, the story lines, and the explanations are not three pieces of writing. They are one set of events with citations, rendered at three depths. The reader who wants simplicity stops at the top. The reader who wants depth keeps going and finds the same facts, not a different article. What changes between levels is presentation, never substance.

## 2. What it is not

- Not a trained model. There is no PyTorch, no fine-tuning, no GPU. The "AI" is a pipeline of retrieval, clustering, scoring, and generation calls to a hosted model with citations enforced in code.
- Not retrieval-augmented chat. No reader types a question. The pipeline runs once a day and produces one edition per reader.
- Not an app. Version 0 is an email plus a small web layer for the deeper levels and for feedback.
- Not a general news product. Version 0 covers a professional-stake beat: tax, accounting, regulation, markets, and the industries the ten readers work in.

## 3. Product surface, version 0

Each reader receives one email at their chosen time. The email carries:

1. Level 0. The headline. One word to one sentence. The subject line and the first line of the body are the same text.
2. Level 1. Three to five events, each with a one-sentence line and a link.
3. The "left out" list. Up to five events the pipeline saw and did not select, each with a reason in five words or fewer, and a link to promote it.
4. Feedback links on every event: more, less, wrong.

Each level 1 link opens a reader page on the web layer:

- Level 2. The event explained. What happened, why it matters to this reader, what changes next. 150 to 300 words. Every sentence carries a citation marker.
- Level 3. The sources. Each citation resolves to an article title, publisher, link, and the excerpt that supports the sentence.

Reader pages need no login. Each reader has an unguessable token in their URLs. This is enough for ten people and is replaced by real accounts if the product continues.

## 4. Architecture

Three runtimes, all on free tiers, one language.

| Part | Runs on | Job |
|---|---|---|
| Pipeline | GitHub Actions, scheduled daily | Ingest, cluster, explain, select, headline, send |
| Database | Neon Postgres, free tier | Every artifact of every run, plus feedback |
| Web layer | Cloudflare Workers, free tier | Reader pages for levels 2 and 3, feedback endpoints |

The pipeline writes. The web layer reads and records feedback. Neither calls the other. The database is the contract between them.

Decision 1. Language is TypeScript on Node 22, strict mode, ES modules. Reasons: one language now for the pipeline and later for any web or mobile front; the Anthropic SDK has first-class structured outputs through Zod; Davis's existing site is TypeScript; Cloudflare Workers run TypeScript natively; the reviewing models handle TypeScript well. Python was the alternative. It wins on data science libraries, none of which version 0 needs.

Decision 2. Scheduling is a GitHub Actions cron workflow. Free, versioned with the code, and the run log is the audit trail. It moves to a proper scheduler only if the run exceeds the free minutes or needs to fire per reader.

Decision 3. The database is Postgres on Neon. Free tier, scales to zero, database branching for development. SQLite was the alternative and loses because the Worker cannot read a file in the Actions runner. Access from both runtimes goes through Drizzle ORM with one shared schema package.

Decision 4. Email goes through Resend. Free tier covers 3,000 sends a month, and ten readers need about 300.

Decision 5. The web layer is a single Cloudflare Worker using Hono, rendering server-side HTML with no client JavaScript. It serves reader pages and feedback endpoints. Free tier covers 100,000 requests a day.

Decision 6. Everything is idempotent per date. Any stage can be re-run for a date and overwrites its own output for that date. This is what makes iteration on prompts safe: change a prompt, re-run yesterday, diff the result.

## 5. The model layer

Decision 7. All model calls go through the Anthropic SDK, in one module, `packages/pipeline/src/llm/`. Nothing else in the codebase imports the SDK. Every call declares a Zod schema for its output and uses structured outputs, so a malformed response fails at the boundary rather than deep in the pipeline.

Decision 8. The model is `claude-sonnet-5` for the prototype, chosen by Davis on cost, set in one config value, never inline. Adaptive thinking is left on. Effort is set per call: `low` for clustering and selection, `medium` for explanations, `high` for the headline.

Decision 9. Per-reader and per-event generation runs through the Message Batches API. The batch completes within an hour in most cases and costs half. The pipeline starts early enough that a slow batch still lands before delivery time. Clustering runs as a single direct call because everything downstream waits on it.

Decision 10. Every call is logged to an `llm_calls` table with model, prompt version, input tokens, output tokens, cache reads, and cost. This is how the budget is watched. The daily workflow fails loudly if the day's spend exceeds a configured ceiling.

Decision 11. Prompts are files, not strings in code. They live in `packages/core/prompts/`, each with a version number in its filename. The version is stored on every output the prompt produced. Changing a prompt means a new version, never an edit in place, so results stay comparable.

Decision 12. No embeddings in version 0. Clustering is done by the model in one call over the day's article titles and leads, which fit comfortably in context. Embeddings for deduplication and topic vectors come in version 1 when article volume or reader count makes the single call impractical.

The call shape the code will use, shown so reviewers can check it:

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

const response = await client.messages.parse({
  model: config.model,
  max_tokens: 16000,
  output_config: { format: zodOutputFormat(ClusterResultSchema), effort: "low" },
  system: [{ type: "text", text: prompt.system, cache_control: { type: "ephemeral" } }],
  messages: [{ role: "user", content: prompt.render(articles) }],
});
if (!response.parsed_output) throw new LlmParseError(response);
```

Cost estimate for ten readers a day, batch pricing where used, Sonnet 5 rates as of the SDK reference (2 dollars per million input, 10 per million output). With one reader in version 0.1 the daily figure is about a third of the total below.

| Stage | Calls per day | Approximate tokens | Cost per day |
|---|---|---|---|
| Cluster | 1 direct | 45k in, 3k out | 0.12 |
| Explain events | about 25, batched | 100k in, 12k out | 0.16 |
| Select and headline | 10, batched | 80k in, 8k out | 0.12 |
| Total | | | about 0.40, about 12 a month |

The model call is the only line that cannot be zero. Opus 5 would run the same pipeline at roughly two and a half times this figure, Haiku 4.5 at roughly half. The model is one config value, so the choice can change in a minute.

## 6. The pipeline, stage by stage

Each stage is a function with a typed input, a typed output, and a row written to the database. Stages run in order. A failed stage stops the run and the workflow reports which stage and why.

### 6.1 Ingest

Input: `config/sources.yaml`, a list of RSS and Atom feeds with a topic tag and a trust tier. Output: rows in `articles` with url, title, lead, published time, source, and the full text where the feed carries it. Deduplicated by canonical URL. No paywall bypass. Where a feed gives only a title and link, the article is used for clustering by its title and lead and cannot supply excerpts for citations.

Version 0 sources: fifteen to twenty-five feeds chosen by Davis, weighted to primary sources (IRS newsroom, SEC releases, Federal Register, Federal Reserve, Treasury), trade press (Journal of Accountancy, Accounting Today), and two or three general wires. Open decision B.

### 6.2 Cluster

Input: the day's articles. Output: rows in `events` and `event_articles`. One model call. The schema returns a list of events, each with a working title, the member article ids, and a global importance score from 1 to 5 with a one-line reason. Articles that fit no event are marked singletons and still eligible for selection.

### 6.3 Explain

Input: each event with its articles' text. Output: one row in `event_explanations` per event, with the three-part explanation (what happened, why it matters in general, what changes next) and a list of citations. Batched.

The schema returns sentences as objects, each with text and an array of citation ids. A citation id points at an excerpt the model quotes verbatim from a specific article. A validator then checks every excerpt is a substring of the cited article's text. A sentence with no valid citation is dropped. An explanation with fewer than three surviving sentences is marked unusable and the event cannot be selected for anyone that day. This rule is the hallucination control and is not optional.

### 6.4 Select

Input: the day's usable events and one reader's profile. Output: rows in `edition_items` for the reader, three to five selected, up to five rejected with a reason code. Batched, one call per reader.

The profile in version 0 is a hand-written YAML file per reader: topics with weights from 1 to 5, muted topics, stake facts in plain sentences ("owns a home in Charlotte", "works in international tax at a manufacturer"), and preferred delivery hour. The model receives the profile and the events and returns the selection with reasons. One slot is reserved for the highest global-importance event outside the reader's topics, labeled as such, so the line never becomes a bubble.

### 6.5 Headline and stake

Same call as select. The model also returns, for each selected event, one "why this matters to you" paragraph that personalizes the shared explanation, and then the headline. The prompt tells the model to write the headline from the selected events only, never from the raw articles, and gives the quiet-day permission explicitly: when nothing selected clears an importance threshold, the headline says so plainly.

Headline rules enforced in the prompt and checked by a validator: at most fifteen words, no question form, no withheld subject, no colon-led teaser, no exclamation mark.

### 6.6 Deliver

Input: the reader's edition. Output: one email sent through Resend, one row in `deliveries` with the provider message id. The email template is a single file. The subject line is the headline.

### 6.7 Feedback

The Worker receives `more`, `less`, `wrong`, and `promote` on any event and writes a row in `feedback`. Version 0 does nothing automatic with it. Davis reads the feedback weekly and edits the reader's YAML by hand. Version 1 turns feedback into weight adjustments.

## 7. Data model

Tables, with the columns that matter. Drizzle schema is the source of truth; this is the map.

- `sources`: id, name, url, topic, tier.
- `articles`: id, source_id, url, title, lead, body, published_at, fetched_at.
- `events`: id, run_date, title, importance, importance_reason, prompt_version.
- `event_articles`: event_id, article_id.
- `event_explanations`: event_id, sentences (jsonb: text, citations), usable, prompt_version.
- `citations`: id, event_id, article_id, excerpt, verified.
- `readers`: id, token, email, delivery_hour, timezone, profile_version.
- `reader_profiles`: reader_id, version, yaml, created_at.
- `editions`: id, reader_id, run_date, headline, quiet_day, prompt_version, sent_at.
- `edition_items`: edition_id, event_id, rank, selected, reason_code, stake_paragraph.
- `feedback`: id, reader_id, event_id, kind, created_at.
- `deliveries`: edition_id, provider_id, status.
- `llm_calls`: id, run_date, stage, model, prompt_version, input_tokens, output_tokens, cache_read_tokens, cost_usd.

Reader email addresses live only in the database and in a private environment file. Profiles are committed to the repository under `config/readers/` with ids, not names, in the filenames.

## 8. Repository layout

New repository, name to confirm, suggested `2dayai`. npm workspaces, four packages, so boundaries are enforced by imports rather than by discipline.

```
2dayai/
  package.json              workspaces, shared scripts
  tsconfig.base.json
  config/
    sources.yaml
    readers/r01.yaml ...
  packages/
    core/                   pure code: types, Zod schemas, validators, prompt loader
      prompts/              cluster.v1.md, explain.v1.md, select.v1.md
    db/                     Drizzle schema, migrations, client factory
    pipeline/               stages, llm module, CLI entry (run one stage or the whole day)
    web/                    Cloudflare Worker: reader pages, feedback endpoints
  docs/
    SPEC.md                 this document
    DECISIONS.md            one entry per numbered decision, with reversals
    RUNBOOK.md              how to run a day locally, re-run a stage, rotate a key
  .github/workflows/
    daily.yml               cron, runs the pipeline
    ci.yml                  typecheck, lint, test on every push
```

Dependency rules, enforced by an ESLint boundary rule:

- `core` imports nothing from the other packages.
- `db` imports `core`.
- `pipeline` imports `core` and `db`.
- `web` imports `core` and `db`.
- Only `pipeline/src/llm/` imports the Anthropic SDK.

## 9. Engineering rules

These are the anti-spaghetti rules Davis asked for. They are short so they get followed.

1. Every model output passes a Zod schema at the boundary. No `any`, no JSON parsing outside the llm module.
2. Every stage is a pure function over typed inputs plus one database write. No stage reads another stage's in-memory result; it reads the table.
3. Every stage can be re-run for a date from the CLI: `npm run stage -- cluster --date 2026-09-04`.
4. Prompts are versioned files. Outputs record the version. Editing a prompt in place is a bug.
5. Every claim in an explanation has a verified citation or it does not ship.
6. The model id, the effort per stage, the daily spend ceiling, and the delivery hour are config, not code.
7. Tests use recorded feed fixtures and recorded model responses. The test suite never calls the network.
8. Secrets live in GitHub Actions secrets and Cloudflare secrets. The repository never contains one. A pre-commit secret scan runs on every commit.
9. A change that touches a prompt ships with a before-and-after run on the same past date, attached to the pull request.
10. One decision, one entry in DECISIONS.md. Reversals are new entries, not edits.

## 10. Testing and evaluation

- Unit tests (Vitest) on validators: citation verification, headline rules, selection constraints.
- Fixture tests on each stage with recorded inputs and recorded model outputs, so the pipeline logic is tested without spend.
- A headline evaluation set, built after the first week from real editions: twenty headlines rated by Davis on a three-point scale. It becomes the regression check for prompt changes. This is deliberately deferred until there are real editions to rate.
- The contrast and accessibility checks from the site are not needed; the email and reader pages are plain HTML with system fonts.

## 11. Review passes with other models

Davis wants Codex and Grok in the loop. Defined handoff points so their input lands somewhere:

1. Spec review, now. Hand this document to each and ask for the three weakest decisions and why. Record any accepted change in DECISIONS.md.
2. Prompt review, after milestone 2. Hand each prompt with three recorded runs. Ask for failure modes, not rewrites.
3. Code review, at each milestone pull request. Ask for boundary violations and untested branches.

Reviews are inputs. Davis decides. Claude implements.

## 12. Open decisions for Davis

Decided September 4, 2026: model is Sonnet 5 (A); Davis is reader one (C); the repository is public at hzsl777/2dayai (D); delivery hour is per reader (E).

Still open:

- B. The source list. Fifteen to twenty-five feeds. Davis knows the beat. Milestone 0 ships with a starter list of primary sources and trade press that Davis edits.
- F. Davis's own profile. The first `config/readers/r01.yaml` is written with Davis at milestone 2 and is the template for every profile after it.

## 13. Milestones

Each milestone is one pull request, reviewed, merged, and runnable end to end for what it covers.

| Milestone | Delivers | Proves |
|---|---|---|
| M0 | Repository, workspaces, database schema, CI, ingest from sources.yaml | Feeds land in Postgres daily |
| M1 | Cluster and explain with citation verification | Events and explanations exist and every sentence is backed |
| M2 | Davis's profile, select, headline, edition printed to the terminal | One real edition a day for Davis, judged daily |
| M3 | Resend delivery, Worker reader pages, feedback links | The full loop works for Davis; this is version 0.1 |
| M4 | Tuning loop: Davis rates headlines and drill-downs daily for a week, prompts revised by version | The three phase-one conditions hold for a week |
| M5 | Nine more readers, two weeks, feedback read weekly | The phase-two question is answered; this is version 0.2 |

After M5 the decision is build the interest model or stop. Nothing in version 1 (embeddings, learned weights, accounts, a widget, a general audience) is started before that decision.

## 14. What happens next

1. Claude creates hzsl777/2dayai and pushes milestone 0.
2. Davis adds three secrets to the repository: the Anthropic API key, the Neon connection string, the Resend API key. Neon and Resend accounts are free to open.
3. Davis edits the starter source list.
4. Claude builds milestones 1 and 2. Davis writes reader profile r01 with Claude at milestone 2.
