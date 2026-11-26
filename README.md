# skulkr

Nightly blind-pair audits of a git repository. Each night (a *run*, one numbered *round*) takes some areas of the
codebase. Two Claude reviewers read each area without seeing each other's work, a matcher pairs their findings,
Chapman's estimator says how many defects the area still holds, and a fixer fixes what they found on a branch.
The branches merge into one batch, the batch runs the project's test gate, and a green batch fast-forwards
`main`. A record of the round is committed beside the fixes. A dashboard draws the areas, the live runs, and the
rounds so far.

This README is for whoever adopts skulkr in a project or runs it.

## Trying it

You need Node 24 or later, git, and the [Claude Code](https://claude.com/claude-code) CLI, logged in: every model
call is a `claude -p` job. By default each job runs on the machine you start the round from (see "Runners").

    git clone <this repository> skulkr && (cd skulkr && npm link)   # puts `skulkr` on PATH; there is nothing to build
    cd ~/src/myproject
    skulkr init                 # writes .skulkr/config.mjs, guessed from the repository; read it and fix what it got wrong
    skulkr partition            # writes .skulkr/partition.json; check the areas look like units worth reading together
    skulkr night --dry          # the plan a run would make, and nothing else
    skulkr night --areas 1      # one real round of one area

A real round spends money and moves your local `main`. Reviewers and matchers only read, but each area's fixer
runs with permissions bypassed (in a clone of its own, never your checkout), and a batch whose test gate passes
fast-forwards local `main` and pushes it (`git: { push: false }` keeps it local). `--no-merge` leaves `main` alone, and the batch branch for you to read.
The config `init` writes caps a run at $40 list price, 4 areas a round.

## Adopting it

```js
// .skulkr/config.mjs
export default {
  name: 'myproject',                 // node tree names (myproject-skulkr-r1 …) and the default state directory

  partition: {
    roots: ['src', 'packages/*/src'], // where areas are cut from; `*` matches one path segment
    extensions: ['ts', 'tsx', 'js'],  // what counts as source
    exclude: [/\.test\./, /(^|\/)fixtures\//], // regular expressions a source path must not match
    maxFiles: 50,                     // an area holds at most this many files
    minFiles: 10,                     // a smaller subdirectory is read with its parent's own files
    areaId: (dir) => dir.replace(/\//g, '.'), // an area's id from its directory
  },

  gate: {                             // how a batch is tested before main moves
    name: 'test',
    command: ['npm', 'test'],         // `{ref}` anywhere in it is the batch branch
    cwd: 'batch',                     // 'batch' runs it in the batch's worktree; 'root' in the main checkout
    progress: { tests: '' },          // its parallel runs, by the prefix of their `onto: progress` log lines (dashboard)
    outcome: {},                      // per run, the word of its closing `<word> passed|failed` log line; else the gate's own result
    jobs: {},                         // per run, a regex on its runner jobs' task names; a run without one takes the rest
    labels: {},                       // per run, its name on the dashboard; a run without one shows its key
    blame: null,                      // or (logText, step) => paths: what a failed step's output blames; see "Verify and repair"
  },

  checks: {                           // what the default fixer brief tells the fixer to run
    test: 'npx vitest run <file>',
    typecheck: 'npm run typecheck',
    lint: 'npm run lint',
    tally: {                          // how the fixer's stream shows those checks, for its progress (regex sources)
      test: String.raw`\bnpm test --.*?\s(\S+\.test\.ts)\b`, // runs one test file (group 1)
      testPath: String.raw`\.test\.ts$`,  // a committed path that calls for its test file to be run
      lint: String.raw`\bnpm run lint\b`,  // a lint run (group 1, if any, the part it lints)
      lintOf: null,                   // a committed path that calls for a lint (group 1 its part)
      final: String.raw`\bnpm run typecheck\b`, // the last whole check, always expected
    },
    verify: {                         // what skulkr runs itself on each fix; see "Verify and repair"
      command: 'npx vitest related --run --maxWorkers=4 {files}',
      gui: null,                      // or { probe, command } for tests that need a GUI node
      timeoutMin: 20,
    },
  },
  rules: {                            // Markdown added to the default briefs
    reviewer: 'A finding about generated code under `gen/` is not a defect.',
    fixer: 'Every fix that a user could notice gets a changelog line.',
  },
  briefs: { fixer: './audit/fixer.md' }, // or replace a brief outright (paths from this file)
  review: { preload: true },          // the default: each reviewer's prompt carries its area's files

  record: {
    dir: '.skulkr',                   // round-<N>/, partition.json and landed saturation ledgers are committed here
    formerDirs: [],                   // where the record was before it moved, for readers of its git history
    ledger: null,                     // or { path, section, row({ round, date, areas }) }: a table row per round
    trailer: '',                      // lines ending the record commit's message
  },
  naming: { prefix: 'audit', batchPrefix: 'batch' }, // audit<N>-<area>, batch/<date>-audit<N>
  // naming.batch: 'rounds/r{round}-{date}' names batch branches whole instead; it must hold {round}
  git: { main: 'main', remote: 'origin', push: true }, // push: main goes to remote once a green round lands

  setup: {                            // readying a node tree for a fixer
    prelude: '',                      // a shell line before every job (weasel's selects its Node with nvm)
    install: { lockfile: 'package-lock.json', command: 'npm ci --no-audit --no-fund' }, // or null
  },

  runner: 'local',                    // or 'onto', a module path exporting createRunner(cfg), or a runner object
  localFix: { enabled: false, slots: 2 }, // fixers and repairs on this machine, as the starting account ("Local fixers")
  local: { enabled: false, agents: 6, override: {} }, // every job on this machine, nothing pushed ("Local mode")
  nodes: {
    list: [],                         // nodes jobs are offered to; the local runner's is ['local']; unused under onto
    local: null,                      // or { name, from: '00:00', until: '09:00', fixers: false }: a node usable only in a window
    reviewSlots: 6, fixSlots: 2,      // jobs at once per node; 6 each for a fleet runner; local reviews default to local.agents
  },
  concurrency: { review: 18, fix: 18 }, // jobs at once across the fleet, under a runner that places them (onto)
  claude: {
    configDir: undefined,             // CLAUDE_CONFIG_DIR for every job; unset, the CLI's default account
    denied: [],                       // tools refused to every job; local mode adds WebFetch and WebSearch
    models: { match: 'haiku', ledgerMatch: 'opus' }, // per role (review, match, fix); unset takes what the job's settings give; ledgerMatch: see "Scour"
    effort: {},                       // per role, `--effort`; unset likewise
    settingSources: 'project,local',  // `--setting-sources`: the node account's own settings stay out; null omits it
    cacheTtl: { review: '5m', match: '5m', fix: '5m' }, // per role, the prompt cache's lifetime; unset takes Claude Code's default
    timeoutMin: 45,
  },

  areasPerRound: 16,
  maxUnmergedRounds: 0,               // stranded rounds allowed before a new one waits (see "Stranded rounds")
  budget: { review: 8, match: 1, ledgerMatch: 3, fix: 15, capUsd: 160, areaCapUsd: undefined, areaGuessUsd: 10, nightUsd: undefined }, // list-price dollars; areaCapUsd, when set, caps a run at that much per area in place of capUsd
  schedule: { startAt: '23:00', stopAt: '07:00', continuous: false }, // the service's start; when a scheduled or continuous run stops dispatching
  state: undefined,                   // default ~/.local/state/skulkr/<name>
  sweep: null,                        // an extra check beside the reviews; see "A sweep"
  saturate: { max: 40, sources: ['claude'], stopNextNew: 0.15 }, // `skulkr scour`; see "Scour"
  icons: null,                        // the map's area icons; see "Area icons"
};
```

Every command finds the config through `--config <file>`, else `SKULKR_CONFIG`, else `.skulkr/config.mjs`, then
`skulkr.config.mjs`, in `--root`, `SKULKR_ROOT`, or the working directory. A config in `.skulkr/` resolves its relative
paths from the project's root. `.skulkr/` is the project's own skulkr state, committed; its `.gitignore`, which `init`
writes, keeps out `cache/` and never a job's `in/` or `out/`, since onto syncs a job's tree by `git ls-files`. The project root is the main worktree of the repository holding
the config, unless the config's `root` or `--root` says otherwise. `skulkr config` prints the resolved config.

**Briefs.** The shipped briefs in `briefs/` are generic and fill `{{project}}`, `{{rules}}`, `{{test}}`,
`{{typecheck}}`, and `{{lint}}` from the config, beside their own variables (`{{round}}`, `{{area}}`,
`{{commit}}`, `{{files}}` (each with its line count, marked `changed this week` where a commit of the last seven days changed it), `{{out}}` for a reviewer; `{{source}}` for a fixer; `{{attempt}}`, `{{command}}`,
`{{failures}}`, and `{{log}}` for a repair). A project's own brief may use the
same ones. The reviewer brief's closing `<!-- done: … -->` line, its `## Files read` section, and the fixer
brief's `tally:` line are read back by the pipeline, so a replacement must keep them.

## A run

`skulkr night` runs one round. Several may run at once, each with its own flags; a run's id is its round number.
Each step prints one line as it completes (`review 3/16 …`).

| Step | What happens |
|---|---|
| plan | Areas come from the partition, less every area a live run holds. The round number is one past the highest used by a `<record.dir>/round-<N>/` directory, the ledger's text, a branch named `audit<N>-…`, or a run's claim. The run claims it by creating `runs/<N>/`; if another run got there first it takes the next. Planning holds `plan.lock`, so two runs starting at once never pick the same area. |
| freeze | A detached worktree at `main`'s tip, `.worktrees/audit<N>-frozen-night`. That sha is the round's commit. |
| sweep | Only with `--sweep` and a configured sweep: one job at the frozen commit beside the reviews; its findings go to one fixer. |
| review | Per area, two reviewer jobs from the frozen tree with the reviewer brief and the area's file list, and with `review.preload` (the default, adopted 2026-11-22 after round 72's trial: 6.5% cheaper, a third of the turns, overlap not up) every listed file's contents, so a reviewer need not open them; B then starts 30 seconds after A, to read A's cached prompt. Preloading needs a review agent that takes its prompt on stdin (Claude's does; Codex's reviewers read the files themselves). Reviewers may read, search, and run `git log/show/diff/blame`, and write only `.skulkr/out/`; their shell stays in the tree's root (`CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR`), since that write rule is relative to the working directory. Each lists the files it read; its stream goes through `src/progress.mjs`, so the runner shows how many of the area's files it has opened. |
| match | One job per area pairs the two lists (the matcher brief); the pipeline keeps only one-to-one pairs and computes the estimate. |
| fix | Per area with findings, one fixer job, permissions bypassed, in the node's synced tree. It first commits the synced tree and checks it hashes to the frozen commit's tree, installs if the lockfile changed (an install that fails stops the job before the model runs, leaving `install.log`), then hands back its commits as an mbox. |
| verify | Per fixer with commits, the config's `checks.verify` over the files they changed, run by skulkr, never read from the fixer's report; see "Verify and repair". |
| repair | Per area whose verify fails, up to two repair jobs on its commits, each verified again; an area still failing is left out of the batch. |
| patch | Each mbox is applied with `git am` onto `audit<N>-<area>` at the frozen commit. One that does not apply is reported and left out. |
| batch | Every branch merges into `batch/<date>-audit<N>` (a worktree), then every branch an earlier round left out. A merge that meets another git's lock (`index.lock': File exists`) is retried after 0.5, 1 and 2 seconds. A branch that conflicts gets a conflict repair (`conflicts: { repair: true }`, the default; it needs `checks.verify`): its merge is redone in a worktree beside the batch's (`batch-<date>-audit<N>-conflict`) with git's markers left in and committed as one commit, and a repair job (`briefs/conflict.md`, or the config's `briefs.conflict`) is given that commit on the batch's tip, with what each side changed in the conflicting files, told to resolve the markers keeping both sides' intent. Its commits are verified as a repair's are, over every file the merge changes, the batch's tip standing in for the frozen tree; passing, the branch is merged with that resolution, its outcome reading `merged after a conflict repair` and its `area.json` holding `conflictRepaired: true`, and a batch rebuilt later in the round reuses the resolution while it still applies. It starts only under the dollar cap (see "Limits"), and an early landing tries none. A branch whose conflict repair fails or does not start is left out as before, its why ending `; its conflict repair failed` or `not started`. One that still fails is left out, its outcome reading `left out: merge conflict in <paths>` or `left out: merge failed: <git's message>`, and recorded in the state directory's `left-out.json` until `main` holds it or the branch is deleted; the map gives each run `leftOut`, an `{ area, round, why }` per branch its log says was left out, and fails that area's patch step with the why; a `batch: <branch> merged after a conflict repair` line later in the log takes it back off, as does the branch being merged into `main` or its round's batch branch outside skulkr (by hand, after a red round), which the map reads from git: the lane's patch step is then done with `resolved` saying how, and the branch is gone from the run's and the map's `leftOut`. The round's record is committed there. Then the run waits for `merge.lock`, held by one run at a time from its gate through `main`'s fast-forward; holding it, it runs the preflight where one is configured (see "Preflight"), merges `main` in if another run has landed meanwhile, waits its turn in the fleet queue (step `fleet-wait`; see "Continuous rounds"), and runs the gate on the tip. |
| merge | Green: local `main` fast-forwards to the batch and, with `git.push` (the default), is pushed to `git.remote`; a push that fails is reported and leaves `main` where it is. The branches are deleted. If `main` moved during the gate, it is merged in and the gate runs again, up to twice. A red gate whose log names no failure (its `gate.failPrefix` lines) crashed or was killed rather than failed, and runs once more first. Red: one capstone repair cycle (see "Verify and repair"), and the gate once more; still red, the batch worktree and its branches stay, and the report names them and what was tried. |

