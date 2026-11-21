# skulkr

Nightly blind-pair audit rounds over any git repository, configured by that repository's `skulkr.config.mjs`;
extracted from weasel's `scripts/skulk` on 2026-11-20.
README.md is the documentation: how a project adopts it, a run's steps, the service, the dashboard, and the
weasel cutover.

## Layout

- `bin/skulkr.mjs` — the one command (`init`, `night`, `partition`, `map`, `defects`, `service`, `config`, `tenants`).
- `src/` — the pipeline, plain Node ESM `.mjs` with no build. `config.mjs` holds every default and derives the
  names and regexes the rest reads; no other file may hold a project-specific value.
- `src/runner/` — the runner interface (documented in `onto.mjs`): `local.mjs`, the default, runs every job on this
  machine; `onto.mjs` runs them on an onto fleet. Jobs launch only through the runner; outside `src/runner/`, onto
  appears only where `gate.mjs` reads `onto: progress` lines out of the gate command's own log.
- `briefs/` — the shipped default briefs. `examples/weasel.config.mjs` and `examples/weasel/` are weasel's config,
  briefs, and control-sweep adapter, kept to reproduce weasel's behavior exactly.
- `dashboard/` — the standalone Vite app, its own package (not a workspace); `dashboard/README.md`.

## Commands

- One test file: `npx vitest run --maxWorkers=1 <file>`. Anything bigger goes to the fleet (`onto test`).
- `npm run typecheck`.

## Rules

- weasel must keep behaving as it did: a change to `src/` keeps `examples/weasel.config.mjs` producing the same
  partition, plan, record, and map as weasel's own `scripts/skulk` until weasel cuts over, except where area stats
  now survive code changing outside the audits (2026-11-20, README "History follows files" and "Stale estimates"):
  - the queue's order among due areas (most lines changed since their last pass first) and the plan's listing of it;
  - which passes an area's history holds (by overlapping files, not id), so its passes' `est` and `left`, the
    record's "last left", and "never audited" for an area passes cover under half of;
  - the map's `staleLines` and pass `share`, and the rounds chart's sums, which count each pass once with its
    recorded file count.
  - the queue's order among due areas by corrected defects left first (README "Which areas"), and the map's
    `leftCorrected` and `calibration` (README "Calibration"), from 2026-11-20.
  - the map's `gateRuns`, each gate run's id and its `gate.labels` label, for the dashboard (2026-11-21).
  - a branch the batch leaves out: its outcome names the conflicting paths or git's message, a merge that meets a
    lock is retried, and later rounds' batches try it again (README "batch" step, 2026-11-21).
  - `turns`, each job's model turns, on its `usage.jsonl` record (2026-11-21).
  Everything else stays at parity.
- Never run a real round from here against a project without being asked: a run spends money and fast-forwards
  that project's `main`.

## Todo list

Open work lives in `docs/TODO.md`. Search it rather than reading it whole once it grows; retire an entry in the
change that finishes it.
