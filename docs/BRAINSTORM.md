# 2DayAI, brainstorm

Status: idea stage, no code. Written September 4, 2026 from Davis's description. Nothing here is a commitment; it is a working document for shaping the idea before any build.

## The idea in one paragraph

People feel bombarded by news. 2DayAI compresses a whole day of news into one headline built for one reader. The headline can be a single word, a phrase, or a sentence. The reader clicks down through layers: the headline, then the handful of stories it stands for, then the explanation of each story, then the sources. An interest model, seeded by a survey and sharpened over time, decides what the headline stands for. The reader's feeds elsewhere can feed the model.

The one-line pitch: "Your day, in one line. Open it if you want more."

## What is actually new here

Most news products are feeds. A feed is a stack of items and the reader does the compression in their head. Every summary product on the market still hands the reader a list: five bullets, ten stories, "the top stories today". 2DayAI inverts the default. The default is one line and silence. Depth is opt-in and one tap away.

Three things have to be true for that to work:

1. The line has to be worth reading on its own. If it is generic ("Markets fall, Congress stalls"), it is a worse feed, not a better one.
2. The reader has to trust what was left out. A single line hides a lot. The product has to show its work when asked.
3. The interest model has to be right enough that the line feels personal, not algorithmic.

## The compression ladder

Think of the product as a fixed set of zoom levels. Each level is complete on its own.

| Level | What the reader sees | Size |
|---|---|---|
| 0 | The headline. One word to one sentence. | 1 to 15 words |
| 1 | The stories behind it, three to five, each with one sentence. | One screen |
| 2 | One story explained. What happened, why it matters to this reader, what changes next. | 150 to 300 words |
| 3 | The sources. Original articles, primary documents, with quotes that support each claim above. | Links and excerpts |

A "what was left out" panel sits beside level 1. It lists the stories the model saw and did not include, with a one-line reason ("outside your interests", "duplicate of story 2", "low confidence"). This panel is the trust mechanism. It also doubles as the feedback surface: tapping a left-out story tells the model it was wrong.

## The headline itself

The headline is the product. Some formats worth testing:

- A single word. "Tariffs." "Rates." "Quiet." Works when one theme dominates.
- A verb phrase. "Fed held, chips rallied, your commute got cheaper."
- A sentence that names the reader's stake. "Nothing today changes your tax position."
- A mood line for slow days. "Slow day. Two things worth ten minutes."

The last two are important. Most days are not big days. A product that manufactures urgency every day is the bombardment it claims to fix. "Nothing happened that you need" is a legitimate and valuable headline. Very few products are willing to say it.

Rules the generator should follow:

- Never a clickbait construction. No "here's why", no withheld subject.
- Name the reader's stake when there is one, not the abstract event.
- Length follows the day. A quiet day gets a short line.
- One headline per day per reader, generated once at a set time, editable by re-run but not re-fed all day. The scarcity is the point.

## The interest model

This is where the work is. The survey is the seed, not the model.

Onboarding survey, kept short and concrete:

- Where do you live and work. Local news weight.
- What do you do for money. Industry, role, employer type.
- What do you own or owe. Home, investments, crypto, student loans, a business. This sets the "stake" layer.
- What do you follow for fun. Sports teams, artists, hobbies.
- What do you want less of. This is the question no one asks. Let people mute topics on day one.
- How much time per day. Sets the default depth.

Implicit signals after day one:

- Which levels the reader opens. Never opening level 2 on politics is a signal.
- Time spent per story.
- Taps on "what was left out".
- Explicit mute and boost on any story.

Model shape: a weighted topic vector per reader, decaying toward the survey baseline so a one-week obsession does not permanently reshape the feed. Short-term interest and long-term interest kept as separate vectors and blended at generation time. This is the part that "tailors over time" without turning into a rabbit hole.

