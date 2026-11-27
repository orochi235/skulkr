# Handoff

For the next session in skulkr. Written 2026-11-27 ~12:25 local. Check each claim against the tree.

## State

On `main`, pushed except as noted under Loose ends. Updated ~15:10 by skulkr-3d: the sections below this one predate
it, so check run state with `pgrep -f "scour fix"` and `node scripts/fixRunStats.mjs`.

## Next: two builds, in this order

1. **Stack scour fixer branches per area** (Mike's ask through weasel-7a, 2026-11-27; kouhai t-633). The weasel batch
   of 21 scour branches failed almost entirely on collisions between branches from one base (Timeline runs 1–6, two
   adding `flatParentOf`, four changing `onKeysInput`'s signature). In `src/scourFix.mjs`: batch k is fixed on batch
   k-1's branch tip when k-1 applied, not on the run's frozen `commit` (today every batch cuts from `commit` in one
   frozen worktree; how the tree moves between batches is our call); and a run given no `--on` defaults to the tip of
   the newest unmerged `scour*-<area>-b*` branch (highest run, then batch), falling back to today's base, and names
   its choice in its opening line. Then an area's newest branch holds all its work. **Message weasel-7a when it lands.**
2. **Scour landing** (kouhai t-630; decided 2026-11-27, `docs/scour.md` "Decided"): a fix run lands its verified
   batches on `main` itself through the rounds' batch, gate and merge, by default; an option marks them ready and
   leaves them for the repository's own batching. The design is `docs/scour.md`'s "Unbuilt" list under "Building the
   fix stage" (`namesFor(prefix)`, `batchAndTest` told its record and its left-out store). With stacking, a run lands
   only its area's newest branch. Weasel's rounds must stay at parity (`CLAUDE.md` Rules).

The scour branches made before today's batch (`scour1`–`scour11`) are weasel-7a's `batch/2026-11-27-scour`; the
review-first plan in "In flight: the fix queue" below is superseded by item 2.

## Waiting on weasel's batch

- The dashboard's hover cards (`d9c58f4`) are weasel `Tooltip`s anchored by `anchorRect` (weasel `41906fd420`, in
  `batch/2026-11-27-scour`). Until that batch lands and `~/src/weasel` is rebuilt (`npm run build` there, on the
  fleet), the dashboard on :5214 draws the cards at the window's top-left. Then run the dashboard typecheck (fleet),
  and delete weasel's `.worktrees/tooltip-anchor-rect` and its branch.

## In flight: the Timeline and registry fix trial

| Run | Batch | Verdicts | Branch (weasel) | Verify |
|---|---|---|---|---|
| 1 | b6 | 2 fixed | `scour1-ui.components.Timeline-b6` | passed |
| 2 | b1–b3 | 17 fixed, 6 not a defect | `scour2-ui.components.Timeline-b1..b3` | passed |
| 3 | b4 | D13 D12 D30 fixed; D37 D22 D27 D38 not fixed | `scour3-ui.components.Timeline-b4` | passed by hand on the fleet, browser tests not run |
| 4 | registry b1 | all 7 fixed | `scour4-registry-b1` (9 commits; 2 answer no defect) | passed |
| 5 | b5 | 7 fixed | `scour5-ui.components.Timeline-b5` (based on main `1f25c27a41`) | passed |
| 6 | b4 rerun: D37 D22 D27 D38, `--on scour3-…-b4` | 3 fixed, 1 not a defect | `scour6-ui.components.Timeline-b4` | passed |

## In flight: the fix queue, two lanes (unattended)

- **Done:** run 7 `core.core.viewport` (27 fixed, $6.36) and run 8 `routing.interactions` (21 fixed, 9 not a defect,
  every verify passed, $7.06); branches `scour7-*`, `scour8-*` in weasel.
- **Running side by side** since 2026-11-27 ~12:09: run 9 `forge.vite.part2` (8 batches, started by
  `.playwright-mcp/fix-chain2.sh`) and run 10 `routing.tools` (4 batches, started by hand). Logs
  `.playwright-mcp/logs/fix-<area>.log`.
- **The fix queue drains the rest:** `skulkr scour fix --queue --lanes 2` (pid in `pgrep -f "fix --queue"`, log
  `.playwright-mcp/logs/fix-queue.log`) starts the next queued area whenever under two fix runs are live; queued:
  `core.canvas.nodeShapes`, `core.canvas.part4`, `core.canvas.SceneCanvas.part2`. Their logs:
  `~/.local/state/weasel-skulkr/scour/fix-<area>.log`. `skulkr scour queue ls|add|drop` (with
  `--config examples/weasel.config.mjs`, from `~/src/weasel`) reads and edits it. The user asked for "a few more hours so
  there's always one running" and then to "try two fix rounds in parallel"; add areas when the queue runs low. Areas were
  my pick: deeply scoured, low next-new. `core.animation` is skipped while weasel-7a's `coast-on-glide` branch overlaps it.
- **The parallel trial's comparison:** `node scripts/fixRunStats.mjs` (per run: wall, overlap, per-batch, fixer and
  verify minutes, $/fixed; `--json` per batch). One at a time, runs 7–8 took ~15 min a batch (fixer ~10, verify ~5–6).
  Machine load each minute in `.playwright-mcp/logs/load.tsv` from `.playwright-mcp/sampleLoad.sh` (stops itself after
  8 h); load was already ~20 before the second lane started, and no serial-time load was recorded. Report the
  comparison once runs 9 and 10 end.
