# Handoff

For the next session in skulkr. Written 2026-11-27 ~11:20 local. Check each claim against the tree.

## State

On `main`, pushed except as noted under Loose ends.

## In flight: the Timeline and registry fix trial

| Run | Batch | Verdicts | Branch (weasel) | Verify |
|---|---|---|---|---|
| 1 | b6 | 2 fixed | `scour1-ui.components.Timeline-b6` | passed |
| 2 | b1–b3 | 17 fixed, 6 not a defect | `scour2-ui.components.Timeline-b1..b3` | passed |
| 3 | b4 | D13 D12 D30 fixed; D37 D22 D27 D38 not fixed | `scour3-ui.components.Timeline-b4` | passed by hand on the fleet, browser tests not run |
| 4 | registry b1 | all 7 fixed | `scour4-registry-b1` (9 commits; 2 answer no defect) | passed |
| 5 | b5 | 7 fixed | `scour5-ui.components.Timeline-b5` (based on main `1f25c27a41`) | passed |
| 6 | b4 rerun: D37 D22 D27 D38, `--on scour3-…-b4` | 3 fixed, 1 not a defect | `scour6-ui.components.Timeline-b4` | passed |

## In flight: fix runs 8–9 (unattended)

- **Run 7, `core.core.viewport`: done.** All 27 fixed, every verify passed, $6.36; `scour7-core.core.viewport-b1..b4`.
- **Run 8, `routing.interactions`** (5 batches, pid 66169) is running; then **`forge.vite.part2`** (8 batches).
  `fix-chain.sh`'s shell died mid-run, so `.playwright-mcp/fix-chain2.sh` (`pgrep -f fix-chain2`) waits for pid 66169
  and starts forge; logs `logs/fix-chain.log`, `logs/fix-<area>.log`. b1: 8 fixed, verify passed, $2.18. b2: 6 fixed,
  2 not a defect, one repair, verify passed, $2.06. Report each run's outcome to the user when it ends. The areas were my pick after viewport, at the user's "start another, and another".
- **Then `routing.tools`, `core.canvas.nodeShapes`, `core.canvas.part4`**, queued 2026-11-27 12:10 at the user's "keep
  the fixes rolling for a few more hours so there's always one running": `.playwright-mcp/fix-chain3.sh`
  (`pgrep -f fix-chain3`) waits for fix-chain2 and runs them in turn; `touch .playwright-mcp/logs/stop-chain` stops it
  before the next area starts. `core.animation` was skipped: its coast files overlap weasel-7a's pending
  `coast-on-glide` branch.
- ⚠️ Batches split past eight defects can share a file (routing b1/b2 share `elementAt.ts`; forge b2/b3 share
  `plugin.ts`), and each branches from `main`, so those pairs may conflict at landing.
- Runs 3 and 4's records were filled in by hand: both fixers were killed at the 45-minute limit (`docs/TODO.md` P1).
- **Then:** the user reviews all `scour<N>-*` branches in weasel and the `tile-charts` port
  (`~/src/weasel/.worktrees/tile-charts`, unpushed); landing is built only after that review.

## Next to build

1. **A "defects fixed" map metric** on the Scour page: `saturationFixed` in `dashboard/src/audits/heatMetrics.ts`
   (`SATURATION_METRICS`), counting defects `isFixSettled` on the ledger's fix shelf, maybe with a per-kloc twin.
   Proposed, not yet confirmed as wanted.

Built 2026-11-27: per-defect stages (`8ae7440`, docs/scour.md "Each defect's own stage"), the fixer's reason on
non-fixed verdicts (`75222a7`), weasel's verify through `onto adapt vitest` (`f9b7a6c`). The first run to show
trailers, reasons asked for, and onto's test-count bar is `forge.vite.part2`, since run 8's process loaded the
older code; watch its shelf through a repair to confirm the laid defects read right.

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
