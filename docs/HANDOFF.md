# Handoff

For the next session in skulkr. Written 2026-11-26, late evening, by `skulkr-f8`. Check each claim against the tree
before acting on it.

## State

On `main`. This session's commits are unpushed: `git log --oneline @{u}..HEAD` lists them. They are all Scour-page
dashboard work plus `skulkr scour flag`; tests pass file by file and both packages typecheck on the fleet, but the full
suite has not run on them (`onto test`).

Built this session (the code and `docs/TODO.md` say how each works):

- **Fix shelf**: each tile shows its fix stage while its batch is out (analyzing, writing, written, checking in cyan,
  repairing), read from the batch's job logs (`src/scourFixStage.mjs`). Done batches merge into one `done` group; a
  batch/status switch at the box's right edge, and by status the batches dissolve into one run.
- **`skulkr scour flag <area> <ids…> [--clear]`** (`src/scourFlags.mjs`): a `flagged` status (magenta) a person sets
  over a fix run's verdict, kept in `<state>/scour/flags.json`. Nothing is flagged now.
- **Ledger panel**: title over a boxed hero (counts, then next new / next defect / limit), a Yield grid (found, fixed,
  left, spent × area / kloc / pass), Scope & effort (with `last flush`, the area's latest fix run), the stop-rule status
  boxed over the fix plan, and a color legend box that shows only while it fits (`useFitsInRow.ts`). Defects table
  grouped Unresolved / Resolved; a hover callout for any tile (`DefectCallout.tsx`); a checkbox that collapses fully
  fixed passes from the delve chart.
- **Live box** (top of the page): one row, elapsed → passes (cap in a tooltip) → found → next new → next defect → limit
  → spent; pass pills beside the area name. The map outlines an area a fix run holds (`fix` phase).

## In flight

### The Timeline fix trial

**Fix run 2 died during batch 4** (killed when `skulkr-9e`, whose shell it ran under, was closed). Its record is marked
finished with a `stopped` note; its frozen worktree is removed. Batches 1–3 are recorded:

| Batch | Fixed | Not a defect | Repairs | Cost | Branch |
|---|---:|---:|---:|---:|---|
| 1 | 7 | 1 | 0 | $2.92 | `scour2-ui.components.Timeline-b1` |
| 2 | 6 | 2 | 0 | $2.22 | `scour2-ui.components.Timeline-b2` |
| 3 | 4 | 3 | 0 | $2.05 | `scour2-ui.components.Timeline-b3` |
| 6 (run 1) | 2 | 0 | 1 | $1.44 | `scour1-ui.components.Timeline-b6` |

**Next:** run batches 4 and 5 **detached**, so closing a session cannot kill them again:
`nohup node bin/skulkr.mjs scour fix --tenant weasel ui.components.Timeline --batch 4,5 > <scratch>/fix-run3.log 2>&1 &`
(local claude as this account; verify goes to the fleet). Then report all batches, and have the user review the
`scour<N>-ui.components.Timeline-b*` branches in weasel. **Landing is built only after that review.**

The six "not a defect" verdicts: D31, D20, D15, D11, D9, D10. Four carried "(no longer applies)", which is wrong — only
one unrelated commit touched `Timeline/` between the ledger and fix commits — but checked by hand (2026-11-26) the
verdicts hold: D9/D10/D11's tests were added in b3's first commit, before any drag change, and pass on `main`'s code;
D20's selection already follows a re-sorted key through `onLayerChange` (`LaneGraph.tsx` line 95 at `568f19b0a5`).
They were flagged, then unflagged. D31 and D15 were not re-checked.

### The weasel port (approved 2026-11-26, built)

Branch `tile-charts` in `/Users/mike/src/weasel/.worktrees/tile-charts`, unpushed: `IsoTile`, `TileStacks`,
`TileShelf` and `StatRow` in `@weasel-js/ui`, with stories, tests, two minor changesets (weasel wants one change per
changeset), fleet typecheck and lint green. The 2.5D map was left out at the user's word. Next: the user reviews it;
switching the dashboard to these needs a weasel release, or a local-checkout switch in the dashboard's vite config like
klieg's `WEASEL=<checkout>` (none exists yet).

### Delves

The user asked to start a delve to see it render. geom.paths.part1, renderer.draw and gestures had already met their
stop rules (kouhai t-611 and t-612 settled); diagram-elk is `ready to fix`. **diagram.part1** was running (pass 9,
about $9) as this session's background child and dies with it. Resume it detached if wanted:
`nohup node bin/skulkr.mjs scour delve --tenant weasel diagram.part1 > <scratch>/delve.log 2>&1 &`. kouhai t-610 owes
the rest of its list (renderer.part1, geom.paths.part2, geom.part1, labkit.annotations).

## Pick up from the closed sessions

- `skulkr-9e` (transcript `1e694fc5…`): nothing unfinished beyond fix run 2, above.
- **"Skulkr scour pipeline planning"** shared this directory and is gone. Read the tail of its transcript in
  `~/.claude-pw/projects/-Users-mike-src-skulkr/` (most likely `a6ae807e…`, last written 22:12) for anything it left
  unfinished, and check `git status` for stray edits of its.

## Decisions made in conversation (2026-11-26), not in docs

- "Flush" is the user's word for a fix run.
- `flagged` means a fix run's verdict is in doubt, not that the code is known broken; check by hand before sending one
  back to a fixer (another pass with the same inputs likely repeats the verdict).
- Fix batches should be planned for parallelism (kouhai t-623): batches sharing no files run at once; overlapping ones
  run in order, each on the previous batch's branch, so landing meets no conflicts. Timeline gains nothing: batches 1–5
  all edit `LaneGraph.tsx`. Not built.
- Fix runs stop at verified branches until the user has reviewed the trial's diffs; landing comes after.
- Non-model jobs (verify, checks, typecheck) go to the fleet; model jobs run locally.

## Loose ends

- The dashboard dev server died with `skulkr-9e`. Restart it from `dashboard/` with `emilia up dev`.
- A live fix run's ledger lease vanished mid-run (`docs/TODO.md`, P2); this session rewrote it by hand, then removed it
  once the run was dead.
- weasel's root holds 235 untracked Codex reports plus `ingested/` and `other-commit/`, all already in ledgers; the user
  has not said to delete them.
- orochi's service may start weasel rounds if it registers weasel writable; its `tenants.json` was never read.
- Unpushed elsewhere: transom `1ec7f5c`, chezmoi `de3dc5f`.

## Traps

- **A job started from a session dies with it.** Background Bash and child processes go when the session closes; use
  `nohup … &` for anything that must outlive the session.
- weasel's `node_modules` can lag its lockfile; the dashboard then fails on a missing export. `npm install` in weasel,
  restart vite with `--force`.
- `checksOnFleet` keys on `cfg.runner === 'local'`; scour's local paths must say so.
- onto syncs a job's tree by `git ls-files`: `.skulkr/in/` and `.skulkr/out/` must never be gitignored.
- `git.push` defaults to true outside local mode: a green round or scour landing pushes the project's `main`.
- Playwright pages go stale across vite edits: reload with a fresh query (`?r=N`) before trusting a screenshot.