- ⚠️ Batches split past eight defects can share a file and each branches from `main`, so pairs may conflict at landing.
- **Then:** the user reviews all `scour<N>-*` branches in weasel and the `tile-charts` port
  (`~/src/weasel/.worktrees/tile-charts`, unpushed); landing is built only after that review.

## Next to build

Built 2026-11-27, this session: the fix queue and the Scour queue's Delve | Fix switch (docs/scour.md "Fix queue"),
atomic fix-run numbers, `scripts/fixRunStats.mjs`, map lenses "defects fixed", "per 1,000 lines" and "hours since a fix
run", the topbar's "N defects found · M fixed", hover callouts on the live runs' tiles, and each fix batch's phase
(fixing, verifying on fleet with the fleet's test count, repairing), the fixer's test and check tallies, and stage
counts on the live stat row. The dashboard is on blits 1.7.0 to match weasel; vite's dep cache had to be cleared
(`rm -rf dashboard/node_modules/.vite`, `emilia restart skulkr/dashboard`). Earlier: per-defect stages, the fixer's reason on non-fixed
verdicts, weasel's verify through `onto adapt vitest`. Run 9 is the first on that code: watch its shelf through a
repair to confirm laid defects read right.

## Decisions made in conversation (2026-11-26/27)

- No fleet job may fall back to the controller: `on-fleet` now retries 3× then fails (`92dfdc1`). A stream of test runs
  goes to the fleet; one short file locally on a quiet machine is fine.
- One shared headless Chrome for every session (launchd `tech.michaelbaker.shared-chrome`, CDP 127.0.0.1:9222); a
  separate browser needs a reason the user accepts.
- Handoff nudge at 200k, pressing at 300k (claude-handoff 0.3.0); statusline yellow 200k, red 300k.
- After fixing one bad record, sweep its siblings and check the page yourself (memory).

## Token audit

`scripts/tokenAudit.mjs` (since 11-24): interactive sessions $727 vs all jobs $344; 75% of session spend was turns over
200k context. Raw records in `.playwright-mcp/audit/` (gitignored; delete when done).

## Loose ends

- Unpushed: claude-handoff `c2c1671`; chezmoi (personal) `8ce3256`, `fc94d29`, `e35de4f`, `bae82c6`.
- onto's 3-second git probe under load (weasel-cd was fixing onto; `docs/TODO.md` P1).
- Dashboard dev server: emilia `skulkr/dashboard` on :5214.
