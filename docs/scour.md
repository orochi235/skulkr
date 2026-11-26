# Scour, in stages

**Status: designed 2026-11-25, part built.** Built: the `scour/` paths, `delve` and `fold` as separate commands, the
triage fields, the Scour page's tree, and the trigger that stops a delve as `ready to fix` (README "Ready to fix",
2026-11-26). Unbuilt: landing as a shared library, then triage, fix, ask and close, then
the page's fix queue and "needs you" list; "Building the fix stage" below is the design for them. What runs today is the README's "Saturation" section: one
`skulkr scour` command that delves and folds in a loop, plus `ingest`, `import`, `land` and `ls`. This document is
the plan for splitting it into stages that run on their own. The table under "Stages" says which parts exist.

It is for whoever builds the stages, and for deciding what each one owes the next. It answers how an area goes from
"never reviewed hard" to "its defects fixed and the estimate checked".

## Why stages

A round reviews an area twice and estimates what is left. Saturation reviews one area at one frozen commit until
further reviews stop finding new defects. That gives a near-complete list of what the area holds, and a total to test
the rounds' estimates against. Today the whole thing is one command, and its defects stop at the ledger: nothing
checks them against the current code, and nothing fixes them.

Separate stages let each step run where and when it is cheapest:

- delves run overnight on this machine as the account that started them, as a session's subagents, or on the fleet with `--fleet` (2026-11-26);
- folding can be retried on its own after the matcher fails;
- fixing can work through the fix plan in batches of its own size.

Each stage reads only what the stage before it wrote, so any stage can be rerun alone.

## The flow

```
pick → [delve → fold → judge]* → land → triage → fix (→ verify → batch → merge) → close
                                                          ↘ ask
                                   compare (any time after land)
```

Delve, fold and judge loop until the stop rule holds. Everything after `land` works from committed data in the
project's `.skulkr/`, never from one machine's state directory.

## Stages

| Stage | Takes | Writes | Core action | UI expression(s) | User sees? | Exists today |
|---|---|---|---|---|---|---|
| **pick** | the partition, the registry, a budget | the areas to saturate, the frozen commit, the sources | The user (or a script) specifies a job | Whatever interface we use to pick an area from the map | Explicit | `scour run` picks areas by strategy within a budget (README "Choosing the next pass", 2026-11-25); `--at` and `--sources` on one area |
| **delve** | a picked area | one raw report per occasion, unmatched, under the ledger's `reviews/` | We run the job | Updates: progress bar and frequent log events/status updates | Explicit | `scour next <area>` from a session (the `skulkr-scour` skill), or `scour delve <area> --fleet`; the Codex skill and `ingest` bring outside reports |
| **fold** | reports not yet in the ledger | the ledger's distinct defects and sightings (the ledger matcher) | Job results binned in the ledger | Items in various results lists | Implicit? | `scour fold <area>`, run by every delve and ingest |
| **judge** | the ledger | whether to scan again: the stop rule, and which source to add next from the per-source estimates | Flow control over scanning process | Prefs that govern batch flow control | Configured | inside the loop |
| **land** | a stopped ledger | `.skulkr/scour/<area>/<commit>/` and the registry lines it adds, committed to `main` | Saves results from recent scans to the database | | Automatic | `scour land`, run by hand |
| **triage** | the registry's open saturation defects | a fix plan: groups similar defects and decides how/whether to assign them to fixers | Selects, batches, and prepares defects for fixing | The fix queue on the Scour page: what the next fix run takes, in what batches, with a way to hold a defect back | Implicit | no |
| **fix** | a fix plan | fixer commits, landed by the verify, batch, gate and merge that rounds also use | Writes, commits, and tests fixes. The kernel of the use case | | Implicit | `--fix-only` rounds fix open round findings; they do not take saturation defects |
| **ask** | `question` verdicts and declined defects | an agent's ruling on each: fix it (back to triage) or not a defect (to close); what needs a person leaves the pipeline, logged | Happens automatically; deferred questions are logged and diverted from the pipeline for now | Updates: progress bar and frequent log events/status updates; a "needs you" list on the Scour page of what left the pipeline | Implicit | no; rounds leave these in `fix.md` |
| **close** | the landed fix | each defect's registry status, against its ledger id | Database changes and state updates visible on site | | Implicit | partly: the record commit rewrites the registry, but a fixer's verdicts are not yet tied to saturation defects |
| **compare** | landed ledgers and the rounds' estimates | how far each round's Chapman estimate, and each calibration factor, was from the saturated total for the same area | Update analytics in database | Charts and readouts in the app | Passive: always on the page, nothing to act on | no |

## What each hand-off holds

| From → to | The file |
|---|---|
| pick → delve | `<state>/scour/<area>/ledger.json` with its frozen `commit` and `files`, and no occasions yet |
| delve → fold | `reviews/unfolded-<NN>-<source>.md` beside the ledger, listed in its `unfolded` until fold takes them |
| fold → judge | the ledger's `occasions` and `defects`; every estimate is computed from these |
| land → triage | `.skulkr/scour/…/ledger.json` and `.skulkr/defects/<area>.jsonl` |
| triage → fix | the fix plan, computed when a fix run starts and never stored: batches of registry ids, each with the files they touch |
| fix → close | scour's own fix record: the fixers' verdicts, naming registry ids |

## Building the fix stage

