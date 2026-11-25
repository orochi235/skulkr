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
- fixing can work through the fix plan in round-sized pieces.

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
| **judge** | the ledger | whether to scan again: the stop rule, and which source to add next from the per-source estimates | Flow control over scanning process | Prefs that govern batch flow control | Implicit? | inside the loop |
| **land** | a stopped ledger | `.skulkr/saturation/<area>/<commit>/` and the registry lines it adds, committed to `main` | Saves results from recent scans to the database | | Currently explicit, should be automatic | `scour land` |
| **triage** | the registry's open saturation defects | a fix plan: groups similar defects and decides how/whether to assign them to fixers | Selects, batches, and prepares defects for fixing | | Implicit | no |
| **fix** | a fix plan | fixer commits, handed to the round pipeline's verify, batch, gate and merge | Writes, commits, and tests fixes. The kernel of the use case | | Implicit | `--fix-only` rounds fix open round findings; they do not take saturation defects |
| **ask** | `question` verdicts and declined defects | a list for a person to rule on | Happens automatically; deferred questions are logged and diverted from the pipeline for now | Updates: progress bar and frequent log events/status updates | Implicit | no; rounds leave these in `fix.md` |
| **close** | the landed fix | each defect's registry status, against its ledger id | Database changes and state updates visible on site | | Implicit | partly: the record commit rewrites the registry, but a fixer's verdicts are not yet tied to saturation defects |
| **compare** | landed ledgers and the rounds' estimates | how far each round's Chapman estimate, and each calibration factor, was from the saturated total for the same area | Update analytics in database | Charts and readouts in the app | Ambient | no |

## What each hand-off holds

| From → to | The file |
|---|---|
| pick → trawl | `<state>/saturation/<area>/ledger.json` with its frozen `commit` and `files`, and no occasions yet |
| trawl → collect | `reviews/<NN>-<source>.md` beside the ledger, listed in an `unfolded` list until collect takes them |
| collect → judge | the ledger's `occasions` and `defects`; every estimate is computed from these |
| land → triage | `.skulkr/saturation/…/ledger.json` and `.skulkr/defects/<area>.jsonl` |
| triage → fix | the fix plan, under `.skulkr/` (to design): batches of registry ids, each with the files they touch |
| fix → close | the round record's `fix.md` verdicts, naming registry ids |

## Decided

- The workflow is called **scour**: it both searches an area thoroughly and scrubs it clean. `skulkr scour` is the
  command, `saturate` and `sat` its aliases; "saturated" still names the stop rule's condition (2026-11-25).
- Scour runs as stages that each run on their own: trawl, collect, triage, fix (2026-11-25; first drafted as scan and sort).
- The search stage is **trawl**: haul after haul over one frozen commit until the catch thins, each occasion a haul;
  `skulkr scour trawl <area>`, so the command never says "scour scan" (2026-11-25).
- A defect only a scour found is not handed to a round's fixers until triage and fix exist (2026-11-25).

## Open

- **The names on disk and in code** still say saturation: `saturation/` in the state directory and in `.skulkr/`, the
  `saturate*.mjs` modules, the ledger's fields. Renaming the paths moves weasel's landed ledgers again.
- **Does fix go through the round pipeline?** Proposed: fix hands its commits to the round pipeline's verify, batch,
  gate and merge, as a `--fix-only` round does, rather than building its own.
- **Collect's verb.** `fold` or `pool` would keep commands to one syllable; `collect` was the first suggestion.
- **Does triage check each defect with a model?** A cheap read-only job per batch would ask whether it still reproduces
  at `HEAD`. It costs money and keeps fixers from chasing defects already gone. Without it, triage ranks from the
  registry and from what changed since the ledger's commit, and the fixer's `not a defect` verdict does the checking.
- **Where the fix plan lives,** and whether it is a file or a view over the registry and the index.
