# Saturation as stages

**Status: designed 2026-11-25, mostly unbuilt.** What runs today is the README's "Saturation" section: one
`skulkr saturate` command that scans and collects in a loop, plus `ingest`, `import`, `land` and `ls`. This document is
the plan for splitting it into stages that run on their own. The table under "Stages" says which parts exist.

It is for whoever builds the stages, and for deciding what each one owes the next. It answers how an area goes from
"never reviewed hard" to "its defects fixed and the estimate checked".

## Why stages

A round reviews an area twice and estimates what is left. Saturation reviews one area at one frozen commit until
further reviews stop finding new defects. That gives a near-complete list of what the area holds, and a total to test
the rounds' estimates against. Today the whole thing is one command, and its defects stop at the ledger: nothing
checks them against the current code, and nothing fixes them.

Separate stages let each step run where and when it is cheapest:

- scans can run overnight on the fleet;
- collecting can be run again after the matcher changes;
- fixing can drain the queue in round-sized pieces.

Each stage reads only what the stage before it wrote, so any stage can be rerun alone.

## The flow

```
pick → [scan → collect → judge]* → land → sort → fix (→ verify → batch → merge) → close
                                                        ↘ ask
                                   compare (any time after land)
```

Scan, collect and judge loop until the stop rule holds. Everything after `land` works from committed data in the
project's `.skulkr/`, never from one machine's state directory.

## Stages

| Stage | Takes | Writes | Exists today |
|---|---|---|---|
| **pick** | the partition, the registry, a budget | the areas to saturate, the frozen commit, the sources | only as `--at` and `--sources` on one area |
| **scan** | a picked area | one raw report per occasion, unmatched, under the ledger's `reviews/` | inside `saturate <area>`'s loop; the Codex skill and `ingest` bring outside reports |
| **collect** | reports not yet in the ledger | the ledger's distinct defects and sightings (the ledger matcher) | inside the same loop, as `foldIn` |
| **judge** | the ledger | whether to scan again: the stop rule, and which source to add next from the per-source estimates | inside the loop |
| **land** | a stopped ledger | `.skulkr/saturation/<area>/<commit>/` and the registry lines it adds, committed to `main` | `saturate land` |
| **sort** | the registry's open saturation defects | a fix queue: each defect checked against today's `main`, linked to round defects, ranked, and grouped into fix-sized batches by file | no |
| **fix** | a queue batch | fixer commits, handed to the round pipeline's verify, batch, gate and merge | `--fix-only` rounds fix open round findings; they do not take saturation defects |
| **ask** | `question` verdicts and declined defects | a list for a person to rule on | no; rounds leave these in `fix.md` |
| **close** | the landed fix | each defect's registry status, against its ledger id | partly: the record commit rewrites the registry, but a fixer's verdicts are not yet tied to saturation defects |
| **compare** | landed ledgers and the rounds' estimates | how far each round's Chapman estimate, and each calibration factor, was from the saturated total for the same area | no |

## What each hand-off holds

| From → to | The file |
|---|---|
| pick → scan | `<state>/saturation/<area>/ledger.json` with its frozen `commit` and `files`, and no occasions yet |
| scan → collect | `reviews/<NN>-<source>.md` beside the ledger, listed in an `unfolded` list until collect takes them |
| collect → judge | the ledger's `occasions` and `defects`; every estimate is computed from these |
| land → sort | `.skulkr/saturation/…/ledger.json` and `.skulkr/defects/<area>.jsonl` |
| sort → fix | a queue file under `.skulkr/` (to design): batches of registry ids, each with the files they touch |
| fix → close | the round record's `fix.md` verdicts, naming registry ids |

## Decided

- Saturation runs as stages that each run on their own: scan, collect, sort, fix (2026-11-25).
- A defect only saturation found is not handed to a round's fixers until sort and fix exist (2026-11-25).

## Open

- **Does fix go through the round pipeline?** Proposed: fix hands its commits to the round pipeline's verify, batch,
  gate and merge, as a `--fix-only` round does, rather than building its own.
- **The name.** "Saturation" describes the stop rule, not the work. Offered: trawl, census, comb, prowl. Undecided.
- **Collect's verb.** `fold` or `pool` would keep commands to one syllable; `collect` was the first suggestion.
- **Does sort check each defect with a model?** A cheap read-only job per batch would ask whether it still reproduces
  at `HEAD`. It costs money and keeps fixers from chasing defects already gone. Without it, sort ranks from the
  registry and from what changed since the ledger's commit, and the fixer's `not a defect` verdict does the checking.
- **Where the fix queue lives,** and whether it is a file or a view over the registry and the index.