The record, in `<record.dir>/round-<N>/`: per area `files.txt`, `A.md`, `B.md`, `match.json`, `fix.md` and
`area.json` (counts, estimate, the previous pass's estimate this one tests, findings in files changed since, fix
commits, tokens and cost); `usage.jsonl`, one record per job; and `README.md`, the round's table, with each area's cost per file and the round's per area and per file. The partition
file is regenerated from the batch's tree, so it holds what landed on `main` while the round ran, and the ledger, when
the config names one, gets a row.

| Flag | Default | Does |
|---|---|---|
| `--areas K` | `areasPerRound` | areas this run |
| `--only a,b` | | these areas, ignoring the pick order; refused if a live run holds one |
| `--nodes a,b` | | only these nodes |
| `--dry` | | print the plan and stop |
| `--no-merge` | | leave `main` alone even when the batch is green |
| `--trial preload` | | beside each area's pair, run a second pair of the other kind (reading its files itself where the area's pair preloads them, and the reverse), recorded only at `<night>/trial/<area>.json` for `skulkr trial` to compare: cost per review and overlap. The area's own pair alone feeds the fix and the record |
| `--anyway` | | start even though stranded rounds hold new ones back (see "Stranded rounds") |
| `--sweep` | | run the configured sweep too |
| `--scheduled` | | stop starting areas at the first `schedule.stopAt`; the service passes it to the runs its schedule and continuous mode start, and a run started without it has no deadline (2026-11-25) |
| `--fix-only [a,b]` | | a fix-only round for these areas, or every area with open findings; see "Carried findings" |
| `--local` | `local.enabled` | local mode: nothing leaves this machine but its model calls; see "Local mode". Any command takes it, so `skulkr config --local` prints the config as local mode runs it |
| `--local-fix` | `localFix.enabled` | run fixers and repairs on this machine, as the account that started the run; see "Local fixers" |
| `--resume N` | | pick round N back up, reusing every job whose result came home; with `--scheduled`, it stops starting areas at the first `schedule.stopAt` after the resume. Under the plan lock, it leaves out the areas a live run holds. A round lands once: when its status or `summary.json` names a `landed` tip (set once `main` fast-forwards, with the areas it carried) that `main` still holds, it resumes nothing and says the round already landed. The record an earlier attempt committed on the round's batch is no earlier pass of its areas |
| `--cap-usd N` | `budget.areaCapUsd` × `--areas`, else `budget.capUsd` | list-price dollars the run may spend |
| `--budget-review`, `--budget-match`, `--budget-fix` | `budget.*` | each job's `--max-budget-usd` |

**Which areas.** Never-audited areas go first, in partition order. Then the due ones, by the defects their last
pass left, corrected (see "Calibration"), in whole defects; an area whose files changed since counts at least 1, so
code changed under a zero estimate still competes. Ties go to the most lines changed since the last pass, then to the
longest since that pass (`rankOf` and `pickAreas` in `src/rounds.mjs`). An area is *settled*, and skipped, when its depletion
fit (see "Depletion") says that, at the 95% bound, it holds under one defect a pass could find and a next pass has
under a 5% chance of finding any, and no lines of its files changed since its last pass, that pass's fixes aside
(2026-11-25; it was two passes that each found at most one). What is due comes only from the `area.json` files of earlier rounds and
git: on disk, and on batches `main` has not merged, less those of a round abandoned for good (its latest night holds an
`abandoned` file); the rounds chart marks a round read from a batch `pending: 'unmerged'`. An area a live run holds, or an unmerged `audit<N>-<area>` branch, is skipped, and the map's queue numbers skip it
too.

**Pins.** `skulkr pin <area>` forces an area into every round until it settles, and `skulkr unpin <area>` stops that
(2026-11-24). Pinned areas are picked first, ahead of never-audited ones and within `--areas`, in the order above among
themselves; one a live run or an unmerged branch holds waits as any other does. The pins are a list of area ids in
`<state>/pins.json`, beside `limits.json`, so pinning commits nothing. A real round's plan unpins each pinned area that
has settled and says so (`unpinned <id>: settled`); a dry plan only marks the pinned picks `(pinned)`. The map gives a
pinned area `pinned: true`, and the dashboard draws a pin in its cell's bottom-right corner, at the queue number's size and left of it, and a toggle in its area panel.

