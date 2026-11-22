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
- `src/agent/` — the agent interface (documented in `index.mjs`): what a model job runs, chosen per role by the config's
  `agent`. `claude.mjs`, the default, owns every `claude -p` flag and how its `claude.json` reads; `codex.mjs` runs
  reviewers on the Codex CLI.
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
  - an area's history taken by round, and only its covering rounds (README "History follows files"): the queue's
    order, `staleLines`, settling, calibration's pairs and factors, and the record's "last left" (2026-11-21).
  - the map's queue numbers, which skip areas held by unmerged `audit<N>-<area>` branches as the plan does (2026-11-21).
  - an abandoned round's batch left out of history, carry, and calibration, and a round read from a batch marked
    `pending: 'unmerged'` on the rounds chart (2026-11-21).
  - the map's `gateRuns`, each gate run's id and its `gate.labels` label, for the dashboard (2026-11-21).
  - the map's run `leftOut` and a left-out lane's patch `why`, read from `land.mjs`'s `left out:` lines (2026-11-21).
  - reports the parsers used to misread (2026-11-21): a capitalized `Fixed <sha>` verdict counts as fixed;
    only a `##` section with a `where:` line counts as a finding, and a `## Files Read:` heading lists files read;
    `area.json`'s `questions` counts question verdicts, not the word;
    a matcher reply with braces in its prose still yields its pairs.
  - a branch the batch leaves out: its outcome names the conflicting paths or git's message, a merge that meets a
    lock is retried, and later rounds' batches try it again (README "batch" step, 2026-11-21).
  - `turns`, each job's model turns, on its `usage.jsonl` record (2026-11-21).
  - each area's `lastByRound` on the map, what its `last` was after each round that changed it (README "History follows
    files", 2026-11-21).
  - the map's area `last`, the pass its estimate goes by (its last covering round, corrected), for the dashboard
    (2026-11-21).
  - an area whose branch the capstone dropped, no longer held out of the queue once its round lands, since the branch is
    deleted then (2026-11-21).
  - the map's gate progress, outcomes and failures, read from the night's newest gate log rather than the first listed
    (2026-11-21).
  - an open finding listed under the area now holding its cited paths, not the id of the round that found it, and one
    carried into its new area closed once that area's fixer acts on it: the map's `openFindings` and `open`, the plan's
    "carries N open findings" line, and what a fixer is handed (2026-11-21).
  - each map pass's `fixed`, the defects its fixer's `fix.md` says it fixed, listed or extra, for the dashboard's area
    ledger (2026-11-21).
  - the map's `recuts`, each recorded round's added and split areas, for the dashboard (2026-11-22).
  - a `held:` line in the dry plan, and a refused start, while an earlier round's batch is unmerged (README "Stranded
    rounds", 2026-11-22).
  - the map's area `locked`, the round whose unmerged branch holds it, for the dashboard (2026-11-22).
  - the map's top-level `leftOut`, the branches `left-out.json` still retries, for the dashboard (2026-11-22).
  Everything else stays at parity.
- Never run a real round from here against a project without being asked: a run spends money and fast-forwards
  that project's `main`.

## Todo list

Open work lives in `docs/TODO.md`. Search it rather than reading it whole once it grows; retire an entry in the
change that finishes it.
