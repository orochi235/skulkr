# x-skulk

Nightly blind-pair audits of a git repository. Each night (a *run*, one numbered *round*) takes some areas of the
codebase. Two Claude reviewers read each area without seeing each other's work, a matcher pairs their findings,
Chapman's estimator says how many defects the area still holds, and a fixer fixes what they found on a branch.
The branches merge into one batch, the batch runs the project's test gate, and a green batch fast-forwards
`main`. A record of the round is committed beside the fixes. A dashboard draws the areas, the live runs, and the
rounds so far.

`x-skulk` is a code name. This README is for whoever adopts it in a project or runs it.

Everything is plain Node (24 or later). The model calls are `claude -p` jobs run on fleet nodes through a *runner*:
onto (`~/src/onto`) by default, swappable (see "Runners").

## Adopting it

A project adopts skulk by committing one file, `skulk.config.mjs`, at its root. It is an ES module whose default
export is a plain object (or a function answering one). Everything left out takes the default below.
`examples/weasel.config.mjs` is a full one.

```js
// skulk.config.mjs
export default {
  name: 'myproject',                 // node tree names (myproject-skulk-r1 …) and the default state directory

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
  },

  checks: {                           // what the default fixer brief tells the fixer to run
    test: 'npx vitest run <file>',
    typecheck: 'npm run typecheck',
    lint: 'npm run lint',
  },
  rules: {                            // Markdown added to the default briefs
    reviewer: 'A finding about generated code under `gen/` is not a defect.',
    fixer: 'Every fix that a user could notice gets a changelog line.',
  },
  briefs: { fixer: './audit/fixer.md' }, // or replace a brief outright (paths from this file)

  record: {
    dir: 'docs/audits',               // round-<N>/ and partition.json are committed here
    ledger: null,                     // or { path, section, row({ round, date, areas }) }: a table row per round
    trailer: '',                      // lines ending the record commit's message
  },
  naming: { prefix: 'audit', batchPrefix: 'batch' }, // audit<N>-<area>, batch/<date>-audit<N>
  git: { main: 'main', remote: 'origin' },

  setup: {                            // readying a node tree for a fixer
    prelude: '',                      // a shell line before every job (weasel's selects its Node with nvm)
    install: { lockfile: 'package-lock.json', command: 'npm ci --no-audit --no-fund' }, // or null
  },

  runner: 'onto',                     // or a module path exporting createRunner(cfg), or a runner object
  nodes: {
    list: ['studio', 'teitou'],       // nodes jobs are offered to
    local: { name: 'orochi', from: '00:00', until: '09:00', fixers: false }, // a node usable only in a window
    reviewSlots: 6, fixSlots: 6,      // jobs at once per node, each in a tree of its own
  },
  claude: { configDir: '~/.claude-msb', models: { match: 'haiku' }, timeoutMin: 45 },

  areasPerRound: 16,
  budget: { review: 8, match: 1, fix: 15, capUsd: 160, areaGuessUsd: 10 }, // list-price dollars
  schedule: { startAt: '23:00', stopAt: '07:00' },  // the service's start; when a run stops dispatching
  state: undefined,                   // default ~/.local/state/skulk/<name>
  sweep: null,                        // an extra check beside the reviews; see "A sweep"
};
```

Then, from the project's checkout:

    node ~/src/x-skulk/bin/skulk.mjs partition       # writes docs/audits/partition.json; check the areas look right
    node ~/src/x-skulk/bin/skulk.mjs night --dry     # the plan a run would make
    node ~/src/x-skulk/bin/skulk.mjs night           # one run

Every command finds the config through `--config <file>`, else `SKULK_CONFIG`, else `skulk.config.mjs` in
`--root`, `SKULK_ROOT`, or the working directory. The project root is the main worktree of the repository holding
the config, unless the config's `root` or `--root` says otherwise. `skulk config` prints the resolved config.

**Briefs.** The shipped briefs in `briefs/` are generic and fill `{{project}}`, `{{rules}}`, `{{test}}`,
`{{typecheck}}`, and `{{lint}}` from the config, beside their own variables (`{{round}}`, `{{area}}`,
`{{commit}}`, `{{files}}`, `{{out}}` for a reviewer; `{{source}}` for a fixer). A project's own brief may use the
same ones. The reviewer brief's closing `<!-- done: … -->` line, its `## Files read` section, and the fixer
brief's `tally:` line are read back by the pipeline, so a replacement must keep them.

## A run

`skulk night` runs one round. Several may run at once, each with its own flags; a run's id is its round number.
Each step prints one line as it completes (`review 3/16 …`).

