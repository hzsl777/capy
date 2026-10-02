# Prompts

Every model call in this repository uses one of seven prompt files in `packages/core/prompts/`. This page explains what each one does, what is sent to the model around it, and how to change one safely. Nothing is set up in the OpenAI dashboard for these; see docs/OPENAI.md.

## What one call sends

Each call is one POST to `/v1/chat/completions` from `packages/pipeline/src/llm/chat.ts`. There is no SDK. The body has:

- `model`: `gpt-5.4-nano` for the bulk stages, `gpt-5.4-mini` for the judgment stages (`MODEL` and `MODEL_TELEGRAM` override them).
- Two messages:
  - **system**: the prompt file's full text, then one added paragraph: "Reply with one JSON object and nothing else. It must match this JSON Schema:" followed by the answer's schema, generated from the Zod schema in `packages/core/src`.
  - **user**: the day's material, built by the stage in code (article lines, event blocks, a reader's profile). This part changes every day. The prompt file does not.
- `response_format: {"type": "json_object"}`, so the model answers in JSON.
- `reasoning_effort`: `high` for the telegram and 2DayAI's select, `low` for everything else (`LLM_THINKING`).
- `service_tier: "flex"`: half price, slower. If OpenAI refuses flex, the call is sent again on the default tier, and the rest of the run skips flex.
- `max_completion_tokens`: 65,536, the cap on the answer, reasoning included.

When the answer comes back, code checks it against the schema, then runs the stage's own checks (below). A failed check is either retried once with the problems listed, or the item is dropped, depending on the stage. Every call is logged with its tokens and cost in the `llm_calls` table, including the prompt label, for example `telegram-score.v1`.

The prompts are the same text every day and come first in the request, so OpenAI's automatic prompt cache bills repeated input at a tenth of the price. Nothing needs to be turned on for that.

## The seven prompts

| File | Stage | Product | Model | Calls a day |
|---|---|---|---|---|
| `cluster-world.v4.md` | cluster world | map | nano | one per 300 articles, up to 12 |
| `cluster-world-merge.v2.md` | cluster world | map | nano, then mini | one when there was more than one batch, and one over the events of importance 3 or more (decision 108) |
| `explain.v1.md` | explain | both | nano | one per event explained, up to 25 for the map |
| `telegram-score.v1.md` | telegram | map | mini | 3 (`TELEGRAM_SCORE_RUNS`) |
| `telegram-word.v1.md` | telegram | map | mini | one |
| `cluster.v1.md` | cluster | 2DayAI | nano | one, only with readers |
| `select.v1.md` | select | 2DayAI | mini | one per reader |

`cluster-world.v1.md` and `v2.md` are older versions, kept because past outputs carry their labels. v3 adds where each event happened (decision 44).

### cluster-world: group the day's articles into events

Input: one line per article, `[id] headline (outlet)`, then the first 200 characters of its summary. At most 15 articles per outlet.

Output: events, each with its article ids, a neutral title of at most twelve words, an importance from 1 to 5 with a short reason, one of ten topics, and where it happened (a city, its country code and a rough point, or null). Plus the articles skipped as not news.

Code checks: every id appears exactly once, no invented ids. Unknown ids are dropped and counted, and so is an event with no articles. The city is checked against the fixed city list (`packages/pipeline/src/places.ts`): a listed city gets the list's point, an unlisted town only a point near a listed city of its country, and anything else leaves the story at its outlet's city. If an answer runs past the output limit, that batch is split in half and asked again, up to three times. If any batch still fails, the stage writes nothing and the previous day stays up.

### cluster-world-merge: join the same story across batches

Input: every event from the batches, with a key, title, topic, importance and the outlets that reported it.

Output: groups of two or more keys that report the same happening, each with a title.

Code checks: keys must exist and appear in only one group. A bad group is dropped, never guessed at. When unsure, the prompt tells the model to keep events apart.

### explain: the sourced explanation

Input: the event's title and the text of its source articles (up to 16,000 characters for the map, 45,000 for 2DayAI).

Output: three lists of sentences (what happened, why it matters, what changes next). Every sentence carries a citation: an article id and a passage copied from that article.

