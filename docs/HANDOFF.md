# Handoff

For the next session in skulkr. Updated 2026-11-27 ~19:40 local. Check each claim against the tree.

## State

On `main`, pushed. Live jobs: `pgrep -fl "scour fix|scour delve|fix-lane"`; per-run figures `node scripts/fixRunStats.mjs`.
Commit each verified change on `main` without asking (Mike, 2026-11-27).

## Running now (2026-11-27 ~19:40 local, all local mode)

| What | Log |
|---|---|
| Fix run 14 `animator.engine` batch 3 of 3, then the lane starts `animator` (2 batches) | `.playwright-mcp/logs/fix-animator.engine.log`, lane in `fix-animator-a.log` |
| Delve `apps.theme-editor.src` (resumed from 13 passes at `9c4522d635`) | `.playwright-mcp/logs/delve-apps.theme-editor.src.log` |
| `scour run geom.paths.part1 geom.paths.part2` (Mike: "delve the rest of geom.paths in order"; part1 already stopped, part2 delving from 1 pass) | `.playwright-mcp/logs/delve-geom.paths.log` |

Re-arm watches under Monitor (30-minute expiry): `.playwright-mcp/stallwatch.sh 14 animator.engine`, and a
`tail -F … | grep -E "^[0-9]+/[0-9]+ |stopped|rror|failed"` on the delve log. Judge a stall by output growth, not time
(memory `in-flight-is-not-almost-done`). Report fix run 14's landing to Mike: did `main` fast-forward, did
`.skulkr/scour/fix-14/` land, were `scour14-*` deleted. Then land its ledger and `animator.timeline`'s
(`skulkr scour land animator.engine animator.timeline`; kouhai t-652). Land `apps.theme-editor.src` and `geom.paths.part2` when their delves stop.

## Handed to weasel-63: merging what's ready (Mike, 2026-11-27)

Mike: "work with weasel-63 to merge whatever's ready to main". I sent weasel-63 the list and proposed it batch, gate
and fast-forward these, taking skulkr's merge lock (`<state>/merge.lock`) and leaving `scour14-*` alone:

- Fix run 15 `animator.timeline`: `batch/2026-11-28-scour15` = `scour15-animator.timeline-b2` (stacks b1) plus the
  record commit. skulkr's own landing crashed: its preflight failed only on `check:test-projects` (`git ls-files` past
  1 MB after the 235-ledger landing; fixed on weasel `main` as `045d593f04`), then `failingOnMain` hit an undefined
  `ctx.root` (fixed, `4365d09`). Still owed: kouhai t-650, run 15's D11 recorded fixed though a repair reverted it.
- Fix runs 9, 11, 12: every `scour<N>-*` branch (pre-stacking, each holds only its own batch; no record commits).

Nothing has come back from weasel-63 yet. Check `git -C ~/src/weasel branch --list 'scour*' 'batch/*'` against
`main` before redoing any of it; the proposed `skulkr scour fix <area> --land` stays unbuilt.

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
