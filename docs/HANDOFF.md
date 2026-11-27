# Handoff

For the next session in skulkr. Rewritten 2026-11-27 ~18:30 local. Check each claim against the tree.

## State

On `main`, pushed. Live jobs: `pgrep -fl "scour fix|scour delve|fix-lane"`; per-run figures `node scripts/fixRunStats.mjs`.
Commit each verified change on `main` without asking (Mike, 2026-11-27).

## Running now (started 2026-11-27 ~18:13 local, all local mode)

| What | Started by | Log |
|---|---|---|
| Fix run 14 `animator.engine` (3 batches), then `animator` (2 batches) | `.playwright-mcp/fix-lane.sh animator-a …` | `.playwright-mcp/logs/fix-<area>.log`, lane in `fix-animator-a.log` |
| Fix run 15 `animator.timeline` (2 batches) | `.playwright-mcp/fix-lane.sh animator-b …` | same, `fix-animator-b.log` |
| Delve `text.layout` (31 files, no `--max`: runs to the stop rule) | `nohup … scour delve text.layout` | `.playwright-mcp/logs/delve-text.layout.log` |

`animator` and `animator.engine` share `createHostedAnimator.ts`, `engine/animatorApi.ts` and `engine/core.ts`, so
they run one after the other: each fix run lands on weasel's `main` when its batches end (stacking + landing,
`docs/scour.md` "Landing"), and the next starts from the landed tip. Report each landing to Mike (did `main`
fast-forward, did `.skulkr/scour/fix-<N>/` land, were `scour<N>-*` deleted).

Fix run 13 (`core.canvas.SceneCanvas.part2`) was the first scour landing: `main` fast-forwarded to `471ca1528c` and
pushed, record committed, branches deleted (kouhai t-635, settled).

## Waiting on Mike's go: landing fix runs 9, 11, 12

Runs 1–8 and 10 landed in weasel-7a's hand batch `batch/2026-11-27-scour`. Runs 9 (`forge.vite.part2`, b1–b8),
11 (`core.canvas.nodeShapes`, b1–b3) and 12 (`core.canvas.part4`, b1–b4) finished before landing existed; their
`scour<N>-*` branches sit in weasel, each cut from `main` on its own (pre-stacking), so the newest holds only its own
batch. Nothing lands a finished fix run. Proposed (not built): `skulkr scour fix <area> --land`, which runs no
batches and lands the area's unlanded verified branches: the newest alone when it holds the rest (`landFixBranch`),
else all of them as one `batchAndTest` with conflict repair, gate and capstone, one mbox per branch. It pushes weasel's
`main` per area, so it needs his go to build and to run; conflict repairs are local Claude jobs.

## In flight and queued (2026-11-27 evening)

- **A background agent is building `saturate.priceBy: 'defect' | 'kloc'`** (`--price-by`): the delve price gate in
  dollars per defect-per-kloc (`usd × lines / 1000`), going rate and opening price in the same unit, the unit named
  wherever a price shows, `priceBy` on `ls --json`, the dashboard's amber next defect in the same unit. Default
  `defect`. It commits on `main` without pushing. While it edits `src/`, the dashboard's `api/t/weasel/saturation`
  can 500. If the session that spawned it is gone, check `git log` and `git status` for its work.
- **t-648 #opening-price-before-two-passes:** the delve row's "next defect" shows the opening price (lighter, a tooltip
  saying so) until the area's own price exists at two passes; needs an opening-price field in `saturationList.mjs`.
- **t-649 #live-log-job-lines:** the live run's log box shows only the run's milestones (a fix run's says nothing for
  a whole batch). Interleave each running job's `skulkr:` lines (commits, says, findings, verifying, on fleet) into
  it, timed, newest first, a few more lines shown. The job's latest line is already on `running.jobs[].line`.

## Dashboard, this session (`0a2855f`, `71053f7`, `b5e5d82`, `2f00e57`, `c654dc3`, `d94027c`)

Invert ramp checkbox (`map.invert`), the queue's place column fitted to its digits, batch pills reading `batch 1`, a
live fix run's zero counts hidden and its counts barred in the fix shelf's colors (`tileClassOf`), a live delve's
`pass N` with its cap in the tooltip, and next defect amber past the limit (`nextDefectStatOf`). The dashboard's
`npm run typecheck` on the fleet fails only on unreleased weasel (`LiveQuantity`, `anchorRect`, `relative`,
`instant`, `Reading`); filter those out when checking.

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