| Step | What happens |
|---|---|
| plan | Areas come from the partition, less every area a live run holds. The round number is one past the highest used by a `<record.dir>/round-<N>/` directory, the ledger's text, a branch named `audit<N>-…`, or a run's claim. The run claims it by creating `runs/<N>/`; if another run got there first it takes the next. Planning holds `plan.lock`, so two runs starting at once never pick the same area. |
| freeze | A detached worktree at `main`'s tip, `.worktrees/audit<N>-frozen-night`. That sha is the round's commit. |
| sweep | Only with `--sweep` and a configured sweep: one job at the frozen commit beside the reviews; its findings go to one fixer. |
| review | Per area, two reviewer jobs from the frozen tree with the reviewer brief and the area's file list. Reviewers may read, search, and run `git log/show/diff/blame`, and write only `.skulk/out/`. Each lists the files it read; its stream goes through `src/progress.mjs`, so the runner shows how many of the area's files it has opened. |
| match | One job per area pairs the two lists (the matcher brief); the pipeline keeps only one-to-one pairs and computes the estimate. |
| fix | Per area with findings, one fixer job, permissions bypassed, in the node's synced tree. It first commits the synced tree and checks it hashes to the frozen commit's tree, installs if the lockfile changed, then hands back its commits as an mbox. |
| patch | Each mbox is applied with `git am` onto `audit<N>-<area>` at the frozen commit. One that does not apply is reported and left out. |
| batch | Every branch merges into `batch/<date>-audit<N>` (a worktree); a conflicting one is left out and reported. The round's record is committed there. Then the run waits for `merge.lock`, held by one run at a time from its gate through `main`'s fast-forward; holding it, it merges `main` in if another run has landed meanwhile, and runs the gate on the tip. |
| merge | Green: local `main` fast-forwards to the batch (never pushed), and the branches are deleted. If `main` moved during the gate, it is merged in and the gate runs again, up to twice. Red: the batch worktree and its branches stay, and the report names them. |

The record, in `<record.dir>/round-<N>/`: per area `files.txt`, `A.md`, `B.md`, `match.json`, `fix.md` and
`area.json` (counts, estimate, the previous pass's estimate this one tests, findings in files changed since, fix
commits, tokens and cost); `usage.jsonl`, one record per job; and `README.md`, the round's table. The partition
file is regenerated, and the ledger, when the config names one, gets a row.

| Flag | Default | Does |
|---|---|---|
| `--areas K` | `areasPerRound` | areas this run |
| `--only a,b` | | these areas, ignoring the pick order; refused if a live run holds one |
| `--nodes a,b` | | only these nodes |
| `--dry` | | print the plan and stop |
| `--no-merge` | | leave `main` alone even when the batch is green |
| `--sweep` | | run the configured sweep too |
| `--resume N` | | pick round N back up, reusing every job whose result came home |
| `--cap-usd N` | `budget.capUsd` | list-price dollars the run may spend |
| `--budget-review`, `--budget-match`, `--budget-fix` | `budget.*` | each job's `--max-budget-usd` |

**Which areas.** Never-audited areas go first, in partition order, then the longest since their last pass. An
area is *settled*, and skipped, after two consecutive passes that each found at most one distinct defect, on the
same file list, with nothing but those passes' own fixes changing its files since. What is due comes only from
the `area.json` files of earlier rounds.

**Limits.** Each job's model is stopped at `claude.timeoutMin` and the runner stops the job ten minutes later, so
what it wrote still comes home. A run starts no new area after `schedule.stopAt`, nor when the areas running plus
one more, each expected to cost the mean of this run's finished areas (`budget.areaGuessUsd` before any has),
would pass the dollar cap. An area whose reviewers ran always gets its matcher and fixer. A node the runner
reports unavailable is skipped; a dispatch a node refuses moves to another node and keeps that one out for
`nodes.refusedCooldownMin`. `<state>/limits.json` (`{ "review": n, "fix": n }`) changes the slots per node for
runs already going.

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