**History follows files.** A pass belongs to the files it read (its `files.txt`, also `files` in its `area.json`),
not to its area's name, so a recut partition keeps what was learned. An area inherits every pass that read any of
its files now, with a *share*: the part of that pass's files the area holds. The pass's Chapman estimate and its
"left" are scaled by that share, so a pass split across two areas is counted once between them, and a renamed area,
holding all of its pass's files, keeps its whole history. An area counts as audited only once passes have read at
least half its files now (`COVERED` in `src/rounds.mjs`); below that it queues as never audited, its inherited
passes still shown. An area's passes of one round count as one pass, its left the sum of theirs by share and its fixes
all of theirs; and only a round whose passes read at least half the area's files (a *covering* round) stands for it:
its last covering round is its "last pass" for the queue, staleness and settling, so a later pass that held one
boundary file of it neither replaces its estimate nor tests it. The map gives each area that pass as `last`, drawn as
one pass and corrected, and the dashboard's "left after round N", shading, heat scale and totals read it.
It also gives `lastByRound`: what `last` was after each round that changed it, `{ round, left, leftCorrected }`
(`pass` naming the round the figure comes from where that is an earlier one, `leftCorrected` left out where it equals
`left`), none before passes had read half the area's files. Every entry is corrected by today's calibration, not the
one that held then. The dashboard's round picker shows the map from it.

A recut area takes its files' history with it, so it starts with an estimate and never shows as unaudited. The map's
`recuts` lists, for each recorded round whose `partition.json` added an area to the round before's, the areas it added
and those it took their files from (every part, where a directory was cut into one more), named as the partition now
holds their files. The dashboard flashes them as the round picker reaches that round.

**Stale estimates.** An area whose files changed since its last pass carries `staleLines` in the map: lines added
plus deleted in those files (`git log --numstat`, merges left out) by every commit since the pass's commit but that
pass's own fixes. The plan prints it, the queue weighs it, and the dashboard fades the area and says how much of
"≈ left" sits in such areas. Each commit's counts are cached in `~/.cache/skulkr/<name>/churn.json`, so a map
rebuild asks git only about commits it has not seen.

**Calibration.** Chapman's estimate assumes the two reviewers find defects independently; two runs of one model
are positively correlated, so "left" runs low. `src/calibration.mjs` checks it against what happened: for each pair
of consecutive covering rounds on one area (provisional ones skipped; see "History follows files"), what pass k left against the distinct defects pass
k+1 found, scaled by pass k+1's share as "left" is by pass k's. The pooled factor, found over predicted, is taken
overall and by pass k's shared count (0, 1–2, 3 or more); a pass's corrected left is its left times its bucket's
factor, or the overall one while the bucket has fewer than 5 pairs, never under 1. What pass k+1 found is a lower
bound on what pass k left, since pass k's fixes came in between, and it counts defects added since; each pair's
`lines` (lines of the area's files changed between the two passes, pass k's fixes aside) says how much changed.
Neither is corrected for. Every figure is recomputed from the records on each map build: the map carries
`leftCorrected` on each pass and a top-level `calibration` with the pairs, the factors, and a per-round series of
predicted, found, and the running factor.

**Depletion.** Each pass finds some fraction of what an area holds and its fixer removes what it fixed, so an area's
passes find fewer as it empties (a removal, or depletion, model; `src/depletion.mjs`). An area's *run* is its latest
covering rounds with its file list as it is now and no lines of its files changed between one and the next but their
own fixes; each round counts the defects its fixer fixed, listed or extra (else its distinct findings), by its share.
The rate `p` a pass finds defects at is fitted once over every area's run of two or more rounds, and each area's run is
then fitted at that rate by maximum likelihood: `n0`, what the area held before its run, `left`, what it holds now,
`leftUpper`, the 95% profile-likelihood bound on that, and `next`, the chance a further pass finds at least one at the
bound. Its assumptions run its numbers low: two runs of one model miss the same defects, so `p` is an average over
easy and hard ones, and a fix can add a defect the model does not count. The map gives each area with a run
`depletion` (`{ rounds, n0, p, left, leftUpper, next }`, or `unbounded` where its finds do not fall) and a top-level
`depletionP`; the dashboard's area panel shows it (2026-11-25).

**Reuse and holds.** A reviewer whose area, file list, and commit match a finished review of an earlier run (a
stopped round, say) is not run again: that review is copied in, and the log says so. While any gate holds the fleet
queue, no run starts a new review, since a gate is a suite-sized fleet run and the runner's queue has no priorities;
reviews already running, fixers, and verify steps go on.

**Limits.** Each job's model is stopped at `claude.timeoutMin` and the runner stops the job ten minutes later, so
what it wrote still comes home. A run started with `--scheduled` starts no new area after `schedule.stopAt`; none starts one when what it has spent, plus
what each running area has left of its expected cost, plus one more area would pass the dollar cap, an area being
expected to cost the mean of this run's finished areas (`budget.areaGuessUsd` before any has), nor once a stop is requested. A resumed round's area is expected to cost only what it had not spent before the resume, and one whose every model job came home, to be reused, costs nothing and starts past the cap and `schedule.stopAt` (2026-11-25); a fix-only round's fixers start under the same checks. While the sweep's fixer runs, what it may still spend (`budget.fix` less its spend so far) counts as spent. A capstone repair starts only while no stop is requested and what the run has spent, plus `budget.fix` for it and for each repair started before it, stays within the cap; a branch whose repair does not start is left out, as one whose repair failed is. An area whose reviewers ran always gets its matcher and fixer. Where skulkr picks
nodes (a pinned run, or a runner that does not place jobs), a node the runner reports unavailable is skipped, and a
dispatch a node refuses moves to another node and keeps that one out for `nodes.refusedCooldownMin`. Under a placing runner a refused job is launched again each minute, up to 120 times; a run with pinned nodes retries as each node's cooldown ends, for the same two hours. Then the job is given up, and a refusal after a stop request is not retried.
A model job the account's usage limit stopped partway is run again, whole, once the limit resets (the time its
refusal names, else 15 minutes on), unless the run is stopped or past its `schedule.stopAt` first (2026-11-24).
A job that failed before its model started is launched up to three times; one whose model started (it writes
`started` first) and left no `exit` was cut off mid-run and is never launched again, since it was paid for.
`<state>/limits.json` (`{ "review": n, "fix": n }`) changes the slots per node, or under a placing runner the jobs at
once, and with them how many areas a run keeps going at once, for runs already going. An area keeps its place until
it finishes, except under the local runner, where it gives its place up once its pair has reviewed and matched, so the
next areas review while this one's fixer and verify run, and the fix slots alone bound the fixers (2026-11-24). The local
runner's 6 review slots keep three areas reviewing at once, since a reviewer waits on the model rather than the machine;
its 2 fix slots stay low because a fixer's verify runs the project's tests (2026-11-24).

## Verify and repair

A fixer runs checks of its own, but chooses which, and reads their verdict itself. skulkr does not take its word:
with `checks.verify` set, it runs the project's verify step itself on what each fixer committed.

