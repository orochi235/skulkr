# skulkr

Nightly blind-pair audits of a git repository. Each night (a *run*, one numbered *round*) takes some areas of the
codebase. Two Claude reviewers read each area without seeing each other's work, a matcher pairs their findings,
Chapman's estimator says how many defects the area still holds, and a fixer fixes what they found on a branch.
The branches merge into one batch, the batch runs the project's test gate, and a green batch fast-forwards
`main`. A record of the round is committed beside the fixes. A dashboard draws the areas, the live runs, and the
rounds so far.

This README is for whoever adopts skulkr in a project or runs it.

Everything is plain Node (24 or later). The model calls are `claude -p` jobs run on fleet nodes through a *runner*:
onto (`~/src/onto`) by default, swappable (see "Runners").

## Adopting it

A project adopts skulkr by committing one file, `skulkr.config.mjs`, at its root. It is an ES module whose default
export is a plain object (or a function answering one). Everything left out takes the default below.
`examples/weasel.config.mjs` is a full one.

```js
// skulkr.config.mjs
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
  claude: {
    configDir: '~/.claude-msb',
    models: { match: 'haiku' },       // per role (review, match, fix); unset takes what the job's settings give
    effort: {},                       // per role, `--effort`; unset likewise
    settingSources: 'project,local',  // `--setting-sources`: the node account's own settings stay out; null omits it
    timeoutMin: 45,
  },

  areasPerRound: 16,
  budget: { review: 8, match: 1, fix: 15, capUsd: 160, areaGuessUsd: 10, nightUsd: undefined }, // list-price dollars
  schedule: { startAt: '23:00', stopAt: '07:00', continuous: false }, // the service's start; when a run stops dispatching
  state: undefined,                   // default ~/.local/state/skulkr/<name>
  sweep: null,                        // an extra check beside the reviews; see "A sweep"
  icons: null,                        // the map's area icons; see "Area icons"
};
```

Then, from the project's checkout:

    node ~/src/skulkr/bin/skulkr.mjs partition       # writes docs/audits/partition.json; check the areas look right
    node ~/src/skulkr/bin/skulkr.mjs night --dry     # the plan a run would make
    node ~/src/skulkr/bin/skulkr.mjs night           # one run

Every command finds the config through `--config <file>`, else `SKULKR_CONFIG`, else `skulkr.config.mjs` in
`--root`, `SKULKR_ROOT`, or the working directory. The project root is the main worktree of the repository holding
the config, unless the config's `root` or `--root` says otherwise. `skulkr config` prints the resolved config.

