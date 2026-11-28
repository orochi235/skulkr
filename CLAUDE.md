# skulkr

Nightly blind-pair audit rounds over any git repository, configured by that repository's `.skulkr/config.mjs` (or `skulkr.config.mjs` at its root);
extracted from weasel's `scripts/skulk` on 2026-11-20.
README.md is the documentation: how a project adopts it, a run's steps, the service, the dashboard, and the
weasel cutover.

## Layout

- `bin/skulkr.mjs` — the one command (`init`, `night`, `partition`, `map`, `defects`, `pin`, `unpin`, `saturate` or
  `sat`, `service`, `config`, `tenants`).
- `src/defectGraph.mjs` — which findings are one defect, over rounds and landed saturation ledgers; `registry.mjs`
  writes it as `.skulkr/defects/`, `recordIndex.mjs` builds the SQLite index `skulkr q` reads.
- `src/saturate.mjs` — `skulkr scour` (README "Scour"): the fix queue in `scourFixQueue.mjs`, session mode's `next` in `scourSession.mjs` (a subagent's cost in
  `agentCost.mjs`), folding in `scourFold.mjs`, `run` in `scourRun.mjs`, prices in `scourPrice.mjs`, fleet mode's jobs in `saturateJobs.mjs`, `import` in
  `saturateImport.mjs`, `land` in `saturateLand.mjs`, `ls` in `saturationList.mjs`, the ledger in `ledger.mjs`, the statistics in `saturation.mjs`, the report in `saturationReport.mjs`. Nothing in rounds reads them.
- `src/` — the pipeline, plain Node ESM `.mjs` with no build. `config.mjs` holds every default and derives the
  names and regexes the rest reads; no other file may hold a project-specific value.
- `src/runner/` — the runner interface (documented in `onto.mjs`): `local.mjs`, the default, runs every job on this
  machine; `onto.mjs` runs them on an onto fleet. Jobs launch only through the runner; outside `src/runner/`, onto
  appears only where `gate.mjs` reads `onto: progress` lines out of the gate command's own log.
- `src/agent/` — the agent interface (documented in `index.mjs`): what a model job runs, chosen per role by the config's
  `agent`. `claude.mjs`, the default, owns every `claude -p` flag and how its `claude.json` reads; `codex.mjs` runs
  reviewers on the Codex CLI.
