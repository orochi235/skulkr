# Handoff

For the next session in skulkr. Written 2026-11-25, evening. Check each claim against the tree before acting on it.

## State

On `main`, pushed (`git log --oneline @{u}..HEAD` shows anything unpushed). The fleet suite passed on the last
commits of the day. Built today, all described in README.md:

- `.skulkr/` as each project's committed audit state: rounds, partition, landed scour ledgers, the defect registry
  (`.skulkr/defects/<area>.jsonl`), and a SQLite index at `.skulkr/cache/skulkr.db` that `skulkr q <sql>` queries.
  weasel's record moved there (weasel `be05bfd59e`); its registry holds every defect of rounds 29–88 and the ledgers.
- The saturation workflow is now called **scour**: `skulkr scour` (aliases `saturate`, `sat`), the dashboard's Scour
  page (`#<tenant>/scour/<area>`) with the audit map, the ledger list and the defect table, picks synced.
- The orochi service (`onto service`, tree `skulkr`) runs current skulkr; re-sync it with `onto sync --in skulkr orochi`
  after changes that matter to rounds.

## Next: plan the scour pipeline, then build it

The user wants to plan the pipeline further before anything is built. The plan is `docs/scour.md`: the stages (pick,
trawl, collect, judge, land, triage, fix, ask, close, compare), what each hands the next, what is decided, what is open.
Its stage table's middle columns (core action, UI, user sees) are the user's own wording; keep them unless asked.

Points the user has not settled, raised in conversation and not all in the doc:

- In the stage table: `ask` reads Implicit but writes "a list for a person to rule on", and its UI cell repeats scan's
  progress bar; `triage` has no UI though it decides what fixers get; `compare`'s "Ambient" is undefined; `land`'s
  "User sees" mixes now ("currently explicit") with intent; `judge` is closer to "configured" than "implicit?".
- Collect's verb: `fold` or `pool` (one syllable) against `collect`.
- Whether triage checks each defect with a model, whether fix goes through the round pipeline (proposed, not decided),
  where the fix plan lives, and whether to rename the `saturation/` paths on disk.

## Decisions made in conversation (2026-11-25)

All are in `docs/scour.md` "Decided" or README.md except these:

- Landing ledgers and moving weasel's record pushes weasel's `main`; both were done with the user's go-ahead. Pushing
  weasel needs that each time.
- Saturation defects found only by a scour are never handed to a round's fixer until triage and fix exist.

## Loose ends

- `skulkr sat core.canvas.nodeShapes` (pid 49951, started 08:08) hung on the slot bug fixed in `f4c5c78` and holds that
  ledger's lock; its 6 defects are unlanded. The user has not said whether to kill it. Read the pid back with
  `ps -p 49951 -o lstart,command` before acting.
- weasel's root still holds `review-saturation-tracker.xlsx`, `viewport-review-saturation.md` and
  `viewport-review-saturation-codex.md`, untracked; the last holds the only copy of that Codex report. The user has not
  said what to do with them. The other root saturation files are in `~/.Trash/weasel-saturation-root-2026-11-25/`.
- A stray onto tree `skulkr-weasel` on orochi, made by a mistaken sync, is unused.
- kouhai's ledger still holds older open work for this repo (`owed`): t-543, t-545, t-546, t-547.

## Traps

- **onto syncs a job's tree by `git ls-files`**, which leaves ignored files behind. `.skulkr/in/` and `.skulkr/out/`
  (a job's scratch) must never be gitignored, or every job loses its inputs; `.skulkr/.gitignore` ignores `cache/` only.
- **A test that hardcodes `docs/audits/`** now fails, since `record.dir` defaults to `.skulkr`. Build paths from
  `cfg.record.dir`.
- **The macOS filesystem is case-insensitive**: `pages.tsx` and `Pages.tsx` are one file.
- **The dev server misses edits when `fseventsd` wedges**; `dashboard/server/plugin.ts` changes need a dev-server restart.
- `git.push` defaults to true outside local mode: a green round, a scour landing and the record move all push the
  project's `main`.