| Part | What happens |
|---|---|
| `command` | Runs at the end of the fixer's own job, after the model exits, on the committed tree (uncommitted edits are dropped first). `{files}` is the files the fixer's commits changed; `{related}` is the same as one `--related=<file>` each. Bounded by `timeoutMin` (default 20). |
| `gui` | `{ probe, command }` for tests that need a node's GUI session. `probe` runs beside `command` and prints the test files the GUI part would run, one a line; when it lists one, or fails, `command` runs in an `onto do --gui` job of its own on the area's commits. With no `probe`, the GUI part runs for any change. |
| verdict | The command's exit status and vitest's `Test Files` counts: it passes only on exit 0 with no file failed, so a file whose setup or teardown throws fails even when every test in it passes. The counts are summed over every vitest run the command makes. A failing file that fails on the frozen commit too, with every test failing in it there as well, is set aside as `baseline`; a file of checks (weasel's `ci-checks.gate.ts`) is so set aside only for the checks the frozen commit fails. The verdict passes only when such files are all that failed and they account for the whole failure, so an unhandled error or a non-zero exit beyond the counted files still fails. |
| `fixup` | `{ command, message }` (`checks.fixup`): runs over the files a fixer's or repair's commits changed (`{files}`) before they are handed back, and what it changes is committed as one commit with `message`, so a finding a linter can fix is fixed rather than failed. |
| repair | A failing verdict goes, verbatim, to a repair job (`briefs/repair.md`, or the config's `briefs.repair`) on the area's commits, told to make it pass without weakening a test. Its commits are verified the same way. After two repairs that still fail, the area is left out of the batch, as a conflicting branch is. A run that timed out is not repaired: the area lands, and the capstone checks it. |
| capstone | A red gate's `fleet-fail:` files are laid at the area branches whose commits changed each file, else changed a file it reaches by relative imports, else changed a workspace package it imports, else, where exactly one branch changed a repository path its failure's message names (its `onto: fail` message and vitest `FAIL` block, as a test that scans the whole repository lists what it flags), at that branch; a file none of these reaches is unattributed. Each such branch gets one repair job given the gate's lines about its files, under the dollar cap (see "Limits"), which its verify step checks beside its own changes. A failed step (a check, not a test file) goes to the branches that changed a path the config's `gate.blame(logText, step)` reads from its output (weasel's reads the packages `check:unnameable` names, and for a failed `npm run lint -w <package>` the files biome
marks as errors, or the package where biome's diagnostic limit hides them); without one it is unattributed. Where the
failed step is a file of tests that run steps (weasel's `ci-checks.gate.ts`), `gate.blame` also gets each failing
test's name, which names the step. Repaired branches are patched again, the rest are left out, the batch is rebuilt, and the gate runs once more; not when every repair passed without a commit, none was left out, and `main` has not moved since the gate, as that would test the same tree again. A branch whose repair still failed is deleted once `main` fast-forwards, as an area its verify step left out has no branch, so a later round can pick its area again. A branch an earlier round left out that this batch retried gets no repair, its commits being that round's: it is left out again, as not repairable this round, and deleted once `main` fast-forwards, so no later batch retries it. Such a branch, and one whose repair the dollar cap or a stop request kept from starting, is deleted when a failure laid at it went away without it; only when every failure laid at it is one `main` already has, so the blame is unproven, is it kept in `left-out.json` for a later batch to retry. One cycle per round, and another after it only while its gate names fewer failures than the gate before the last cycle did; a later cycle's repair jobs are `repair-capstone-<N>`, and the report says how many cycles ran. |
| old failures | With a preflight, a red result's failures are first run on `main`'s tip (see "Preflight"), and the ones `main` fails too are no branch's to repair. Without one, a gate still red after the capstone lands anyway when every failure left is a test file that fails on the frozen commit too, checked as the verify step's baseline is, and a failed step is never discounted. Either way `main` has those failures already, so landing leaves it no worse, and the report says it landed over them. |

The night log prints a `verify` line per area and a `repair` line per repair; each area's `area.json` and the run's
`summary.json` keep `verify` (`ok`, `why`, `repairs`, `testFiles`, `failedFiles`), and the closing `night:` line counts
the areas that passed, passed after a repair, timed out, or were left out. The dashboard draws the repair as a lane
step after the fix.

weasel's config runs `npx vitest related --run` from the tree root over every project but `gate` and the browser
ones, with four workers, then ci.yml's checks (the `gate` project's `scripts/ci-checks.gate.ts`, whose tests are the
steps), and the browser projects with two workers on a GUI node. Its fixup runs biome from `packages/labkit` on
labkit's files, the one package biome lints, and `eslint --fix` on the other source files.

## Preflight

With `checks.preflight` set, the fleet gate runs only tests (2026-11-22): the checks run before it, and a red result
is checked on `main` before any branch is blamed for it. Every gate failure on 2026-11-22 was one `main` already had or
a check no earlier step ran, and the capstone had blamed audit branches for each.

| Part | What happens |
|---|---|
| preflight | Before each gate joins the fleet queue, `command` runs on the batch's tip in a job of the round's `gate` lane, its `{tests}` the test files the last red result failed (none on the first pass); with `gui` (`{ command, project }`), the ones whose failure line's project `project` matches run instead in a GUI job beside it, at once. Its output marks failures with `gate.failPrefix` lines, so a red preflight reads as a red gate: its failures go to the capstone and the gate does not run. Passed, the gate gets `gateArgs` after its command (weasel's `--no-checks`, which skips the checks it would otherwise run). A preflight that gives no verdict (it never ran, timed out, or failed naming no failure) leaves the checks to the gate. |
| `main` | A red preflight or gate runs the preflight again on `main`'s tip, over the failing test files, its GUI part beside it. A failure line `main` prints too is `main`'s: the capstone gets the log without it, and a red result with nothing else left lands over it (a preflight with nothing else left goes on to the gate). The round's report and night log say `main red at <sha>: N failures it has too`, naming each with the commit that last touched it (for a step, the paths `gate.blame` reads). A check on `main` that gives no verdict sets nothing aside. |

weasel's preflight is `npx vitest run` over every project but the browser ones, on `scripts/ci-checks.gate.ts` and
`{tests}`, with its `scripts/vitest-fleet-fail.mjs` reporter, and its GUI part the browser projects over the browser tests. A failed postbuild step is still found only by the gate.

## Early landings

A round's fixers finish over most of an hour, and its batch waits for the last of them, so a test failure in the
first area to finish surfaces only after the last. An early landing lands the ready part sooner: once per round,
while areas are still running, it patches the areas whose fixes came home and passed verify, batches them on `main`
as `batch/<date>-audit<N>-early`, runs the gate (its logs tagged `.early`) with a capstone cycle when red, and
fast-forwards `main` when green. The round goes on meanwhile; the run's status shows the landing's own step as `early`.

It starts when all of these hold, checked each minute (`src/early.mjs`, the config's `early`):

| Condition | Default |
|---|---|
| ready areas, of those the round picked | at least `share`, half |
| areas not yet finished | at least `left`, a quarter, so it never runs just before the round's own batch |
| the runner's free cores (`spare()`, onto's `onto top`) | at least `coresFree`, half |
| the fleet queue and this tenant's merge lock | nobody holds or waits for either |

What it differs in from the round's batch:

| | Early landing | The round's batch |
|---|---|---|
| record | none; the round's batch commits the whole round's, early areas' outcomes reading `landed early at <sha>` | committed on the batch |
| branches left out of earlier rounds | not retried | retried |
| a branch that will not merge | waits for the round's batch | left out, in `left-out.json` |
| still red after its capstone | its branches wait for the round's batch, and its batch branch goes | the batch and branches are kept |
| green, but `main` would not fast-forward | its branches wait for the round's batch, and its batch branch goes | the batch and branches are kept |

The round's batch merges the landed `main` in, as it does after any landing. `status.landed` carries `early: true`
until the round's batch lands, so `--resume` runs the round on rather than calling it landed, and skips the areas
already on `main`; their record then lacks `fixCommits`, which the early landing's status does not keep. `early:
null`, `--no-merge`, and a runner without `spare()` (the local one) turn it off.

## Carried findings

A fix job that never really ran (no node had room, a usage limit) leaves its area's findings unfixed, and the next
round's reviewers need not report them again. skulkr derives which findings are still open from the records, and
keeps no list of its own (`src/defectGraph.mjs` over `src/carry.mjs`'s reading of each record, read by
`src/carryRecords.mjs` from disk and unlanded batches).

| Term | Means |
|---|---|
| open | a round reported it, and no fixer of that area acted on it in that round or after |
| acted on | the fixer's report gives it a verdict line (fixed, not a defect, a question, …), matched by its words, or by its id when that fixer was handed it; a report with as many verdicts as findings handed over answers them all; or a fix commit's subject matches it |
| did no work | the fix job left no report holding a verdict or a `tally:` line, and no commits: every finding it was handed stays open |
| one defect | two rounds' findings of one area (counting those handed to it) citing a common file (or none) whose claims share enough words (`SAME_LIKENESS`); it keeps its first round's id, `r<round>-<n>` |
| its area | the area of the partition now holding most of the paths its `where` cites, so a recut hands it on with its code; one citing no path any area holds stays under the id of the area that found it. Handed to another area, its id is qualified by the area that found it, `<area>/r<round>-<n>`, since each area's ids restart at 1. Which area held it in an earlier round, for that round's dedupe and closes, comes from that round's file lists (the partition now only for a record without one) |

When a round's fixer is dispatched, its area's open findings that this round's reviewers did not report again are
carried in: `carried.md` beside the reports, each under its id and round, and the brief's source says so. The
fixer checks each still applies and leads its verdict with the id. The record keeps them as `carried.json`.

`--fix-only` (the service's `start` with `fixOnly: true` or a list of areas) runs a round of fixers alone, for
areas with open findings and not held by a live run or an unlanded branch, then verify, repair, batch, and capstone
as any round. It takes a round number and a record of its own; its `area.json` says `fixOnly`, and gives no pass to
an area's history. The map gives each area `openFindings`, a count, and `open`, the list, which the area panel
shows with each one's round.

## The defect registry

Every defect the project's rounds and landed saturation ledgers found, one JSON line each, in
`<record.dir>/defects/<area>.jsonl` under the area now holding its cited files. It is written from the record by the
rule above, never by hand: a round's record commit and each `saturate land` write it again, and `skulkr registry`
writes it in the checkout, uncommitted. A line:

| Field | Holds |
|---|---|
| `id` | `d-` and 10 hex of a hash of its first sighting, so it never changes and parallel branches never collide |
| `area`, `claim`, `where`, `files`, `severity` | as its first sighting gave them; `files` the paths `where` cites |
| `status` | `open`, or what the fixer who last acted on it said: `fixed`, `dismissed` (not a defect), `duplicate`, `question`, `declined` (not fixed), or `closed` when no verdict line matches |
| `resolved` | `{ round, area, verdict, sha }`: that fixer's round and area, and the commit its verdict names |
| `first` | `{ round, commit, date }`, or `{ ledger, commit }` for one only a ledger found |
| `sightings` | each round that reported it (the first with its area and reviewer), and each ledger defect that is it: `{ ledger: '<area>@<commit>', defect, occasions, sources }` |

A ledger is read ahead of the first round reviewed at or after its commit. A round finding like one of its defects,
in the same area, takes that defect over, and a later fixer's words close one; a defect only a ledger found is never
handed to a fixer, so open findings and carried findings are the same with or without ledgers (2026-11-25).

## The index

`<record.dir>/cache/skulkr.db`, a SQLite database (`node:sqlite`) built from the committed record and ignored by git
(`.skulkr/.gitignore`). It is built again whenever the record's tree at `HEAD`, or any change to it not yet committed,
differs from what it was built from, so it is never edited and never out of date. `skulkr q <sql> [--json]` queries
it; `saturate ls` reads each landed ledger's defects' registry lines from it. `map` reads the record itself.

| Table | A row per |
|---|---|
| `areas`, `files` | area of the partition, and each of its files |
| `defects`, `defect_files` | registry line (`status`, `verdict`, `resolved_round`, `resolved_sha`, `first_round`, `first_ledger`, …), and each path it cites |
| `sightings` | report of a defect: a round's (`round`, `area`, `reviewer`) or a ledger's (`ledger`, `ledger_defect`, `occasions`, `sources`) |
| `passes` | round's area record: its counts, Chapman's estimate, `cost_usd`, `commit`, `date` |
| `jobs` | job in a round's `usage.jsonl` |
| `ledgers`, `occasions` | landed saturation ledger, and each of its occasions |

    skulkr q "select area, count(*) open from defects where status = 'open' group by area order by open desc"

## A sweep

A config's `sweep` is an extra check run once per round beside the reviews, whose findings go to one fixer. It is
an object:

| Field | Is |
|---|---|
| `id`, `title` | its name in branches, the record, and the log |
| `run(ctx, dir)` | runs the check and answers `{ ran: true, exit, summary, dead }` or `{ ran: false, why }`; `ctx.runFree(job, logPath)` runs a runner job from the frozen tree; `dir` is its directory under the night's |
| `findings(dead)` | the found items as a reviewer-format findings file |
| `source(commit, reportPath)` | what the fixer is told its findings are |
| `section(result, outcome)`, `line(result)` | the round README's section and the log's line |
| `recordFiles` | `[from, to]` pairs copied from its directory into the record, beside `findings.md` and `fix.md` |

weasel's control sweep, `examples/weasel/sweep.mjs`, is the example.

## Runners

A runner launches jobs on nodes. A config's `runner` picks one:

| `runner` | Jobs run |
|---|---|
| `'local'` (default) | On this machine, as node `local`. Each job gets a clone of the project from a pool in `<state>/trees/`, sharing the project's objects (`git clone --shared`), reset to the job's commit and cleaned before it runs, so one job never sees another's leftovers; `node_modules` is kept, so a fixer installs only when the lockfile changed. The pool holds one clone per job running at once, at most `reviewSlots + fixSlots` across a run. A job past its timeout is sent SIGTERM with its children, and SIGKILL 30 seconds later if any are left. A run that exits or is sent SIGTERM, SIGINT or SIGHUP takes its running jobs with it; a job outliving its run (one killed with SIGKILL) keeps its clone leased until it ends. |
| `'onto'` | On an onto fleet, one `onto do` per job with no node named: each waits in onto's queue and starts on whichever node has room first, so a busy or missing machine never holds a job. skulkr bounds only how many run at once (`concurrency`); what each node takes is its own onto policy (`onto set <node> --refuse kind:fix`, `--quiet`, `--weight`). `--nodes` still pins a run's jobs. Every node that takes reviews or fixes runs `claude -p` itself, so it needs the CLI logged in (and `claude.configDir`, if set, present there); a node that isn't should refuse those kinds. |
| a module path | Whatever its `createRunner(cfg)` answers. |
| an object | That object. |

The interface, documented in `src/runner/onto.mjs`: `run(job, { cwd, log })` answering `{ status, busy, refused,
noRoom }`, `unavailableNodes()`, `jobs(sinceIso)` (what the dashboard's lanes are drawn from), and optionally
`progress()`, each running job's own count by task (a running step's fill). `src/runner/local.mjs` is the smallest
complete one.

### Watching a run

While jobs run, the run prints a heartbeat line for each, every 2 minutes when it has moved and every 10 when it has not
(`src/heartbeat.mjs`). The run's log and `night.log` get the same lines, which nothing parses:

```
job forge.vite.part1-fix on local · 21 min · commits 10/10 · checks 6/7, 2 failing · tests 84, 3 failing · now: running: npx vitest run packages/…
```

The counts come from the job's progress filter (`src/progress.mjs`). A fixer's filter also writes `skulkr:` lines to
its log, which onto ignores: each command it starts, each commit with its subject, and each check with the tests it
failed. The local runner keeps each counter apart (commits, checks, tests) and takes the latest `skulkr:` line as the job's
`now`, so the dashboard's fix column counts only commits, its checks column counts checks, and both tooltips show `now`.
The onto runner reports only its first counter, so its lines carry commits alone. A job that a resume starts over
gets `skulkr: relaunched at <time>` in its log, below the earlier run's lines. A fixer's log also carries what it says
between tool calls (`skulkr: says: …`), and a job that hands a verify to the fleet writes `skulkr: on the fleet as
<task>` once onto has it. A Claude reviewer's log gets `skulkr: finding {"claim","where"}` for each finding as its
findings file gains it, on either runner, since the fleet streams a job's output back as it runs (2026-11-25).

Resting the pointer on a running round's lane opens the end of that area's newest job log beside it, read from the
round's `jobs/<area>/` every 3 seconds while it shows, and where that log hands its job to the fleet, the fleet task's
own last lines from `onto logs --tail`.

### Local fixers

With `--local-fix` (or `localFix.enabled` in the config), fixers and repairs run on this machine and every other job
stays with the runner. Their `claude -p` runs as the account that started the run: its `CLAUDE_CONFIG_DIR`, else
`claude.configDir`, else the CLI's default account. They keep `claude.settingSources`, so the account changes and
the rules a fixer reads do not.

| | Under `--local-fix` |
|---|---|
| Where | The local runner's clones in `<state>/trees/`, as node `local` |
| How many at once | `localFix.slots` (2), apart from the fleet's fix slots; `<state>/limits.json`'s `localFix` changes it for runs already going |
| A fixer's verify | Not in its job: skulkr runs it on the runner in a verify job of its own, as it does a GUI verify |
| On the dashboard | The onto runner lists the local runner's jobs and progress beside its own, so a local fixer's lane fills like any other |

A fixer runs its brief's own checks where it runs, so each local fixer runs tests and lints on this machine. Each clone
also keeps its own `node_modules`. The flag needs the onto or the local runner; under the local runner, where every
job is local already, it changes only the account. A resumed round takes the flag again from its own command line.

### Local mode

With `--local` (or `local.enabled`), the run's only traffic off this machine is its model calls, made by Claude Code as
the account that started the run. Every job (reviews, matches, fixes, repairs) and every check runs here.

| | Under `--local` |
|---|---|
| Runner | `local`, whatever the config names; its nodes and concurrency go back to the local runner's defaults |
| Agent | `claude` for every role; a config naming another agent is refused before anything runs |
| Account | the `CLAUDE_CONFIG_DIR` the run was started under, else `claude.configDir`, else the CLI's default account |
| `main` | fast-forwarded locally, never pushed (`git.push` is off) |
| Model jobs | refused `WebFetch` and `WebSearch`, beside each role's own refusals |
| Agents | under the local runner, at most `local.agents` model jobs (default 6) at once, whatever their role, each also holding its role's slot; `"agents"` in `limits.json` changes it for runs already going. A verify job runs no model and holds none (2026-11-24) |
| Verify | under the local runner, each verify (a fixer's hand-back, a verify or GUI verify job, a baseline) and the preflight runs on the onto fleet with `onto do --kind test`, under the project's `origin` URL, added to the job's tree as its `fleet` remote, so unpushed commits reach the node. It runs here where `onto` is missing, `origin` is no URL, or onto fails before the job starts; `local.fleetChecks: false` keeps every verify here. A fixer gets the same path as `{{onFleet}}` in its brief, put before a whole-repo check (weasel's `checks:gate`): `.skulkr/in/on-fleet <kind> <minutes> <name> -- <command>` (2026-11-24). Each command in `local.fleetOnly` is refused to a fixer run bare, so it takes that path (2026-11-25) |
| The run's environment | `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` (no telemetry, error reports, or updates) and `npm_config_offline=true` (`npm ci` and `npx` use only npm's cache, and fail rather than download), inherited by every job and command the run starts |

skulkr cannot see what a project's own commands do. A gate or preflight that sends work to a fleet still does, so
`local.override` names the settings local mode replaces: each top-level key it holds replaces the config's whole,
`gate` included, so no fleet-only field is left behind. weasel's example sets none: its gate stays on the fleet,
since only model calls need to stay local.

The dry plan and the night log open with a `local:` line naming the account. Like `--local-fix`, a resumed round takes
the flag again from its own command line.

## Agents

An agent runs a model job. A config's `agent` names one for every role, or one per role as `{ review, match, fix }`
(a repair runs as `fix`); each agent's settings are the config block named for it. A name no agent answers to, or a
role an agent cannot run, fails the run's plan before anything is spent. The interface every agent answers is
documented in `src/agent/index.mjs`.

| `agent` | Runs |
|---|---|
| `'claude'` (default) | `claude -p` with the `claude` block's models, effort, tools and cache lifetime, each job stopped at its role's `budget` in dollars; reply and usage come from the job's `claude.json`. |
| `'codex'` | Reviewers only, so far: `codex exec --json` in the `workspace-write` sandbox (a job's tree is thrown away, and only `.skulkr/out` comes home), without the node's `config.toml` unless `codex.ignoreUserConfig` is false, on `codex.models.review`. Codex reports tokens but no cost and takes no budget, so a job is priced from `codex.prices[model]` (`{ input, cachedInput, output }`, dollars per million tokens, which the config must give) and bounded only by `codex.timeoutMin`. Its reviewers get `briefs/codex/reviewer.md`, which reads files with shell commands and takes `AGENTS.md` as already loaded, unless `codex.briefs.reviewer` names another. Every node it runs on needs the Codex CLI logged in. |

Running one reviewer of each pair on each agent, `agent: { review: … }` aside, is not built yet.

## Scour

Splitting this into stages (pick, delve, fold, judge, land, triage, fix) is designed, mostly unbuilt, in
`docs/scour.md`.

A round's two reviews estimate what an area holds from one overlap. `skulkr scour` (aliases `saturate`, `sat`) asks the
question harder for one area: blind reviews of it, again and again, at one frozen commit with no fixes between them,
until capture–recapture says further reviews would find little new. Nothing it records feeds a round: not history,
calibration, the queue, or the map.

    skulkr scour [delve] <area> [--sources claude,codex] [--max 40] [--at <sha>] [--fresh] [--fleet]
    skulkr scour fold <area>
    skulkr scour ingest <area> <report.md> --source <name> [--at <sha>]
    skulkr scour import <area> <dir> --at <sha> [--fresh]
    skulkr scour land <area>… | --all
    skulkr scour ls [--json] | ls --ids [--source <name>]
    skulkr scour report <area>
    skulkr scour rm <area>

Each **occasion** is one report. `skulkr scour delve <area>` (or `skulkr scour <area>`) freezes a detached worktree of the ledger's commit
(`.worktrees/audit-saturate-<area>`, removed when it ends) and runs one review per source in `--sources` at once,
each exactly the job a round's reviewer runs on that agent (`claude` or `codex`, see "Agents"): the same brief, its
files preloaded where `review.preload` and the agent allow. Its jobs run on this machine under the local runner,
so they spend the account that started them; `--fleet` sends them through the configured runner instead, where each
spends the account signed in on the node that takes it (2026-11-25). Each finished report is kept beside the ledger
as `reviews/unfolded-<NN>-<source>.md` and listed in the ledger's `unfolded`; **fold** then takes them in the order
they finished, each through the **ledger matcher**, which says which of its findings are defects the ledger already holds and which are new.
After each occasion skulkr prints a line, rewrites the report, and checks the stop rule:

    7/40 claude: 3 findings, 1 new; distinct 19; unseen ≈ 6.1; next-new 18%; $0.62; $1.84/defect

It stops once the combined estimate puts fewer than one defect unseen, the chance that the next occasion's finding
is new falls under `saturate.stopNextNew` (15%), or `--max` occasions (`saturate.max`, 40) are in the ledger.

Every line a delve, fold or ingest prints also goes to the ledger's `scour.log`, each led by its time, started over by
the next process to take the ledger. `ls --json` gives each ledger a live process holds `running`: its pid, when it
took the ledger, what it does, the delve's `--max`, each job it has out (the occasion, the step, the newest log line and
onto's progress counter), and the end of `scour.log`; null otherwise. The dashboard's Scour page shows these above the
ledgers (2026-11-25).

**Which commit.** A new ledger freezes at `--at <sha>`, else at `main`'s tip. Give `--at` when reports already made
elsewhere were made at a fixed commit: every occasion must review the same code for the cross-source estimates to
mean anything. Run it again to go on from where it stopped: it resumes the ledger at its own commit, however far
`main` has moved since, and refuses an `--at` naming another one. `--fresh` moves the ledger aside to
`<state>/scour/<area>.<commit>` and starts a new one; `skulkr scour rm <area>.<commit>` deletes an old one.
A review that never finishes is kept beside the ledger as `unfinished-…` and not counted.

`ingest` folds in a report written elsewhere, in any Markdown shape, as one occasion (Codex's
`skills/skulkr-review-saturation`, linked into `~/.codex/skills/`, ends each area this way): the matcher reads it whole and
lists its findings itself. A multi-pass audit whose passes shared context counts as one occasion, not one per pass,
since its passes were not independent. `ls` lists every ledger with its estimates, cost and defects (`--json` for the
dashboard's saturation page); `ls --ids` prints only the names of areas with a ledger, in the state directory or landed,
holding an occasion from `--source` (any, without it), so a reviewer that must stay blind to the ledgers can skip areas already done; `report` rewrites the report file from the ledger; `rm` deletes the ledger.

`import` builds a new ledger, at `--at`, from a saturation experiment run by hand, every occasion a Claude review.
Its directory holds:

| File | Holds |
|---|---|
| `reviews/NN.md` | occasion NN's raw report, copied into the ledger's `reviews/` |
| `occasions.json` | `{ "1": [findings, costUsd, minutes], … }`, occasions numbered 1 up with no gap |
| `sightings.json` | `{ "1": ["V1", "V2"], … }`, the defects each occasion reported |
| `defects.json` | `[{ "id": "V1", "claim", "where", "severity", "source"? }, …]` |

The defects become `D1`, `D2`, … in the order of their ids' numbers (`V2` before `V10`), each keeping its old id as
`imported`. A defect no occasion sighted, found only by another source, is kept with no sightings and that `source`;
it counts in no estimate, and the defect table marks it `found only by <source>`. `import` refuses over an existing
ledger unless `--fresh`.

**Triage fields.** A scour's reviewers are asked, by `briefs/scourTriage.md` after the reviewer brief (the config's
`briefs.scourTriage` replaces it), to give each finding `fix:`, `size:`, `cause:` and `confidence:` lines beside its
`scenario:` and `severity:`; the matcher takes the same from an ingested report where it states them. A ledger defect
keeps them from its first report, and each later sighting merges in: the highest severity, the union of `fix` files,
the largest size, the strongest confidence, and the first scenario and cause given. The registry carries them as a
defect's `triage` (2026-11-25). Round reviewers are not asked for them.

**The ledger matcher** is a Claude job on `claude.models.ledgerMatch` (Opus by default), stopped at `budget.ledgerMatch` dollars (3), with
its own brief, `briefs/ledgerMatch.md` (the config's `briefs.ledgerMatch` replaces it). Its rule: the same defect is
the same wrong behavior at the same code, however worded; a finding that covers two ledger defects sights both; a
different trigger needing a different fix is a new defect. A reply that does not account for every finding exactly
once, or names a defect the ledger lacks, is asked for once more; a second bad reply stops the run loudly, the report
left unfolded and nothing recorded from it. `skulkr scour fold <area>` folds what is left unfolded, and every delve
and ingest folds it first (2026-11-25). A landing leaves unfolded reports out. The first review of an empty
ledger needs no matcher: all its findings are new.

**The ledger** lives in `<state>/scour/<area>/` (`saturation/` before 2026-11-25, moved there by the first `skulkr scour` command run after): `ledger.json` (the commit, the area's files, each occasion's
source, kind, findings, cost and minutes, and each distinct defect with the occasions and sources that saw it) and
`reviews/<NN>-<source>.md`, each raw report as it came. Every figure is recomputed from these, never stored.

**Landing a ledger.** The ledger lives in the state directory, on one machine. `skulkr scour land <area>` (or a
set-aside `<area>.<commit>`) commits it to the project's `main` as `<record.dir>/scour/<area>/<commit>/`, holding
`ledger.json`, `report.md`, and the raw reports its occasions name under `reviews/`, on a branch
`<prefix>-scour-<area>` from `main` that `main` fast-forwards to under the merge lock, then pushed as `git.push`
says. Several areas, or `--all` for every ledger with occasions, land in one commit on `<prefix>-scour`
(2026-11-25). A ledger landed under `<record.dir>/saturation/`, as every one was before 2026-11-25, is still read there, and moves to
`scour/` in the commit that next lands it. Landing the same ledger again replaces that directory, so it can land part way and land again when it
stops; a ledger already landed unchanged commits nothing. When `main` cannot fast-forward (the main checkout off
`main`, or with uncommitted changes), the branch is kept and named. Nothing reads a landed ledger yet: rounds, the map
and fix-only rounds see none of it (2026-11-25); its defects are to be fixed eventually, by a mechanism not yet chosen.

**The report**, `report.md` in the ledger's directory, holds the yield by occasion
(findings, new, distinct, the running estimate, and the cost so far per distinct defect, `$/defect`), the estimates, and the merged defect table. Its three estimates
answer different questions:

| Estimate | What it is | When to trust it |
|---|---|---|
| Chao2 per source | Chao2 over one source's occasions alone: from how many defects it found once (Q1) and twice (Q2) | A floor for what that reviewer can find, never the area's total: reviews by one model resemble each other, so they miss the same defects every time and the estimate runs low |
| Chao2 combined | The same over every occasion; drives the stop rule | Better than either source's alone, still low while one source dominates the occasions |
| Chapman across sources | Each source's union of defects as one list, and their overlap; every pair with more than two sources | Better while the sources find different kinds of defect, since they then err independently; meaningless while one source has only an occasion or two |

## The service

`skulkr service` runs nights as a long-running service, for the project its config names or, with none named, for
every registered tenant (see "Tenants"). For each project it starts a run by itself at
`schedule.startAt` unless one is live or one has started since then that day (one started by hand after midnight
does not count as that evening's), or keeps rounds coming in continuous mode (see "Continuous rounds"), and answers
requests, one JSON object a line on stdin, each echoing its `id`:

| Request | Reply |
|---|---|
| `{"ping":true}` | `pong`, skulkr's commit (`build`), and the tenants hosted; with `tenant`, that project checkout's commit |
| `{"status":true}` | `runs`: every live run's round, step, areas, flags, dollars used against its cap and per area and per file (`usdPerArea`, `usdPerFile`), and `behind`, what a waiting one waits for; `last`: the summary of the run that ended last; `continuous`: the mode, what the next round waits on (`next`), and `nightUsd`, `spentUsd`, `leftUsd`, `estimateUsd`, and `estimateUsdPerArea`; `queues`: the round in its model steps (`model`) and the fleet queue's holder and waiters (`fleet`) |
| `{"plan":true}` | what a run started now would pick |
| `{"start":true}` | starts a run now, beside any already running; takes `areas`, `only`, `nodes`, `capUsd`, `budget` (`{review, match, fix}`), `merge: false`, `sweep: true`, `fixOnly` (`true` or a list of areas), and `resume` (a round number); answers `started: false` and `error` when its run could not be spawned |
| `{"start":true,"continuous":true}` | turns continuous mode on until the night's `stopAt`, and starts its first round if the queues and budget allow; takes no other field. `"continuous":false` turns it off |
| `{"stop":true}` | with `round`, that run; without, every live run and continuous mode until the night's `stopAt`: no new jobs start, running ones finish, then each run patches, batches, and records what completed |

Every request but a bare `ping` may carry `tenant`, the project it is about, and every reply to one names its
`tenant`. Without one it means the only tenant, and is refused when there are several.

Starting or restarting the service never starts a run, nor stops one: each run is a process group of its own and
keeps going when the service that started it exits, and a restarted service finds it on disk and reads its latest line
from its night log. Its first tick only arms each schedule; continuous mode, if on, starts its next round from the
tick after. Anything that keeps a process alive and owns its stdin can host it (launchd, systemd, tmux); under
onto, as the service `skulkr` hosting every registered tenant, on the machine holding their checkouts:

    onto sync --in skulkr orochi                     # from ~/src/skulkr
    onto service up skulkr --in skulkr --here --prefer orochi --env SKULKR_BIN=$HOME/src/skulkr/bin/skulkr.mjs \
      --about "Runs the nightly blind-pair audits of the registered tenants." -- bash -lc 'exec node bin/skulkr.mjs service'
    onto call skulkr '{"id":1,"status":true,"tenant":"myproject"}'

`--env SKULKR_CONFIG=<a config>` makes it host that project alone instead.

`SKULKR_BIN` makes each run start from the skulkr checkout rather than the service's synced copy, so a change to
the pipeline reaches the next run without a sync.

## Stranded rounds

A round is stranded when its batch branch is unmerged into `main`, no live run owns it, and it was not abandoned: a red
gate kept it, or `--no-merge` did. A round started past one plans from a `main` without its fixes, so its estimates
are out of date, its reviewers can re-find what the stranded fixes closed, and its batch drifts further from the
stranded one, so each merges worse. While more rounds are stranded than `maxUnmergedRounds` (default 0) allows,
`skulkr night` refuses to start one and names them (`--anyway` starts it regardless; `--dry` and `--resume` are not
held), and continuous mode waits, its `next` saying why. Land, delete, or abandon the batch to let rounds start again.

An area an earlier round's unmerged `audit<N>-<area>` branch holds stays out of the queue until that branch lands or is
deleted. The map gives it `locked`, that round, unless a live run holds it, and the dashboard draws a padlock in its
cell's bottom-right corner, at the queue number's size, left of any pin.

## Continuous rounds

A round's model work (reviews, matches, fixes) is cheap on fleet CPU and bound by spend; its gate is one suite-sized
fleet run. Continuous mode overlaps the two, keeping a tenant's rounds coming through two queues:

| Queue | Holds | A round waiting on it |
|---|---|---|
| model | at most one round per tenant in its model steps (`freeze`, `review`, and a capstone `repair`) | the next continuous round starts once the last reaches `patch`, and not while a round's capstone repair runs |
| fleet | at most one gate across every tenant and every run, however started | sits at step `fleet-wait`, its status `behind` naming the holder |

The fleet queue is on disk, in `~/.local/state/skulkr/fleet/` (`SKULKR_FLEET` names another): `gate.lease` is the
holder, a lease like the slots', and `waiting/` holds a ticket per waiting run, taken oldest first. A run whose
process has died loses its lease and its ticket, and so does one written before the machine last booted, whose pid
another process may hold now.

Continuous mode is on between `startAt` and `stopAt` when the config sets `schedule.continuous: true`, or from a
`{"start":true,"continuous":true}` request until the night's `stopAt` or a bare `{"stop":true}`, which also turns
off the config's mode for the rest of that night. A request's mode is kept in `<state>/continuous.json`, so it
survives the service restarting. It needs `budget.nightUsd`: with none, there is no continuous mode, and a config
asking for it keeps the plain scheduled start.

Each tick (every 30 seconds) the service starts a tenant's next round when all of these hold:

- the mode is on, and the tenant is not read-only;
- no round of the tenant is in its model steps, or started and not yet claimed, and no other tenant's is;
- the night's spend plus the next round's estimate stays within `budget.nightUsd`;
- no more rounds are stranded than `maxUnmergedRounds` allows (see "Stranded rounds").

The night, for the budget, runs from one `stopAt` to the next, so a round started in the afternoon counts against
the coming night. Its spend is every round started in it, from `status.json` while live and `summary.json` after, or
the last `status.json` of one that died without a summary (run directories from the last day are never pruned). The estimate is `areasPerRound` times the mean cost per
finished area of the last five rounds, or `areasPerRound × budget.areaGuessUsd` before any. Each continuous round
runs with `--cap-usd` set to the night's budget left or its own cap (`budget.areaCapUsd` × `areasPerRound`, else `budget.capUsd`), whichever is less. A continuous round that
claims nothing, fails, or cannot start ends the chain for the night, noted in `<state>/continuous-idle.json` so a
restart does not resume it; a request turning continuous mode on clears it. `stopAt` still stops every continuous round dispatching.

## Tenants

One skulkr host can serve several projects, its *tenants*. Each keeps its own config and state; the registry,
`~/.config/skulkr/tenants.json` (`SKULKR_TENANTS` names another), lists them as `[{ "name", "config" }]`, the config an
absolute path.

    skulkr tenants ls [--json]                          # the registered tenants
    skulkr tenants add <config> [--name n] [--read-only] # name: the config's own `name` unless given
    skulkr tenants rm <name>

Every command takes `--tenant <name>` beside `--config` to name a tenant's config (`skulkr map --tenant weasel`).

`skulkr service` with no config named hosts every tenant in the registry, reread every 30 seconds and before each
request, so one added while it runs is picked up without a restart, and a tenant's config edited while it runs is
reloaded, keeping the runs it started (a module the config imports keeps its first version until a restart). Each tenant keeps its own `schedule.startAt`.
Rounds of different tenants never do their model work at once, since they share the fleet's slots: a tenant due, or
asked to start, while another's round is in its model steps waits until that round reaches its patch step (or ends
its capstone repair), and its
`status` reply lists that under `waiting` (`behind` names the tenant it waits on), beside `nextStart`, its next
scheduled start. A scheduled start still waiting at its own `stopAt` is skipped until the next `startAt`. Their gates take turns in the fleet queue. A tenant's own rounds may still run beside each other
when started by hand. A tenant added `--read-only` is shown and its live rounds hold the fleet like any other's, but
the service never starts or stops one: its rounds run under another service.

On the machine this was extracted on, weasel is registered from `examples/weasel.config.mjs` (root `~/src/weasel`,
state `~/.local/state/weasel-skulkr`), not read-only: the `skulkr` service there runs weasel's rounds, and weasel's
own `skulk` service is down (2026-11-21). What is left of the cutover is in "Moving weasel over".

## The dashboard

`dashboard/` is a standalone Vite app that draws the treemap of areas, the live runs' lanes, the rounds and calibration charts, the
jobs feed, the queue, and an area's defects. Its dev server lists the tenants at `api/tenants` (`skulkr tenants ls`,
or with none registered the one project `SKULKR_CONFIG` or the working directory names), and serves each tenant's
map at `api/t/<name>/map` and an area's defects at `api/t/<name>/area?id=<area>`, by running `skulkr map` and
`skulkr defects` with `--tenant` (which refuses an id not in the partition). An area's defects list a round its reviewers
have not been matched in yet by each reviewer's findings so far, `reviewing`: a finished reviewer's findings file, else
its log's finding lines. `api/t/<name>/events` pushes the map to the page after each build that changes it, built with `skulkr map --cached-jobs`
(the fleet listings as `skulkr fetch`, run by the server while a page watches, last kept them), and the ids
of areas whose files a running round wrote, so an open defects list asks again (2026-11-25). A POST to `api/t/<name>/pin?id=<area>&on=1`
(or `on=0`) runs `skulkr pin` (or `unpin`) and answers once the map is built again (see "Pins"). The page's title is a menu of the tenants; the one shown is in the URL hash
(`#weasel`), and each viewer's last choice is remembered. A slider above the treemap shows the areas as they stood after
an earlier round, from each area's `lastByRound` (see "History follows files"), the round after an `@` in the hash
(`#weasel@41`). `dashboard/README.md` says how to start it.

A frozen copy of it, over weasel's audits, is at [michaelbaker.tech/skulkr](https://michaelbaker.tech/skulkr/).
`skulkr map [--out <file>]` writes the same JSON for anything else that draws it.

### Area icons

The config's `icons` puts an icon in the middle of each area's tile, at one size on every tile and left out of a
tile too small for it. It is an object, or a function of `{ root }` (the project root) answering one:

```js
icons: {
  areas: { ui: 'ui', 'ui.menu': 'menu', 'apps.lab': null }, // an area id or a group's id prefix → an icon name
  packageOf: (file) => /^packages\/([^/]+)\//.exec(file)?.[1] ?? null, // the package a file lies in
  packages: { ui: 'ui', geom: 'geom' },  // a package's icon, or a function of its name
  glyph: (name) => bodies[name],          // an icon's SVG body on a 20×20 viewBox, stroked in currentColor
},
```

The `areas` key that is the area's id, else its longest dotted prefix, names its icon; `null` there means none.
With no key matching, an area whose files all lie in one package by `packageOf` takes that package's icon, and an
area spanning two takes none. The map carries each named icon's glyph once, in `icons`, and each area's icon name.
weasel's (`examples/weasel/icons.mjs`) reads `PACKAGE_ICONS` from `apps/site/releaseIcons.ts` and the glyphs from
the `icons.table.json` files its icon generator writes, as text, so nothing of weasel is imported or built.

## The menu bar item

An optional macOS menu bar item shows the rounds running across every tenant: a badge counting them, a line each with
its step and spend against its cap, its latest log line under it, each tenant's last finished round with its report,
and a link to the dashboard. It needs [perch](https://github.com/orochi235/perch) (`brew install orochi235/tap/perch`).

```sh
npm run menubar:install      # links `skulkr` into ~/.local/bin, then perch builds the item and hands it to launchd
npm run menubar:uninstall
```

Its wording comes from `skulkr menu` (`src/menu.mjs`), which asks the service for each registered tenant's status
the way `onto call` does, so it reads like the dashboard; `menubar/menubar.yaml` only lays the lines out. The service
it asks is `SKULKR_SERVICE`, else `skulkr` (as "The service" brings it up), and the dashboard it links is
`SKULKR_DASHBOARD_URL`, else `http://localhost:5214/`. perch writes only the `PATH` you install from into the item's
LaunchAgent, so install from a shell where `node` and `onto` resolve, and set either variable in `menubar.yaml`'s
`run` (`[env, SKULKR_SERVICE=skulkr-myproject, skulkr, menu]`).

## Where things go

| What | Where | Bound |
|---|---|---|
| A run's log, job outputs, and runner logs | `<state>/nights/<start>-round<N>/` | the newest `keepNights`, and any a run's status or summary still names; older ones are deleted when a run starts |
| A run's claim, status, stop request, and summary | `<state>/runs/<N>/`: the directory is the claim; `status.json` (with its pid) while it runs, `stop` when asked, `summary.json` when it ends | the newest `keepNights`, never a live one nor one started in the last day; pruned when a run starts |
| Each commit's lines changed, for `staleLines` and calibration's `lines` | `~/.cache/skulkr/<name>/churn.json` | only the commits after the oldest pass asked about: any area's last pass, or the first of a pair of passes; rewritten without the rest on each build that adds one, and dropped when the partition's `roots`, `extensions` or `exclude` change |
| A scour ledger | `<state>/scour/<area>/`: `ledger.json`, `reviews/`, and `jobs/` while an occasion runs | `saturate.max` occasions; each occasion's job outputs deleted once it is recorded; `skulkr scour rm <area>` deletes the lot. `--fresh` moves an old ledger aside to `<area>.<commit>`, kept until `rm <area>.<commit>` |
| A landed scour ledger | `<record.dir>/scour/<area>/<commit>/` in the project, committed to `main` | one directory per area and frozen commit, replaced by each landing of it; at most `saturate.max` reviews |
| The defect registry | `<record.dir>/defects/<area>.jsonl` in the project, committed | one line per defect, rewritten whole at each record commit and landing |
| The index | `<record.dir>/cache/skulkr.db` in the checkout, ignored by git | one file, replaced whenever the record changes |
| Node tree leases | `<state>/slots/<node>/<tree>` | deleted as each job ends; one whose pid is dead is taken back |
| The local runner's clones | `<state>/trees/t<k>` and a lease beside each | one per job running at once; reused, never more than the most jobs ever run at once (local fixers' included) |
| The local runner's job records, for the dashboard | `<state>/local-jobs/`, a file per job | deleted after 7 days, as each job starts and as `jobs()` reads them |
| Locks | `<state>/plan.lock`, `<state>/merge.lock` | one file each, deleted on release |
| The fleet queue | `~/.local/state/skulkr/fleet/`: `gate.lease` and a ticket per waiting run in `waiting/` | the lease deleted on release, a ticket when its run takes the gate; a dead pid's of either is cleared |
| Continuous mode asked for | `<state>/continuous.json` | one file, rewritten by each request |
| Continuous chain ended for the night | `<state>/continuous-idle.json` | one file, rewritten when a continuous round claims nothing, fails or cannot start, removed when a request turns the mode on |
| Worktrees | `.worktrees/audit<N>-frozen-night`, `audit<N>-am-<area>`, `batch-<date>-audit<N>`, and `batch-<date>-audit<N>-conflict` while a conflict repair runs, in the project checkout | removed when the run ends, except a red batch's, which the report names |
| Node trees | `<name>-skulkr-r<k>`, `<name>-skulkr-f<k>` on each node | a fixed set; each job clears its own output |

`<state>` is the config's `state`, by default `~/.local/state/skulkr/<name>`.

## Moving weasel over

weasel still runs its own copy (`scripts/skulk/`, and the audits page in WeaselDraw). `examples/weasel.config.mjs`
reproduces it: on weasel's tree at round 49 the partition, the dry-run plan, and the map JSON come out identical
to the originals' (`project` aside, a field the map gained). Cutting over, with no run live
(`onto call skulk '{"id":1,"status":true}'`, weasel's own service, shows none):

| Step | Detail |
|---|---|
| Add the config | `examples/weasel.config.mjs` → weasel's `.skulkr/config.mjs`; `examples/weasel/briefs/` and `examples/weasel/sweep.mjs` → weasel's `scripts/audit/`, and the config's `./weasel/` paths → `./scripts/audit/`. `examples/weasel/sweep.test.ts` goes with them (its imports then point at the skulkr checkout) or stays here. |
| Delete from weasel | `scripts/skulk/` (code, tests, briefs, README); `apps/draw/src/dev/audits/`; `apps/draw/vite-plugin-skulk-map.ts` and its plugin in `apps/draw/vite.config.ts`; the `#/dev/audits` route in `apps/draw/src/main.tsx` and `apps/draw/src/dev/devRoutes.ts`, and its row in `RegistryInspector.test.tsx`; the `vite-plugin-skulk-map.ts` mention in `scripts/lib/fleet-triggers.mjs`. |
| Repoint docs | `docs/fleet.md` cites `scripts/skulk/README.md` for the control sweep; the config's round README intro and ledger row say "run by `scripts/skulk`" and cite `scripts/skulk/usage.mjs` — change the text to skulkr if wanted. Rows already in `docs/hardening.md` stay as written. |
| State | weasel's state is in `~/.local/state/weasel-skulk`; the config's `state` is `~/.local/state/weasel-skulkr`, so move the directory across. `runs/`, `nights/`, `limits.json`, and the locks keep their format; `slots/` names the old trees, and with no run live it can be emptied. Node trees are renamed (`weasel-skulkr-r<k>`, `weasel-skulkr-f<k>`), so each node syncs fresh ones and the old `weasel-skulk-r<k>`, `weasel-skulk-f<k>` can go. |
| The onto service | It changes from weasel's tree and `WEASEL_ROOT` to skulkr's tree and `SKULKR_CONFIG`: `onto sync --in skulkr orochi` from `~/src/skulkr`, then `onto service up skulkr --in skulkr --here --prefer orochi --env SKULKR_CONFIG=$HOME/src/weasel/skulkr.config.mjs --env SKULKR_BIN=$HOME/src/skulkr/bin/skulkr.mjs --about "Runs the nightly blind-pair audit of weasel." -- bash -lc 'exec node bin/skulkr.mjs service'`, which writes `~/.config/onto/services/skulkr/`; then take down weasel's own `skulk` service, and its `weasel-skulk` service tree can go. Requests are unchanged; each reply also names its `tenant`. To host every tenant instead, leave out `SKULKR_CONFIG`: the service then reads the registry. |
| The dashboard | Already reads weasel as a tenant; re-register it from its new config: `skulkr tenants rm weasel`, then `skulkr tenants add ~/src/weasel/.skulkr/config.mjs` (no `--read-only`, now that this host runs its rounds). The config's `root: '~/src/weasel'` line goes: unset is the repository holding the config. |
| Log wording | The gate's log line reads `gate: test:batch passed` where weasel's read `fleet: test:batch passed`, and its log is `<batch>.test-batch.log` as before. Nothing parses it. |

## Developing

    npm install
    npx vitest run --maxWorkers=1 src/<file>.test.ts   # one file
    npm run typecheck

The tests are in `src/`, `test/`, and `examples/`.