- `skills/` — agent skills that drive skulkr, linked into an agent's skills directory: `skulkr-scour`, which runs a
  scour's passes as the Claude Code session's own subagents, and
  `skulkr-review-saturation`, Codex's hand-run saturation review, which ingests its report into the area's ledger.
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
    From 2026-11-24, a fixer's verdict line reads as one with no sha after `fixed`, opening with its verdict
    (`fixed <sha> — claim (A)`), or with a claim that opens with a verdict's word; a source like `(A+B; …)` counts;
    and a line that only names a sha, opening the report, is no defect.
  - a branch the batch leaves out: its outcome names the conflicting paths or git's message, a merge that meets a
    lock is retried, and later rounds' batches try it again (README "batch" step, 2026-11-21).
  - `turns`, each job's model turns, on its `usage.jsonl` record (2026-11-21).
  - each area's `lastByRound` on the map, what its `last` was after each round that changed it (README "History follows
    files", 2026-11-21).
  - the map's area `last`, the pass its estimate goes by (its last covering round, corrected), for the dashboard
    (2026-11-21).
  - an area whose branch the capstone dropped, no longer held out of the queue once its round lands, since the branch is
    deleted then (2026-11-21).
  - a round's cost per area and per file (`usdPerArea`, `usdPerFile`) on its status, summary, map run, menu line
    and dashboard spend, each summary area's `files`, the record's per-file column and totals, and status's
    `estimateUsdPerArea` (2026-11-23).
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
  - a round that runs a capstone cycle past the first, while each leaves fewer failures, and a gate rerun once when it
    fails naming no failure (README "capstone" and "merge" steps, 2026-11-22).
  - an early landing (README "Early landings", 2026-11-22): part of a round batched, gated and landed while the rest
    still fix, its areas' outcomes reading `landed early at <sha>`, and the round's report leading with how many.
  - a failed step that is a file of tests, laid at branches by `gate.blame` reading each failing test's name, and
    weasel's blame laying a failed package lint at what biome flags or the package (README "Verify and repair",
    2026-11-22).
  - the record's `partition.json`, partitioned from the batch's tree rather than the round's frozen commit, so it no
    longer lags one landing behind `main` (README "A run", 2026-11-22).
  - reviewers' prompts carrying their area's files (`review.preload`, the default), and each pair's B starting 30
    seconds after its A (README "A run", 2026-11-22).
  - the gate overhaul (README "Preflight", 2026-11-22): weasel's verify running ci.yml's checks after its tests, with
    its counts summed over both runs and a file of checks set aside only for the checks the frozen tree fails too; the
    linters' safe fixes committed before a fixer's or repair's hand-back; the preflight on the batch's tip and the gate
    told `--no-checks` after it passes; a red result's failures run on `main`'s tip, what `main` fails too set aside
    from the capstone and landed over, and the report's `main red at` clause; and no gate rerun after a capstone cycle
    whose repairs committed nothing while `main` stood still.
  - a map lane's `repair` step running again once a `capstone:` line lays a failure at its area, and failed when that
    repair fails its verify, does not start, crashes, or does not apply (2026-11-23).
  - weasel's fixer verify running `check:unnameable --build` on the packages its changes are in, after the checks
    (2026-11-23).
  - local fixers (README "Local fixers", 2026-11-23): off by default, so weasel's runs are unchanged; the onto runner's
    job listing and progress now include the local runner's.
  - a capstone failure no branch reaches by path or import laid at the one branch that changed a path its failure's
    message names (README "Verify and repair", 2026-11-23).
  - conflict repair (README "batch" step, 2026-11-24): a branch that conflicts with the batch merged after a repair
    job resolves it, its outcome `merged after a conflict repair` and `conflictRepaired` on its `area.json`; left out,
    as before, only when that fails, with `; its conflict repair failed` on its why. The map takes a branch off its
    conflict when the log says a conflict repair merged it, or git says it is in `main` or its round's batch.
  - the run's heartbeat lines (`job …`), a fixer's `skulkr:` lines in its log, a relaunched job's log marker, and a
    running fix step's `checks`, `tests` and `now` on the map (README "Watching a run", 2026-11-24).
  - the fix job's `skulkr: verifying the fixer's commits` line before its verify, and, under the local runner only, an
    area giving up its place once it has reviewed and matched (README "Limits", 2026-11-24).
  - under the local runner only: `local.agents` model jobs at once across roles, and review slots defaulting to it
    (README "Local mode"); the map's running `repair` step naming its `job`, verify or repair (2026-11-24).
  - under the local runner only, each verify on the onto fleet where it can take it (README "Local mode"); and the
    fixer verify skipping weasel's checks where the fixer's own `checks:gate` passed at that commit with nothing left
    uncommitted (`progress.mjs --proof`, `$VERIFY_PROVEN`), for every runner (2026-11-24).
  - the preflight on the fleet under the local runner, as a verify (2026-11-24).
  - weasel's fixer brief running `checks:gate` through `{{onFleet}}`, the fleet under the local runner and as before
    otherwise (2026-11-24).
  - a resumed run's `resumed: <time>` line in its round's log, and the map showing a step that run redoes as running,
    with the earlier run's attempt at it and at the steps after it cleared (2026-11-24).
  - a model job the account's usage limit stopped waiting for the limit's reset and running again, whole, unless the
    run is stopped or past its deadline first (2026-11-24).
  - runner jobs' task names led by the project's name (`weasel-audit82-<area>-<step>`), the old form still read, and a
    fleet verify's task `<project>-verify-<sha>` (2026-11-24).
  - a reused job reporting the minutes it first took (`started` to `exit`), and the map keeping a step's first node and
    minutes over a resumed round's `on earlier` replay of it (2026-11-24).
  - a run waiting for a place asking the area limit again every 30 seconds, so a raised `limits.json` reaches it
    before an area finishes (2026-11-24).
  - pins (README "Pins", 2026-11-24): an area `skulkr pin` names is picked first until it settles, then unpinned by the
    next real round's plan; the plan marks it `(pinned)` and the map gives it `pinned: true`. With no pins, nothing
    changes.
  - a fixer's `skulkr: says: …` lines in its log, a fleet hand-off's `skulkr: on the fleet as <task>` line in its job's
    log, and the heartbeat's `now` cut to 100 characters (README "Watching a run", 2026-11-24).
  - a fixer's report read with a summary ahead of its first finding that names no reviewer left out, so it no longer
    counts as a finding the fixer dismissed (2026-11-24).
  - settling by the depletion fit (README "Depletion", 2026-11-25): an area settles when its 95% bound leaves under
    one defect, a next pass has under a 5% chance of finding any, and none of its lines changed since its last pass,
    in place of two passes that each found at most one; the map's area `depletion` and top-level `depletionP`.
  - a resumed round's area expected to cost only what it had not spent before the resume, and one whose every model job
    came home started past the dollar cap and `schedule.stopAt` (README "Limits"); a resume taking no pass from its own
    round's record on an earlier attempt's batch; and an early landing that does not fast-forward `main` deleting its
    batch branch, its report ending `; its branches wait for the round's batch` (2026-11-25).
  - a run started by hand having no deadline: only one started with `--scheduled`, as the service's schedule and
    continuous mode start them, stops starting areas at `schedule.stopAt` (2026-11-25).
  - a Claude reviewer's log carrying `skulkr: finding {…}` lines as it writes findings, the local runner's `now` for one
    reading `found: <claim>`, and the defects list showing an unmatched round's findings so far as `reviewing`; the map
    asks onto for progress only while a running job is on the fleet (2026-11-25).
  - the map's running steps carrying `fleet`, the fleet job a `skulkr: on the fleet as <task>` line names, and
    `skulkr map --cached-jobs` and `skulkr fetch` (2026-11-25).
  - in local mode, a fixer refused `local.fleetOnly`'s commands run bare (weasel's `npm run checks:gate`) while
    `local.fleetChecks` holds (2026-11-25).
  - weasel's record moved from `docs/audits/` to `.skulkr/` (`record.dir`, with `formerDirs: ['docs/audits']` so
    recuts and unmerged batches still find rounds recorded there), and its ledger row naming `.skulkr/round-<N>/`
    (README "Adopting it", 2026-11-25).
  - weasel's record commit and each saturation landing writing `.skulkr/defects/` (README "The defect registry",
    2026-11-25); open findings unchanged.
  - weasel's scour ledgers landing under `.skulkr/scour/` on a `<prefix>-scour` branch, those under `.skulkr/saturation/`
    still read and moved by their next landing, and `scour ls --ids` (README "Scour", 2026-11-25).
  - a verify's log line naming its tests, test files and what `--changed` took as affected, and how many tests failed
    (2026-11-27); and weasel's verify running vitest through `onto adapt vitest` where onto is on PATH, so its log
    carries `onto: progress` and `onto: tests` lines beside vitest's own output (2026-11-27).
  - a Claude reviewer's log carrying `skulkr: says:`, `reads`, `searches`, `lists` and `uses` lines as it works, so a
    preloaded reviewer shows progress before its findings (2026-11-27).
  - weasel's fixer brief running `check:size` before any test, and its verify running it first and stopping there when
    it fails, unless the fixer's `checks:gate` passed at that commit (2026-11-27).
  - a landing whose `main` moved during its gate by only `gate.untested` paths (weasel: `HANDOFF.md`, `.skulkr/`)
    merging it in without gating again, its `batch:` line saying so (2026-11-27).
  Everything else stays at parity.
- Never run a real round from here against a project without being asked: a run spends money and fast-forwards
  that project's `main`.

## Todo list

Open work lives in `docs/TODO.md`. Search it rather than reading it whole once it grows; retire an entry in the
change that finishes it.
