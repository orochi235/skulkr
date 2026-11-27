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
- **Run 8, `routing.interactions`** (5 batches) is running; then **`forge.vite.part2`** (8 batches), chained by
  `.playwright-mcp/fix-chain.sh` (`pgrep -f fix-chain.sh`; `logs/fix-chain.log`, `logs/fix-<area>.log`). b1 all fixed,
  verify passed. b2's verify failed one file, `packages/editing/src/integration/core/canvas/SceneCanvas/kitActionParams.test.tsx`
  ("state no number outside a params leaf that the allowlist does not explain"), and is in repair. Report each run's
  outcome to the user when it ends. The areas were my pick after viewport, at the user's "start another, and another".
- ⚠️ Batches split past eight defects can share a file (routing b1/b2 share `elementAt.ts`; forge b2/b3 share
  `plugin.ts`), and each branches from `main`, so those pairs may conflict at landing.
- Runs 3 and 4's records were filled in by hand: both fixers were killed at the 45-minute limit (`docs/TODO.md` P1).
- **Then:** the user reviews all `scour<N>-*` branches in weasel and the `tile-charts` port
  (`~/src/weasel/.worktrees/tile-charts`, unpushed); landing is built only after that review.

## Next to build (approved 2026-11-27, "go")

1. **Each defect's own stage on the fix shelf, through verify and repair**, not the batch's. Today
   `fixStagesIn` (`src/scourFixStage.mjs`) paints every defect `checking` or `repairing` while its batch verifies or
   repairs, and fixer commits name no defect. Design the user approved:
   - `scour fix` adds to the fixer's prompt (not the shared `fixer.md`, so rounds stay at parity): end each commit
     message with a `Defect: D12` trailer, several ids for a commit covering several. A commit without one falls back
     to today's reading.
   - `stagesFromFixLog` reads stages from those commits rather than guessing from `says:` lines.
   - During verify, a committed defect is `checking`; one the fixer left uncommitted keeps its own stage.
   - During repair, the failing test files are laid at the commits whose changed files they import or sit beside,
     by extending weasel's `gate.blame` hook (in `examples/weasel`) to answer commits as well as branches; only those
     commits' defects show `repairing`, the rest `checking`; no match falls back to the whole batch. Path-only matching
     would miss today's case (an `editing/` test failing for `routing/` commits), hence the hook.
2. **A "defects fixed" map metric** on the Scour page: `saturationFixed` in `dashboard/src/audits/heatMetrics.ts`
   (`SATURATION_METRICS`), counting defects `isFixSettled` on the ledger's fix shelf, maybe with a per-kloc twin. The
   user asked whether it could be one; I said yes and proposed this, not yet confirmed as wanted.
3. Add the verify-line wording change (`7ba18db`: tests, files, affected) to `CLAUDE.md`'s parity list; no reader
   parses past `passed`/`failed` (`src/nightLog.mjs`), so nothing else changes.

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
