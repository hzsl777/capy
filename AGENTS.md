# capy: agent guide

Two products in one npm-workspaces repository:

- **2DayAI** (`packages/core`, `db`, `pipeline`, `web`): one sourced headline per reader per day, delivered by email. The design is docs/SPEC.md, later changes are docs/DECISIONS.md, operations are docs/RUNBOOK.md. Read SPEC.md section 9 (engineering rules) before touching these packages.
- **The map** (`packages/map`): a public news map by place. Its guide, including hard neutrality rules, is packages/map/AGENTS.md. Read it before touching the map.

Read CONTEXT.md first: it is the whole picture and what Davis has decided. Both products run on one pipeline and one database (decisions 23, 25 and 26). Sources are on the briefing desk (2DayAI editions) or the world desk (the map and its one-word mood telegram). The Worker serves the map and builds its data from the database.

## Rules for the whole repository

- Decisions go in docs/DECISIONS.md, one entry each. Never edit an entry. A reversal is a new entry that names the old one.
- Package boundaries are enforced by `npm run lint` (tools/check-boundaries.mjs). Only `packages/pipeline/src/llm/` may import the Anthropic SDK. The map imports core's types only.
- Secrets live in GitHub Actions and Cloudflare secrets, never in the repository. CI runs a secret scan.
- Tests never call the network. Use the recorded fixtures in `packages/pipeline/src/fixtures` (briefing and the fictional world desk) and the FakeLlm.
- No em dashes in copy, docs or commit messages.
- The repository is private: Actions has 2,000 free minutes a month. Don't add scheduled jobs without checking the budget in README.md "Hosting".

## Commands

```
npm install
npm run check          boundaries, typecheck (every package), tests (every package)
npm run map:build      the map's production build (CI runs this too)
npm run stage -- ...   2DayAI CLI; see README.md and docs/RUNBOOK.md
npm run map:sample     the fictional world day through the real stages into the site's sample data
npm run map:dev        the site on that sample
```

Before pushing: `npm run check && npm run map:build`.