Feeds from elsewhere (Davis's "integration" note): let the reader connect what they already read. Candidate sources by ease of integration:

- RSS and newsletter subscriptions, via a forwarding address. Easiest, no platform permission needed.
- Bookmarks, read-later apps, browser history export. Rich but private; opt-in only.
- Twitter or X, Reddit, LinkedIn follows. Platform API access is unreliable and expensive; treat as later.
- Calendar. A meeting with a company tomorrow raises that company's weight today. Cheap and surprisingly effective.

## How the pipeline would run

1. Ingest. A fixed set of sources per topic cluster, pulled on a schedule. Start with wire services, major papers, trade press per industry, and primary sources (SEC, IRS, Fed, court filings, agency releases).
2. Cluster. Group articles into events. One event, many articles.
3. Score per reader. Event relevance against the reader's interest vector plus a global importance score.
4. Select. Pick three to five events for level 1. Record the rejected events for the "left out" panel.
5. Explain. Generate level 2 for each selected event with citations to specific passages. Every sentence in the explanation must point at a source excerpt or be dropped.
6. Compress. Generate the level 0 headline from the level 1 set, not from the raw articles. This keeps the headline honest to what the reader can actually open.
7. Deliver. One push notification, one email, or a widget update, at the reader's chosen time.

Steps 1 to 4 run once per day for everyone and can be cached by topic cluster. Steps 5 and 6 run per reader. Cost scales with readers, not with the news volume, which matters for margin.

## Where it could live

- A phone widget and lock-screen line. The strongest fit. The headline is the widget.
- A daily email. Cheapest to build, easiest to test the headline on real people.
- A browser new-tab page. The headline replaces the feed people see by accident.
- A watch complication. Aggressive but on-brand: one line is all a watch can show anyway.

Recommended first surface: email. It needs no app store approval, the open rate measures whether the headline works, and the reply button is a free feedback channel.

## Who has tried something near this

Worth studying before building, not to copy but to know what failed and why:

- Artifact (Instagram founders, 2023 to 2024). AI-summarized personalized news. Shut down. Lesson: a personalized feed of summaries is still a feed, and it competed with every other feed.
- Particle. AI summaries with multi-perspective story pages. Still a list-first product.
- Apple News, Google Discover. Personalized feeds with no compression at all.
- Ground News. Bias and coverage transparency. Good model for the "show your work" layer.
- 1440, Morning Brew, Axios. Human-written daily digests. Prove that people pay attention to a fixed daily ritual, but they are one-size-fits-all.
- Perplexity Discover, ChatGPT Pulse. Daily AI briefings. Generic and long.

None of them ship a one-line default. That is the gap.

## Risks, plainly

- Hallucination. An invented fact in a headline is a product-ending error. Mitigation: the headline is generated from level 1, level 1 from level 2, level 2 from cited excerpts. The chain is auditable. Anything without a citation is cut.
- Licensing. Summarizing paywalled journalism is a live legal fight. Mitigation: link and excerpt rather than reproduce, prefer primary sources, and expect to pay publishers if it grows.
- Filter bubble. A model that only shows what the reader already cares about narrows the reader. Mitigation: a fixed slot at level 1 for one high-importance story outside the interest vector, labeled as such. The "left out" panel also fights this.
- The quiet-day problem. Engagement metrics punish "nothing happened today". The business has to be built on retention and subscription, not daily opens, or the product will drift back toward bombardment.
- Cost. Per-reader generation at levels 2 and 0 is the expensive part. Cache level 2 per event cluster and only personalize the "why it matters to you" paragraph.

## Business shape

Subscription, not ads. Ads reward attention, and the product's promise is less attention. A reasonable price anchor is what people pay for one newsletter or one news app, monthly. A free tier could be email only with the headline and level 1, and the paid tier unlocks levels 2 and 3, feed integrations, and multiple headlines (work, personal, local).

A second product line: a B2B version for firms. "What happened today in tax, in one line, for this client base." That is close to Davis's own field and could be the first paying customer set.

## A first version worth building

Scope for a prototype that tests the core question (does one line beat a list) without building the interest model:

1. Ten hand-picked readers who each fill in the survey by hand.
2. A fixed source list, pulled daily.
3. Clustering and scoring with an LLM call per cluster, no learned model.
4. One email per reader per day: headline, three stories, "left out" list, links.
5. A reply-to-rate feedback loop: readers reply "more", "less", or "wrong" and a human adjusts the weights for a week.

If readers open the email and reply, build the model. If they stop opening in a week, the headline format is wrong and no model will fix it.

## Open questions for Davis

- Is the product for everyone, or for people with a professional stake in news (finance, tax, law, policy)? The second is smaller and easier to charge.
- Should the reader be able to see other readers' headlines? A shared "what did your line say today" could be a social hook or a privacy problem.
- Does it need an app at all, or is it a lifelong email?
- What is the name signaling: "today" or "two-day"? If two-day, the headline could cover yesterday and today as a pair, which is a different product.
