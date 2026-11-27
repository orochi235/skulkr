# Handoff

For the next session in skulkr. Written 2026-11-27 ~00:40 local by `skulkr-03`. Check each claim against the tree.

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
| 6 | b4 rerun: D37 D22 D27 D38, `--on scour3-…-b4` | waiting | — | — |

- **Run 6 (pid 81426, detached)** hit the usage limit and waits to retry after 2026-11-27T06:40Z. Its log line says
  "over 0 files": `defectsBatchOf` (`src/scourFix.mjs`, `b2e5171`) unions `d.files`, which planned defects apparently
  lack. Check and fix (union the plan batch's `files` filtered to these defects, or `filesOf` per defect) before
  trusting run 6's staging. Log: `.playwright-mcp/logs/fix-timeline-b4r.log`.
- Runs 3 and 4's records were filled in by hand: both fixers were killed at the 45-minute limit (`docs/TODO.md` P1).
- **Next:** the user reviews all `scour<N>-*` branches in weasel and the `tile-charts` port
  (`~/src/weasel/.worktrees/tile-charts`, unpushed); landing is built only after that review.

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
