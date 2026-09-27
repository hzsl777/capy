# capy: agent guide

Two products in one npm-workspaces repository:

- **2DayAI** (`packages/core`, `db`, `pipeline`, `web`): one sourced headline per reader per day, delivered by email. The design is docs/SPEC.md, later changes are docs/DECISIONS.md, operations are docs/RUNBOOK.md. Read SPEC.md section 9 (engineering rules) before touching these packages.
- **The map** (`packages/map`): a public news map by place. Its guide, including hard neutrality rules, is packages/map/AGENTS.md. Read it before touching the map.

Read CONTEXT.md first: it is the whole picture and what Davis has decided. Decision 23 is the plan of record: one pipeline and one database, publisher pins, a telegram line per region, and map work after milestone 4. `packages/map` is a design prototype built ahead of that on stand-in GDELT data; decision 24 lists what it changes before it ships.

## Rules for the whole repository

- Decisions go in docs/DECISIONS.md, one entry each. Never edit an entry; a reversal is a new entry that names the old one.
- Package boundaries are enforced by `npm run lint` (tools/check-boundaries.mjs). Only `packages/pipeline/src/llm/` may import the Anthropic SDK. The map imports nothing from the workspace for now.
- Secrets live in GitHub Actions and Cloudflare secrets, never in the repository. CI runs a secret scan.
- Tests never call the network. Use recorded fixtures (2DayAI) or `packages/map/test/fixtures` (map).
- No em dashes in copy, docs or commit messages.
- The repository is private: Actions has 2,000 free minutes a month. Don't add scheduled jobs without checking the budget in README.md "Hosting".

## Commands

```
npm install
npm run check          boundaries, typecheck (every package), tests (every package)
npm run map:build      the map's production build (CI runs this too)
npm run stage -- ...   2DayAI CLI; see README.md and docs/RUNBOOK.md
npm run map:dev        the map with placeholder data
```

Before pushing: `npm run check && npm run map:build`.