Code checks: each passage must appear in the article word for word, after normalising spaces and quotes. A sentence whose passage isn't found is removed. This is how the site shows only text a program has checked against a source.

### telegram-score: score each event from -2 to 2

Input: the day's explained events, each with its title, topic, importance, places and checked sentences.

Output: a score per event and, as the reason, one of that event's sentences copied exactly.

Code checks: every event scored once, the reason is one of its own sentences. One retry, then the stage fails and the site shows no word. The call runs three times and each event keeps its middle score (decision 36).

### telegram-word: the day's word

Input: the band that code computed from the scores, the words allowed for it, and the scored events.

Output: one word from the list, and one to five events with a line each.

Code checks: the word is on the band's list; on a bad day, the event that set the band is named. One retry, then the stage fails.

### cluster and select (2DayAI)

`cluster.v1.md` groups briefing-desk articles, like cluster-world but with primary sources ranked above press coverage. `select.v1.md` builds one reader's edition: three to five events, a line each, why each matters to that reader, and the day's headline. Code checks that select picks only listed events, each once, at least three when three exist, lines of at most 25 words, and a headline that follows the rules (no question marks, no teasers). One retry, then that reader gets no edition that day.

## Try a prompt in the Playground

To see how a model answers one of these calls, or to try a change before making a new version, paste it into the OpenAI Playground (platform.openai.com, then Playground). Print everything you need with:

```
npm run stage -- prompt telegram-score
```

Any of the seven names works. The command needs no key and no database. It prints the settings, the system message exactly as the pipeline sends it (the prompt file plus the JSON Schema line), and a sample user message from the fictional world day. 2DayAI's `cluster` and `select` have no sample, because they need reader profiles; write one by hand from `config/readers/r00.example.yaml`.

In the Playground's panel:

| Setting | Set it to |
|---|---|
| Prompt box ("Describe desired model behavior") | the system message the command printed |
| Model | the model it printed: `gpt-5.4-nano` for the grouping and explain calls, `gpt-5.4-mini` for the telegram and select. The Playground may default to another model, such as `gpt-6-luna`. |
| Text format | JSON object |
| Reasoning mode | standard |
| Reasoning effort | what it printed: `low` for nano calls, `high` for mini calls |
| Verbosity, Summary | leave as they are; the pipeline doesn't send them |
| Store logs | either. Playground runs are kept in the dashboard's Logs when on; the pipeline's calls never are |
| Hosted tools (MCP, file search, web search, code interpreter and the rest) | all off. The pipeline uses none, and web search would let the model use facts the sources don't contain |
| Variables | none |

Then paste the user message into the chat box below the panel and run it. The answer should be one JSON object. The Playground doesn't run the code checks, so check by eye what they would: for `telegram-score`, every event scored once, and each reason copied exactly from that event's sentences.

Playground runs are billed like the pipeline's calls, usually well under a cent each, from the same credit. Saving a prompt there doesn't change what the pipeline sends: the pipeline only reads the files in `packages/core/prompts/`. The Playground uses OpenAI's newer Responses API and the pipeline uses Chat Completions. The model and the messages are the same, so answers match closely, though not always word for word.

## Changing a prompt

A prompt file is never edited in place. Outputs store the label of the prompt that made them, so an edited file would make old labels lie.

1. Copy the file to the next version, for example `telegram-word.v1.md` to `telegram-word.v2.md`, and make the change there.
2. Raise the version constant in the stage: `TELEGRAM_WORD_PROMPT_VERSION` in `packages/pipeline/src/stages/telegram.ts`. The constants for the other stages sit at the top of `cluster.ts`, `explain.ts` and `select.ts`.
3. Update the fake model in `packages/pipeline/src/fixtures/` if the input or output format changed, and run `npm run check`.
4. Compare the old and new versions on a real day: run the "Model eval" workflow, or re-run the stage on a past date locally, and read the outputs side by side. For a quick first look, run `npm run stage -- prompt <name>` and try both versions in the Playground on the same user message.
5. Add an entry to docs/DECISIONS.md saying what changed and why. For the telegram and cluster-world prompts, also run the neutrality-review skill.

The scoring scale, the word lists and the band formula are code, not prompt (`packages/core/src/world.ts`). Changing them needs a decision too.