Unbuilt (2026-11-25). Every landing step reads its names from `cfg.names`, which `config.mjs` derives from
`naming.prefix` (`audit<N>-<area>` branches, `batch/<date>-audit<N>`, `audit<N>-am-<area>` trees, the gate's job
pattern, `branchOf`, `idOf`). A round number runs through all of them: `applyFix`, `makeBatch`, `gateOnFleet`,
`repairCapstone`'s test of which branches are this run's, and the map's parsing of the log.

- **Names.** Make the name set a function of its prefix (`namesFor(prefix)`), `cfg.names` being `namesFor(naming.prefix)`
  as now. A fix run calls the landing code with `{ ...cfg, names: namesFor('scour') }`, numbered by its own counter
  (`scour<N>-<area>`, `batch/<date>-scour<N>`), so no landing function changes its signature and rounds see no change.
- **What `batchAndTest` must be told rather than assume.** Its record commit (`commitRecord`, the round's
  `round-<N>/`) becomes a `record(tree)` it is passed; a fix run commits its own record there and rewrites
  `.skulkr/defects/`. Its left-out store (`leftOutIn(cfg.state)`, which later rounds retry) becomes one it is passed, so
  a fix run neither retries round branches nor leaves branches for rounds to retry.
- **Fix.** Per triage batch, a fixer job like a round's (`fixer.md`), handed registry ids with each defect's claim,
  where, scenario and triage fields, its verify as a round fixer's; verdicts name registry ids, which `close` writes
  as statuses.
- **Where it runs.** `skulkr scour fix [<area>…]`, state under `<state>/scour/fix-<N>/`, the record under
  `.skulkr/scour/fix-<N>/`.

## Decided

- The workflow is called **scour**: it both searches an area thoroughly and scrubs it clean. `skulkr scour` is the
  command, `saturate` and `sat` its aliases; "saturated" still names the stop rule's condition (2026-11-25).
- Scour runs as stages that each run on their own: delve, fold, triage, fix (2026-11-25; first drafted as scan and sort).
- The search stage is **delve**: review after review over one frozen commit, digging until the stop rule holds;
  `skulkr scour delve <area>`, so the command never says "scour scan" (2026-11-25; first named trawl).
- **ask** is agents reviewing other agents' work: a fixer's `question` verdicts and declined defects go to a
  reviewing agent, not a person. Anything that needs a person is pulled out of the pipeline and logged (2026-11-25).
- A defect only a scour found is not handed to a round's fixers until triage and fix exist (2026-11-25).
- Collect's verb is **fold**: sightings fold into defects; `skulkr scour fold <area>` reruns it after the matcher
  changes (2026-11-25).
- The names on disk follow: `saturation/` becomes `scour/` in the state directory and in `.skulkr/`, with the old path
  still read, as `record.dir` reads `formerDirs`; weasel's landed ledgers move with it (2026-11-25). Built 2026-11-25
  (`src/scourPaths.mjs`).
- **fix is its own process, not a round.** It has its own triage, batches and record, and never takes a round number
  or enters the rounds' history. Only the landing is shared: verify, batch with conflict repair, gate and capstone with
  blame, and the fast-forward of `main` move out of the round code into a library both call (2026-11-25).
- **The fix plan is transient**: a query over the registry, computed when a fix run starts; holding a defect back is
  a status on its registry line. A way to dump a plan to a file for editing may come later if it proves needed
  (2026-11-25).
- **Triage checks nothing with a model.** It ranks from the registry and from what changed since the ledger's commit;
  the fixer, which reads the code at `HEAD` anyway, finds defects already gone with its `not a defect` verdict. Fix
  runs report that verdict's rate, and a check before fixing is added only if the rate shows fixers spending real
  money on vanished defects (2026-11-25).
- **What triage knows about a defect comes from the agent that found it.** A delve's reviewer records it with the
  finding, the ledger and registry keep it, and triage reads only that; nothing goes back to the code to learn it
  (2026-11-25).
- **ask's rulings route back into the pipeline**: "fix it" returns the defect to triage, "not a defect" sends it to
  close; what needs a person leaves the pipeline, logged and listed on the Scour page as "needs you" (2026-11-25).
- **A finding carries what triage needs**, written by the reviewer that found it (2026-11-25), a first set expected to
  grow:

  | Field | The reviewer writes | Triage uses it for |
  |---|---|---|
  | `scenario` | the triggering input or state and what happens, as today; the ledger and registry now keep it | the fixer's starting point |
  | `fix` | the files a fix would touch, where they differ from `where` | batching: fixes touching the same files go to one fixer; batches sharing no files run in parallel |
  | `size` | `line`, `function` or `design` | `design` goes to ask, not a fixer; the rest size the batches |
  | `cause` | a short phrase for the root cause, when seen | grouping one cause's defects for one fixer, across files |
  | `confidence` | `sure` or `likely` | ordering, `likely` later; the `not a defect` rate is tracked against it |

  A defect sighted more than once takes the highest severity, the union of `fix` files, the largest size, and its
  first sighting's scenario. Built 2026-11-25 (`src/triageFields.mjs`, `briefs/scourTriage.md`).

## Open

- **Refolding a ledger from scratch** after the matcher changes. It would renumber the ledger's defects, and the
  registry's ids for scour defects are built from those numbers, so a refold of a landed ledger would orphan every
  registry line that has a status. Not built; it needs a way to carry ids across, or to refold only unlanded ledgers.