**Briefs.** The shipped briefs in `briefs/` are generic and fill `{{project}}`, `{{rules}}`, `{{test}}`,
`{{typecheck}}`, and `{{lint}}` from the config, beside their own variables (`{{round}}`, `{{area}}`,
`{{commit}}`, `{{files}}`, `{{out}}` for a reviewer; `{{source}}` for a fixer; `{{attempt}}`, `{{command}}`,
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
| review | Per area, two reviewer jobs from the frozen tree with the reviewer brief and the area's file list. Reviewers may read, search, and run `git log/show/diff/blame`, and write only `.skulkr/out/`. Each lists the files it read; its stream goes through `src/progress.mjs`, so the runner shows how many of the area's files it has opened. |
| match | One job per area pairs the two lists (the matcher brief); the pipeline keeps only one-to-one pairs and computes the estimate. |
| fix | Per area with findings, one fixer job, permissions bypassed, in the node's synced tree. It first commits the synced tree and checks it hashes to the frozen commit's tree, installs if the lockfile changed, then hands back its commits as an mbox. |
| verify | Per fixer with commits, the config's `checks.verify` over the files they changed, run by skulkr, never read from the fixer's report; see "Verify and repair". |
| repair | Per area whose verify fails, up to two repair jobs on its commits, each verified again; an area still failing is left out of the batch. |
| patch | Each mbox is applied with `git am` onto `audit<N>-<area>` at the frozen commit. One that does not apply is reported and left out. |
| batch | Every branch merges into `batch/<date>-audit<N>` (a worktree); a conflicting one is left out and reported. The round's record is committed there. Then the run waits for `merge.lock`, held by one run at a time from its gate through `main`'s fast-forward; holding it, it merges `main` in if another run has landed meanwhile, waits its turn in the fleet queue (step `fleet-wait`; see "Continuous rounds"), and runs the gate on the tip. |
| merge | Green: local `main` fast-forwards to the batch (never pushed), and the branches are deleted. If `main` moved during the gate, it is merged in and the gate runs again, up to twice. Red: one capstone repair cycle (see "Verify and repair"), and the gate once more; still red, the batch worktree and its branches stay, and the report names them and what was tried. |

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

**Which areas.** Never-audited areas go first, in partition order. Then the due ones: most lines of their files
changed since their last pass first, then the longest since that pass. An area is *settled*, and skipped, after
two consecutive passes that each found at most one distinct defect, on the same file list, with nothing but those
passes' own fixes changing its files since. What is due comes only from the `area.json` files of earlier rounds and
git.

**History follows files.** A pass belongs to the files it read (its `files.txt`, also `files` in its `area.json`),
not to its area's name, so a recut partition keeps what was learned. An area inherits every pass that read any of
its files now, with a *share*: the part of that pass's files the area holds. The pass's Chapman estimate and its
"left" are scaled by that share, so a pass split across two areas is counted once between them, and a renamed area,
holding all of its pass's files, keeps its whole history. An area counts as audited only once passes have read at
least half its files now (`COVERED` in `src/rounds.mjs`); below that it queues as never audited, its inherited
passes still shown.

**Stale estimates.** An area whose files changed since its last pass carries `staleLines` in the map: lines added
plus deleted in those files (`git log --numstat`, merges left out) by every commit since the pass's commit but that
pass's own fixes. The plan prints it, the queue weighs it, and the dashboard fades the area and says how much of
"≈ left" sits in such areas. Each commit's counts are cached in `~/.cache/skulkr/<name>/churn.json`, so a map
rebuild asks git only about commits it has not seen.

**Limits.** Each job's model is stopped at `claude.timeoutMin` and the runner stops the job ten minutes later, so
what it wrote still comes home. A run starts no new area after `schedule.stopAt`, nor when the areas running plus
one more, each expected to cost the mean of this run's finished areas (`budget.areaGuessUsd` before any has),
would pass the dollar cap. An area whose reviewers ran always gets its matcher and fixer. A node the runner
reports unavailable is skipped; a dispatch a node refuses moves to another node and keeps that one out for
`nodes.refusedCooldownMin`. `<state>/limits.json` (`{ "review": n, "fix": n }`) changes the slots per node for
runs already going.

## Verify and repair

A fixer runs checks of its own, but chooses which, and reads their verdict itself. skulkr does not take its word:
with `checks.verify` set, it runs the project's verify step itself on what each fixer committed.

| Part | What happens |
|---|---|
| `command` | Runs at the end of the fixer's own job, after the model exits, on the committed tree (uncommitted edits are dropped first). `{files}` is the files the fixer's commits changed; `{related}` is the same as one `--related=<file>` each. Bounded by `timeoutMin` (default 20). |
| `gui` | `{ probe, command }` for tests that need a node's GUI session. `probe` runs beside `command` and prints the test files the GUI part would run, one a line; when it lists one, or fails, `command` runs in an `onto do --gui` job of its own on the area's commits. With no `probe`, the GUI part runs for any change. |
| verdict | The command's exit status and vitest's `Test Files` counts: it passes only on exit 0 with no file failed, so a file whose setup or teardown throws fails even when every test in it passes. |
| repair | A failing verdict goes, verbatim, to a repair job (`briefs/repair.md`, or the config's `briefs.repair`) on the area's commits, told to make it pass without weakening a test. Its commits are verified the same way. After two repairs that still fail, the area is left out of the batch, as a conflicting branch is. A run that timed out is not repaired: the area lands, and the capstone checks it. |
| capstone | A red gate's `fleet-fail:` files are laid at the area branches whose commits changed each file, else changed a file it reaches by relative imports, else changed a workspace package it imports; a file none reaches is unattributed. Each such branch gets one repair job given the gate's lines about its files, which its verify step checks beside its own changes. Repaired branches are patched again, the rest are left out, the batch is rebuilt, and the gate runs once more. One cycle per round. |

The night log prints a `verify` line per area and a `repair` line per repair; each area's `area.json` and the run's
`summary.json` keep `verify` (`ok`, `why`, `repairs`, `testFiles`, `failedFiles`), and the closing `night:` line counts
the areas that passed, passed after a repair, timed out, or were left out. The dashboard draws the repair as a lane
step after the fix.

weasel's config runs `npx vitest related --run` from the tree root over every project but `gate` and the browser
ones, with four workers, and the browser projects with two on a GUI node.

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
`run(job, { cwd, log })` answering `{ status, busy, refused }`, `unavailableNodes()`, `jobs(sinceIso)` (what
the dashboard's lanes are drawn from), and optionally `progress()`, each running job's own count by task (a running
step's fill). A config's `runner` may be a module path exporting `createRunner(cfg)`, or
the object itself.

## The service

`skulkr service` runs nights as a long-running service, for the project its config names or, with none named, for
every registered tenant (see "Tenants"). For each project it starts a run by itself at
`schedule.startAt` unless one is live or one has started since then that day (one started by hand after midnight
does not count as that evening's), or keeps rounds coming in continuous mode (see "Continuous rounds"), and answers
requests, one JSON object a line on stdin, each echoing its `id`:

| Request | Reply |
|---|---|
| `{"ping":true}` | `pong`, skulkr's commit (`build`), and the tenants hosted; with `tenant`, that project checkout's commit |
| `{"status":true}` | `runs`: every live run's round, step, areas, flags, dollars used against its cap, and `behind`, what a waiting one waits for; `last`: the summary of the run that ended last; `continuous`: the mode, what the next round waits on (`next`), and `nightUsd`, `spentUsd`, `leftUsd`, and `estimateUsd`; `queues`: the round in its model steps (`model`) and the fleet queue's holder and waiters (`fleet`) |
| `{"plan":true}` | what a run started now would pick |
| `{"start":true}` | starts a run now, beside any already running; takes `areas`, `only`, `nodes`, `capUsd`, `budget` (`{review, match, fix}`), `merge: false`, `sweep: true`, and `resume` |
| `{"start":true,"continuous":true}` | turns continuous mode on until the night's `stopAt`, and starts its first round if the queues and budget allow; takes no other field. `"continuous":false` turns it off |
| `{"stop":true}` | with `round`, that run; without, every live run and continuous mode until the night's `stopAt`: no new jobs start, running ones finish, then each run patches, batches, and records what completed |

Every request but a bare `ping` may carry `tenant`, the project it is about, and every reply to one names its
`tenant`. Without one it means the only tenant, and is refused when there are several.

Starting or restarting the service never starts a run. Under onto, on the machine holding the project's checkout:

    onto sync --in skulkr-myproject orochi                     # from ~/src/skulkr
    onto service up skulkr-myproject --in skulkr-myproject --here --prefer orochi \
      --env SKULKR_CONFIG=$HOME/src/myproject/skulkr.config.mjs --env SKULKR_BIN=$HOME/src/skulkr/bin/skulkr.mjs \
      --about "Runs the nightly blind-pair audit of myproject." -- bash -lc 'exec node bin/skulkr.mjs service'
    onto call skulkr-myproject '{"id":1,"status":true}'

`SKULKR_BIN` makes each run start from the skulkr checkout rather than the service's synced copy, so a change to
the pipeline reaches the next run without a sync.

## Continuous rounds

A round's model work (reviews, matches, fixes) is cheap on fleet CPU and bound by spend; its gate is one suite-sized
fleet run. Continuous mode overlaps the two, keeping a tenant's rounds coming through two queues:

| Queue | Holds | A round waiting on it |
|---|---|---|
| model | at most one round per tenant in its model steps (`freeze`, `review`) | the next continuous round starts once the last reaches `patch` |
| fleet | at most one gate across every tenant and every run, however started | sits at step `fleet-wait`, its status `behind` naming the holder |

The fleet queue is on disk, in `~/.local/state/skulkr/fleet/` (`SKULKR_FLEET` names another): `gate.lease` is the
holder, a lease like the slots', and `waiting/` holds a ticket per waiting run, taken oldest first. A run whose
process has died loses its lease and its ticket.

Continuous mode is on between `startAt` and `stopAt` when the config sets `schedule.continuous: true`, or from a
`{"start":true,"continuous":true}` request until the night's `stopAt` or a bare `{"stop":true}`, which also turns
off the config's mode for the rest of that night. A request's mode is kept in `<state>/continuous.json`, so it
survives the service restarting. It needs `budget.nightUsd`: with none, there is no continuous mode, and a config
asking for it keeps the plain scheduled start.

Each tick (every 30 seconds) the service starts a tenant's next round when all of these hold:

- the mode is on, and the tenant is not read-only;
- no round of the tenant is in its model steps, or started and not yet claimed, and no other tenant's is;
- the night's spend plus the next round's estimate stays within `budget.nightUsd`.

The night, for the budget, runs from one `stopAt` to the next, so a round started in the afternoon counts against
the coming night. Its spend is every round started in it, from `status.json` while live and `summary.json` after
(run directories from the last day are never pruned). The estimate is `areasPerRound` times the mean cost per
finished area of the last five rounds, or `areasPerRound × budget.areaGuessUsd` before any. Each continuous round
runs with `--cap-usd` set to the night's budget left or `budget.capUsd`, whichever is less. A continuous round that
claims nothing or fails ends the chain for the night. `stopAt` still stops every run dispatching, as before.

## Tenants

One skulkr host can serve several projects, its *tenants*. Each keeps its own config and state; the registry,
`~/.config/skulkr/tenants.json` (`SKULKR_TENANTS` names another), lists them as `[{ "name", "config" }]`, the config an
absolute path.

    skulkr tenants ls [--json]                          # the registered tenants
    skulkr tenants add <config> [--name n] [--read-only] # name: the config's own `name` unless given
    skulkr tenants rm <name>

Every command takes `--tenant <name>` beside `--config` to name a tenant's config (`skulkr map --tenant weasel`).

`skulkr service` with no config named hosts every tenant in the registry, reread every 30 seconds and before each
request, so one added while it runs is picked up without a restart. Each tenant keeps its own `schedule.startAt`.
Rounds of different tenants never do their model work at once, since they share the fleet's slots: a tenant due, or
asked to start, while another's round is in its model steps waits until that round reaches its patch step, and its
`status` reply lists that under `waiting` (`behind` names the tenant it waits on), beside `nextStart`, its next
scheduled start. Their gates take turns in the fleet queue. A tenant's own rounds may still run beside each other
when started by hand. A tenant added `--read-only` is shown and its live rounds hold the fleet like any other's, but
the service never starts or stops one: its rounds run under another service.

weasel is registered read-only (`examples/weasel.config.mjs`, root `~/src/weasel`, state
`~/.local/state/weasel-skulkr`), so the dashboard reads its live state while weasel's own service runs its rounds.
Cutting over drops `--read-only` (see "Moving weasel over").

## The dashboard

`dashboard/` is a standalone Vite app that draws the treemap of areas, the live runs' lanes, the rounds chart, the
jobs feed, the queue, and an area's defects. Its dev server lists the tenants at `api/tenants` (`skulkr tenants ls`,
or with none registered the one project `SKULKR_CONFIG` or the working directory names), and serves each tenant's
map at `api/t/<name>/map` and an area's defects at `api/t/<name>/area?id=<area>`, by running `skulkr map` and
`skulkr defects` with `--tenant`. The page's title is a menu of the tenants; the one shown is in the URL hash
(`#weasel`), and each viewer's last choice is remembered. `dashboard/README.md` says how to start it.

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

## Where things go

| What | Where | Bound |
|---|---|---|
| A run's log, job outputs, and runner logs | `<state>/nights/<start>-round<N>/` | the newest `keepNights`; older ones are deleted when a run starts |
| A run's claim, status, stop request, and summary | `<state>/runs/<N>/`: the directory is the claim; `status.json` (with its pid) while it runs, `stop` when asked, `summary.json` when it ends | the newest `keepNights`, never a live one nor one started in the last day; pruned when a run starts |
| Each commit's lines changed, for `staleLines` | `~/.cache/skulkr/<name>/churn.json` | only the commits after the oldest pass any area last had; rewritten without the rest on each build that adds one |
| Node tree leases | `<state>/slots/<node>/<tree>` | deleted as each job ends; one whose pid is dead is taken back |
| Locks | `<state>/plan.lock`, `<state>/merge.lock` | one file each, deleted on release |
| The fleet queue | `~/.local/state/skulkr/fleet/`: `gate.lease` and a ticket per waiting run in `waiting/` | the lease deleted on release, a ticket when its run takes the gate; a dead pid's of either is cleared |
| Continuous mode asked for | `<state>/continuous.json` | one file, rewritten by each request |
| Worktrees | `.worktrees/audit<N>-frozen-night`, `audit<N>-am-<area>`, `batch-<date>-audit<N>` in the project checkout | removed when the run ends, except a red batch's, which the report names |
| Node trees | `<name>-skulkr-r<k>`, `<name>-skulkr-f<k>` on each node | a fixed set; each job clears its own output |

`<state>` is the config's `state`, by default `~/.local/state/skulkr/<name>`.

## Moving weasel over

weasel still runs its own copy (`scripts/skulk/`, and the audits page in WeaselDraw). `examples/weasel.config.mjs`
reproduces it: on weasel's tree at round 49 the partition, the dry-run plan, and the map JSON come out identical
to the originals' (`project` aside, a field the map gained). Cutting over, with no run live
(`onto call skulk '{"id":1,"status":true}'`, weasel's own service, shows none):

| Step | Detail |
|---|---|
| Add the config | `examples/weasel.config.mjs` → weasel's `skulkr.config.mjs`; `examples/weasel/briefs/` and `examples/weasel/sweep.mjs` → weasel's `scripts/audit/`, and the config's `./weasel/` paths → `./scripts/audit/`. `examples/weasel/sweep.test.ts` goes with them (its imports then point at the skulkr checkout) or stays here. |
| Delete from weasel | `scripts/skulk/` (code, tests, briefs, README); `apps/draw/src/dev/audits/`; `apps/draw/vite-plugin-skulk-map.ts` and its plugin in `apps/draw/vite.config.ts`; the `#/dev/audits` route in `apps/draw/src/main.tsx` and `apps/draw/src/dev/devRoutes.ts`, and its row in `RegistryInspector.test.tsx`; the `vite-plugin-skulk-map.ts` mention in `scripts/lib/fleet-triggers.mjs`. |
| Repoint docs | `docs/fleet.md` cites `scripts/skulk/README.md` for the control sweep; the config's round README intro and ledger row say "run by `scripts/skulk`" and cite `scripts/skulk/usage.mjs` — change the text to skulkr if wanted. Rows already in `docs/hardening.md` stay as written. |
| State | weasel's state is in `~/.local/state/weasel-skulk`; the config's `state` is `~/.local/state/weasel-skulkr`, so move the directory across. `runs/`, `nights/`, `limits.json`, and the locks keep their format; `slots/` names the old trees, and with no run live it can be emptied. Node trees are renamed (`weasel-skulkr-r<k>`, `weasel-skulkr-f<k>`), so each node syncs fresh ones and the old `weasel-skulk-r<k>`, `weasel-skulk-f<k>` can go. |
| The onto service | It changes from weasel's tree and `WEASEL_ROOT` to skulkr's tree and `SKULKR_CONFIG`: `onto sync --in skulkr-weasel orochi` from `~/src/skulkr`, then `onto service up skulkr --in skulkr-weasel --here --prefer orochi --env SKULKR_CONFIG=/Users/mike/src/weasel/skulkr.config.mjs --env SKULKR_BIN=/Users/mike/src/skulkr/bin/skulkr.mjs --about "Runs the nightly blind-pair audit of weasel." -- bash -lc 'exec node bin/skulkr.mjs service'`, which writes `~/.config/onto/services/skulkr/`; then take down weasel's own `skulk` service, and its `weasel-skulk` service tree can go. Requests are unchanged; each reply also names its `tenant`. To host every tenant instead, leave out `SKULKR_CONFIG`: the service then reads the registry. |
| The dashboard | Already reads weasel as a tenant; re-register it from its new config: `skulkr tenants rm weasel`, then `skulkr tenants add ~/src/weasel/skulkr.config.mjs` (no `--read-only`, now that this host runs its rounds). The config's `root: '~/src/weasel'` line goes: unset is the repository holding the config. |
| Log wording | The gate's log line reads `gate: test:batch passed` where weasel's read `fleet: test:batch passed`, and its log is `<batch>.test-batch.log` as before. Nothing parses it. |

## Developing

    npm install
    npx vitest run --maxWorkers=1 src/<file>.test.ts   # one file
    npm run typecheck

The tests are in `src/`, `test/`, and `examples/`.