A runner launches jobs on nodes. `src/runner/onto.mjs` is the onto one and documents the interface:
`run(job, { cwd, log })` answering `{ status, busy, refused }`, `unavailableNodes()`, and `jobs(sinceIso)` (what
the dashboard's lanes are drawn from). A config's `runner` may be a module path exporting `createRunner(cfg)`, or
the object itself.

## The service

`skulk service` runs nights for one project as a long-running service: it starts a run by itself at
`schedule.startAt` unless one is live or one has started since then that day (one started by hand after midnight
does not count as that evening's), and answers requests, one JSON object a line on stdin, each echoing its `id`:

| Request | Reply |
|---|---|
| `{"ping":true}` | `pong` and the project checkout's commit |
| `{"status":true}` | `runs`: every live run's round, step, areas, flags, and dollars used against its cap; `last`: the summary of the run that ended last |
| `{"plan":true}` | what a run started now would pick |
| `{"start":true}` | starts a run now, beside any already running; takes `areas`, `only`, `nodes`, `capUsd`, `budget` (`{review, match, fix}`), `merge: false`, `sweep: true`, and `resume` |
| `{"stop":true}` | with `round`, that run; without, every live run: no new jobs start, running ones finish, then each run patches, batches, and records what completed |

Starting or restarting the service never starts a run. Under onto, on the machine holding the project's checkout:

    onto sync --in skulk-myproject orochi                     # from ~/src/x-skulk
    onto service up skulk-myproject --in skulk-myproject --here --prefer orochi \
      --env SKULK_CONFIG=$HOME/src/myproject/skulk.config.mjs --env SKULK_BIN=$HOME/src/x-skulk/bin/skulk.mjs \
      --about "Runs the nightly blind-pair audit of myproject." -- bash -lc 'exec node bin/skulk.mjs service'
    onto call skulk-myproject '{"id":1,"status":true}'

`SKULK_BIN` makes each run start from the x-skulk checkout rather than the service's synced copy, so a change to
the pipeline reaches the next run without a sync.

## The dashboard

`dashboard/` is a standalone Vite app that draws the treemap of areas, the live runs' lanes, the rounds chart, the
jobs feed, the queue, and an area's defects. Its dev server answers `__skulk/map` and `__skulk/area?id=<area>` by
running `skulk map` and `skulk defects`. `dashboard/README.md` says how to start it.

`skulk map [--out <file>]` writes the same JSON for anything else that draws it.

## Where things go

| What | Where | Bound |
|---|---|---|
| A run's log, job outputs, and runner logs | `<state>/nights/<start>-round<N>/` | the newest `keepNights`; older ones are deleted when a run starts |
| A run's claim, status, stop request, and summary | `<state>/runs/<N>/`: the directory is the claim; `status.json` (with its pid) while it runs, `stop` when asked, `summary.json` when it ends | the newest `keepNights`, never a live one; pruned when a run starts |
| Node tree leases | `<state>/slots/<node>/<tree>` | deleted as each job ends; one whose pid is dead is taken back |
| Locks | `<state>/plan.lock`, `<state>/merge.lock` | one file each, deleted on release |
| Worktrees | `.worktrees/audit<N>-frozen-night`, `audit<N>-am-<area>`, `batch-<date>-audit<N>` in the project checkout | removed when the run ends, except a red batch's, which the report names |
| Node trees | `<name>-skulk-r<k>`, `<name>-skulk-f<k>` on each node | a fixed set; each job clears its own output |

`<state>` is the config's `state`, by default `~/.local/state/skulk/<name>`.

## Moving weasel over

weasel still runs its own copy (`scripts/skulk/`, and the audits page in WeaselDraw). `examples/weasel.config.mjs`
reproduces it: on weasel's tree at round 49 the partition, the dry-run plan, and the map JSON come out identical
to the originals' (`project` aside, a field the map gained). Cutting over, with no run live
(`onto call skulk '{"id":1,"status":true}'` shows none):

| Step | Detail |
|---|---|
| Add the config | `examples/weasel.config.mjs` → weasel's `skulk.config.mjs`; `examples/weasel/briefs/` and `examples/weasel/sweep.mjs` → weasel's `scripts/audit/`, and the config's `./weasel/` paths → `./scripts/audit/`. `examples/weasel/sweep.test.ts` goes with them (its imports then point at the x-skulk checkout) or stays here. |
| Delete from weasel | `scripts/skulk/` (code, tests, briefs, README); `apps/draw/src/dev/audits/`; `apps/draw/vite-plugin-skulk-map.ts` and its plugin in `apps/draw/vite.config.ts`; the `#/dev/audits` route in `apps/draw/src/main.tsx` and `apps/draw/src/dev/devRoutes.ts`, and its row in `RegistryInspector.test.tsx`; the `vite-plugin-skulk-map.ts` mention in `scripts/lib/fleet-triggers.mjs`. |
| Repoint docs | `docs/fleet.md` cites `scripts/skulk/README.md` for the control sweep; the config's round README intro and ledger row say "run by `scripts/skulk`" and cite `scripts/skulk/usage.mjs` — change the text to x-skulk if wanted. Rows already in `docs/hardening.md` stay as written. |
| State | None to migrate: the config's `state` is `~/.local/state/weasel-skulk`, and `runs/`, `nights/`, `slots/`, `limits.json`, and the locks keep their format. Node trees keep their names (`weasel-skulk-r<k>`, `weasel-skulk-f<k>`). A round stopped under the old code resumes under the new with `--resume N`. |
| The onto service | It changes from weasel's tree and `WEASEL_ROOT` to x-skulk's tree and `SKULK_CONFIG`: `onto sync --in skulk-weasel orochi` from `~/src/x-skulk`, then `onto service up skulk --in skulk-weasel --here --prefer orochi --env SKULK_CONFIG=/Users/mike/src/weasel/skulk.config.mjs --env SKULK_BIN=/Users/mike/src/x-skulk/bin/skulk.mjs --about "Runs the nightly blind-pair audit of weasel." -- bash -lc 'exec node bin/skulk.mjs service'`, which rewrites `~/.config/onto/services/skulk/`; the old `weasel-skulk` service tree can then go. Requests and replies are unchanged. |
| The dashboard | `SKULK_CONFIG=~/src/weasel/skulk.config.mjs` for x-skulk's dashboard instead of draw's `#/dev/audits`. |
| Log wording | The gate's log line reads `gate: test:batch passed` where weasel's read `fleet: test:batch passed`, and its log is `<batch>.test-batch.log` as before. Nothing parses it. |

## Developing

    npm install
    npx vitest run --maxWorkers=1 src/<file>.test.ts   # one file
    npm run typecheck

The tests are in `src/`, `test/`, and `examples/`.
