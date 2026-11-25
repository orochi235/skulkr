# Scour, in stages

**Status: designed 2026-11-25, mostly unbuilt.** What runs today is the README's "Saturation" section: one
`skulkr scour` command that scans and collects in a loop, plus `ingest`, `import`, `land` and `ls`. This document is
the plan for splitting it into stages that run on their own. The table under "Stages" says which parts exist.

It is for whoever builds the stages, and for deciding what each one owes the next. It answers how an area goes from
"never reviewed hard" to "its defects fixed and the estimate checked".

## Why stages

A round reviews an area twice and estimates what is left. Saturation reviews one area at one frozen commit until
further reviews stop finding new defects. That gives a near-complete list of what the area holds, and a total to test
the rounds' estimates against. Today the whole thing is one command, and its defects stop at the ledger: nothing
checks them against the current code, and nothing fixes them.

Separate stages let each step run where and when it is cheapest:

- trawls can run overnight on the fleet;
- collecting can be run again after the matcher changes;
- fixing can work through the fix plan in batches of its own size.

Each stage reads only what the stage before it wrote, so any stage can be rerun alone.

## The flow

```
pick → [trawl → collect → judge]* → land → triage → fix (→ verify → batch → merge) → close
                                                          ↘ ask
                                   compare (any time after land)
```

Trawl, collect and judge loop until the stop rule holds. Everything after `land` works from committed data in the
project's `.skulkr/`, never from one machine's state directory.

## Stages

| Stage | Takes | Writes | Core action | UI expression(s) | User sees? | Exists today |
|---|---|---|---|---|---|---|
| **pick** | the partition, the registry, a budget | the areas to saturate, the frozen commit, the sources | The user (or a script) specifies a job | Whatever interface we use to pick an area from the map | Explicit | only as `--at` and `--sources` on one area |
| **trawl** | a picked area | one raw report per occasion, unmatched, under the ledger's `reviews/` | We run the job | Updates: progress bar and frequent log events/status updates | Explicit | inside `scour <area>`'s loop; the Codex skill and `ingest` bring outside reports |
| **collect** | reports not yet in the ledger | the ledger's distinct defects and sightings (the ledger matcher) | Job results binned in the ledger | Items in various results lists | Implicit? | inside the same loop, as `foldIn` |
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
| pick → trawl | `<state>/scour/<area>/ledger.json` with its frozen `commit` and `files`, and no occasions yet |
| trawl → collect | `reviews/<NN>-<source>.md` beside the ledger, listed in an `unfolded` list until collect takes them |
| collect → judge | the ledger's `occasions` and `defects`; every estimate is computed from these |
| land → triage | `.skulkr/scour/…/ledger.json` and `.skulkr/defects/<area>.jsonl` |
| triage → fix | the fix plan, computed when a fix run starts and never stored: batches of registry ids, each with the files they touch |
| fix → close | scour's own fix record: the fixers' verdicts, naming registry ids |

## Decided

- The workflow is called **scour**: it both searches an area thoroughly and scrubs it clean. `skulkr scour` is the
  command, `saturate` and `sat` its aliases; "saturated" still names the stop rule's condition (2026-11-25).
- Scour runs as stages that each run on their own: trawl, collect, triage, fix (2026-11-25; first drafted as scan and sort).
- The search stage is **trawl**: haul after haul over one frozen commit until the catch thins, each occasion a haul;
  `skulkr scour trawl <area>`, so the command never says "scour scan" (2026-11-25).
- **ask** is agents reviewing other agents' work: a fixer's `question` verdicts and declined defects go to a
  reviewing agent, not a person. Anything that needs a person is pulled out of the pipeline and logged (2026-11-25).
- A defect only a scour found is not handed to a round's fixers until triage and fix exist (2026-11-25).
- Collect's verb is **fold**: sightings fold into defects; `skulkr scour fold <area>` reruns it after the matcher
  changes (2026-11-25).
- The names on disk follow: `saturation/` becomes `scour/` in the state directory and in `.skulkr/`, with the old path
  still read, as `record.dir` reads `formerDirs`; weasel's landed ledgers move with it (2026-11-25).
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
- **What triage knows about a defect comes from the agent that found it.** A trawl's reviewer records it with the
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
  first sighting's scenario.

## Open

Nothing; the plan is ready to build.
