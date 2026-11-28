# Handoff

For the next session in skulkr. Updated 2026-11-27 ~21:00 local. Check each claim against the tree.

## State

On `main`; unpushed commits: `git log --oneline @{u}..HEAD`. Live jobs: `pgrep -fl "skulkr.mjs scour"`; per-run
step times `node scripts/fixRunStats.mjs`; cost per defect by batch size `skulkr scour batches`.
Commit each verified change on `main` without asking (Mike, 2026-11-27).

## Running now (2026-11-27 ~21:00 local, all local mode)

| What | Log |
|---|---|
| Done: `scour run geom.paths.part1 geom.paths.part2`; part2 stopped at pass 19/40, 23 distinct, next defect ≈ $1.97 over the $1.97 limit | `.playwright-mcp/logs/delve-geom.paths.log` |
| Delves `scour run select parallax` (pid 53754), uncapped, started 2026-11-27 ~23:30 | `.playwright-mcp/logs/delve-select-parallax.log` |
| Fix run 17 `routing.interactions.dispatcher` (pid 29085), 7 batches, started on weasel `main` `ce4c8b3c9b` | `.playwright-mcp/logs/fix-routing.interactions.dispatcher.log` |

Watch each with Monitor (`tail -F … | grep -E "^(record|preflight|gate|main|land|capstone|batch):|rror|failed|^[0-9]+/[0-9]+ |stopped"`),
30-minute expiry; the last session's watchers died with it.

Fix run 14 relanded: weasel `main` fast-forwarded to `d7ad6e6c8b`. The dispatcher's `--deep` delve has finished
(report at `<state>/scour/routing.interactions.dispatcher/report.md`).

Both runs were stopped by the usage limit at ~21:00 local and retry on their own after 02:40Z (21:40 local).

**Ledgers to land** (Mike has approved each landing asked so far): `animator.engine`, `animator.timeline`,
`apps.theme-editor.src` and `geom.paths.part1` landed at weasel `fa11f1f06b`; `geom.paths.part2` (stopped at pass
19, 23 distinct, next defect over its limit) at `1408b23ddf`. Still to land: `routing.interactions.dispatcher` (t-657)
once fix run 17 ends, since the run holds its ledger.

**Outline mask:** weasel-63's inflight register shows `outline-mask` ready at `a9a929275f`, awaiting its batch.

The `animator` fix lane never ran: fix run 14's crash killed `fix-lane.sh`'s loop before it reached `animator`.

## This session (2026-11-27 ~20:30–21:00)

- Dashboard: estimates (left, next new, next defect) in sky blue via `--sk-estimate` in `dashboard/src/app.css`,
  no italic; a delve's kloc and files moved into its header before the pid; the live row leads with pass or batch,
  clock second (`44091e9`, `1d867ac`).
- **Outline occlusion** (kouhai t-661): Mike wants the selection outline covered by raised cells in front of it, as a
  weasel feature. weasel-63 owns the build (an agent of its own, in `~/src/weasel/.worktrees/outline-mask`, option
  `outline: { follow: 'shape', mask: true }`) and will message skulkr when it is on weasel `main`. Then set
  `mask: true` in `dashboard/src/audits/Treemap.tsx` `LAYERS.selectionOverlay.outline` and check routing.dispatcher
  over routing.actions on the live map.
- **Batch size** (`b7eb802`): `scour fix --size N` and `scour batches`; docs/scour.md "Whether batching saves" has the
  data so far and the split that would settle it. Running the split waits for Mike's go (docs/TODO.md P3).
- onto: the background agent landed retried timeouts reading as timed out, not failed (onto `7499b5c`, local `main`,
  unpushed); its Swift tests compiled but were not run (`xcodebuild … -scheme Onto test` in `app/`).
- Not typechecked here: the tsc hook refuses a whole-project check on the controller. Run the dashboard's typecheck
  on the fleet, filtering the unreleased-weasel errors noted below.

## Done by skulkr-e0 (2026-11-27 ~19:30–20:00)

- Fix runs 15, 9, 11 and 12 landed by weasel-63 at weasel `88658f8cbe` (gate 47,330 passed), branches deleted.
  Run 15's D11 now reads `not fixed (a repair reverted its fix …)` in the state record and in weasel (`bc4e18359d`);
  t-650 settled.
- Fix run 14's first landing went red on one test, `scripts/lib/fleet-triggers.test.ts` (`spawnSync git ENOBUFS`, the
  same 1 MB `git ls-files` overflow as `045d593f04`), then crashed in `failingOnMain` because the process predated
  `4365d09`. Test fixed on weasel `main` (`bdabff33bb`, now in `88658f8cbe`).
- `skulkr scour fix <area> --land` (`e04d17c`): lands the area's newest fix branch again as the run that made it.
- Fix plans leave out defects the registry records fixed (`889a9fc`, `registryFixedIn`): the dispatcher's plan went
  from 50 defects to 45. Not checked: whether the running dashboard dev server needs `emilia restart skulkr/dashboard`
  to pick it up.
- ❓ kouhai q-655, for Mike: ~128 untracked `*-review-saturation-codex.md` files plus `ingested/` and
  `other-commit/` in `~/src/weasel`. No session claims them; they don't block a fast-forward (only tracked changes do).

## Done this session (2026-11-27 evening)

- Landed 235 ledgers (weasel `8188c702bf`), then `apps.theme-editor` (7 defects, 6 passes) and `text.layout`
  (13 defects, 6 passes) again after the 4× limit.
- `scour land --all` skips ledgers a live scour holds (`01bac8e`); `scour delve --deep` turns off the ready-to-fix stop
  for one delve (`016ad6e`); default per-defect limit back to 4× (`1eeca48`); queue ties broken by known defects per
  kloc, since ~200 areas sit at the opening price after one Codex pass and the queue read alphabetically
  (`1c54106`, after Mike: "numbered upcoming looks broken" — confirm with him that this was what he saw).
- weasel's fixer brief runs `check:size` before any test, and its verify runs it first and stops there
  (`cee22f4`; Mike: catch gate failures like line count before a full suite). Fix runs started before it keep the old
  order. The GUI half of verify is a separate job and does not stop on it.
- Fix readout shows the batch under way as an index, `batch 3/3` (`41f7a16`).

## From skulkr-67's last turns (2026-11-27 ~20:00)

- Fix run 16 (`routing.interactions.dispatcher`) was canceled at Mike's ask; `<state>/scour/fix-16/` is a dead run's
  record. Its delve runs to the cost cap instead (see "Running now").
- `animator`'s delve stops at once: Chao2 puts 2.5 defects unseen (0.60 per kloc, under 1). Mike asked why it is so
  sure; the answer is that it is a point estimate from 5 mostly-Claude passes, a floor, not a bound.
- Prefs button on every page's topbar (`43244c7`); Fix queue says `landing N/N` (`2309e0c`, `2c9ae4e`).

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

- Reviewers weigh defects by how likely ordinary use is to reach them; exotic-script corners (Mandaic missing from an
  RTL table) are `low` or left out — in all reviewer briefs (`5dcdd1d`). No per-area focus key was built.
- `text.layout`'s ledger is kept through that brief change, statistics skew accepted ("not scientifically
  immaculate", Mike, 2026-11-27).
- The live run's clock toggles between the whole run and the newest pass/batch on click (`956262a`); the opening
  price stands in as next defect under two passes (`1082d69`).

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
