# `.skulkr/`: each project's audit state, in the project

**Status: designed 2026-11-25, nothing built.** This is a plan, not a description of skulkr. Until a phase below is
marked built, the README describes what runs.

For whoever builds this, and for anyone deciding whether skulkr should keep its state this way. It answers where a
project's audit history lives, and how one defect is followed from the review that found it to the commit that fixed
it.

## Decided

- Every project keeps its skulkr state in a committed `.skulkr/` at its root (2026-11-25).
- One **defect registry** holds every defect, whether a round's reviewers found it or a saturation review did, under one
  id space (2026-11-25).
- `docs/audits/` moves into `.skulkr/` whole. The round READMEs become views rendered from the records, as a saturation
  ledger's `report.md` already is (2026-11-25).
- The committed files are text, one record per line where they are lists, so a landing is a diff and two branches
  touching different areas merge. A SQLite index built from them, ignored by git, answers queries (2026-11-25).
- Machine state stays in `~/.local/state/<project>-skulkr/`: locks, slots, job trees, logs, live runs, and a ledger
  while it is being written (2026-11-25).

## Layout

```
.skulkr/
  config.mjs                      the project's config (skulkr.config.mjs at the root is still read)
  partition.json                  the areas and their files
  defects/<area>.jsonl            the registry: one defect per line, sorted by id
  rounds/<N>/README.md            rendered from the files beside it
  rounds/<N>/<area>/              A.md, B.md, match.json, fix.md, area.json, files.txt, as now
  rounds/<N>/usage.jsonl          one record per job, as now
  saturation/<area>/<commit>/     ledger.json, report.md, reviews/, as `saturate land` writes them now
  .gitignore                      cache/
  cache/skulkr.db                 the index; never edited, rebuilt when stale
```

A defect is filed under the area that holds the files it cites today, so a recut moves its line to another file, as
open findings already move with their cited paths.

## The registry

One JSON object per line:

| Field | Holds |
|---|---|
| `id` | `d-` and 8 hex of a hash of its first sighting (where it was seen, and its claim): stable, and allocated with no counter, so parallel area branches never collide |
| `claim`, `where`, `files`, `severity` | as the first sighting gave them; `files` the repository paths `where` cites |
| `sightings` | each report that named it: `{ round, area, reviewer }` for a round's A or B, `{ ledger: '<area>@<commit10>', occasion, source }` for a saturation occasion |
| `status` | `open`, `fixed`, `dismissed` or `question` |
| `resolved` | for any status but `open`: `{ sha, round?, by }`, the commit and the job (fixer, repair, hand) that changed it |
| `first` | the commit and date of its first sighting |

Who writes it:

| Event | Change |
|---|---|
| A round's match | each distinct finding becomes a sighting of a registry defect (one the area's open defects already hold, else a new one) |
| A fixer's `fix.md` | the verdict on each finding sets its defect's `status` and `resolved` |
| `saturate ingest` and `saturate <area>` | the ledger matcher's new defects get registry ids; its sightings add to theirs |
| `saturate land` | writes the ledger and the registry lines it touched in one commit |

A round's match already compares the two reviewers' lists. Linking a finding to an *open* registry defect is the step
carry does today, when it hands a fixer the area's open findings, and it moves onto the registry. A finding is linked to
a saturation defect by the ledger matcher, on the occasions a round reviews an area that has a ledger with open defects.

## The index

`cache/skulkr.db`, from `node:sqlite` (built into Node, no dependency). Tables for areas, files, defects, sightings,
rounds, passes (a round's area, with its `area.json` figures), jobs (`usage.jsonl`), and saturation occasions. It is
rebuilt whenever `git rev-parse HEAD:.skulkr` or the `.skulkr/` working tree's status differs from what it was built
from, so it is never newer or older than the files. `skulkr map`, `saturate ls`, and the dashboard read it; a new
`skulkr q <sql>` runs a query against it.

## Phases

Each phase leaves weasel working, and each adds an entry to CLAUDE.md's parity list.

| Phase | Builds | Model cost |
|---|---|---|
| 1. Move | `record.dir` defaults to `.skulkr`, with `rounds/` under it; the partition, the saturation ledgers and the config looked for there. weasel: `git mv docs/audits/{round-*,partition.json,saturation} .skulkr/`, leaving `docs/audits/`'s two hand-written documents where they are | none |
| 2. Registry, going forward | the writers in the table above; `fix.md` verdicts read into statuses | none beyond today's matcher |
| 3. Backfill | rounds 29–88: 627 area passes, 4,200 distinct findings (counted from weasel's `area.json` files), into the registry from their `match.json` and `fix.md`, with no model; then the saturation ledgers linked to the round findings that could be the same defect | see below |
| 4. Index | the SQLite build, `skulkr q`, and `map`, `saturate ls` and the dashboard reading it | none |

**Backfill cost.** A saturation ledger can share a defect only with a round that reviewed its area at or after its
commit. In weasel that is rounds 86–88, at or after `9c4522d635`, and they reviewed 4 of the 124 ledgers' areas. So
linking needs about 4 to 8 ledger-matcher jobs. The matcher's one measured cost is $0.17 for an occasion of a few
findings against an empty ledger; against a few dozen round findings it will cost more, so about $1–4 in all, an
estimate. Rounds alone need no model: their own match already links A to B, and carry's records already link a carried
finding to the round that fixed it.

## Open

- In weasel, only `docs/hardening.md` names `docs/audits/` outside the record itself; phase 1 updates it.
- The dashboard's snapshot (`npm run snapshot`) writes static files from the CLI; it reads the index once phase 4
  lands, so a snapshot needs the cache built first.
