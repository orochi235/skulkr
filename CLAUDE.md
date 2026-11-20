# x-skulk

Nightly blind-pair audit rounds over any git repository, configured by that repository's `skulk.config.mjs`;
extracted from weasel's `scripts/skulk` on 2026-11-20. `x-skulk` is a code name: build nothing costly to rename on it.
README.md is the documentation: how a project adopts it, a run's steps, the service, the dashboard, and the
weasel cutover.

## Layout

- `bin/skulk.mjs` — the one command (`night`, `partition`, `map`, `defects`, `service`, `config`).
- `src/` — the pipeline, plain Node ESM `.mjs` with no build. `config.mjs` holds every default and derives the
  names and regexes the rest reads; no other file may hold a project-specific value.
- `src/runner/` — the runner interface (documented in `onto.mjs`) and its onto implementation.
- `briefs/` — the shipped default briefs. `examples/weasel.config.mjs` and `examples/weasel/` are weasel's config,
  briefs, and control-sweep adapter, kept to reproduce weasel's behavior exactly.
- `dashboard/` — the standalone Vite app, its own package (not a workspace); `dashboard/README.md`.

## Commands

- One test file: `npx vitest run --maxWorkers=1 <file>`. Anything bigger goes to the fleet (`onto test`).
- `npm run typecheck`.

## Rules

- weasel must keep behaving as it did: a change to `src/` keeps `examples/weasel.config.mjs` producing the same
  partition, plan, record, and map as weasel's own `scripts/skulk` until weasel cuts over.
- Never run a real round from here against a project without being asked: a run spends money and fast-forwards
  that project's `main`.

## Todo list

Open work lives in `docs/TODO.md`. Search it rather than reading it whole once it grows; retire an entry in the
change that finishes it.
