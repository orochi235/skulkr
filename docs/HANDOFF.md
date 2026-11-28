# Handoff

For the next session in skulkr. Updated 2026-11-27 ~20:00 local by skulkr-e0. Check each claim against the tree.

## State

On `main`, pushed. Live jobs: `pgrep -fl "scour fix|scour delve|fix-lane"`; per-run figures `node scripts/fixRunStats.mjs`.
Commit each verified change on `main` without asking (Mike, 2026-11-27).

## Running now (2026-11-27 ~20:00 local, all local mode)

| What | Log |
|---|---|
| Fix run 14 `animator.engine` landing again via `skulkr scour fix animator.engine --land` (record at `3bda036a44` on `batch/2026-11-28-scour14`, onto weasel `main` `88658f8cbe`) | `.playwright-mcp/logs/fix-animator.engine.reland.log` |
| `scour run geom.paths.part1 geom.paths.part2`: part1 stopped; part2 at pass 6, 10 distinct | `.playwright-mcp/logs/delve-geom.paths.log` |
| `scour delve routing.interactions.dispatcher --deep` (Mike: delve to the cost cap; pid 53571), pass 32/40, 50 distinct | `.playwright-mcp/logs/delve-routing.interactions.dispatcher.log` |

Watch each with Monitor (`tail -F … | grep -E "^(record|preflight|gate|main|land|capstone):|rror|failed|^[0-9]+/[0-9]+ |stopped"`),
30-minute expiry. weasel-63 holds off `main` until told fix run 14 has landed: message it either way.

When fix run 14 lands, report to Mike: did `main` fast-forward, did `.skulkr/scour/fix-14/` land, were `scour14-*`
and `batch/2026-11-28-scour14` deleted. If it goes red, triage with `failingOnMain` in the log before anything else.
Then land ledgers: `skulkr scour land animator.engine animator.timeline` (kouhai t-652); `apps.theme-editor.src`
(stopped at pass 14, 20 defects) with `geom.paths.part2` when that delve stops; `routing.interactions.dispatcher` when
its delve stops (kouhai t-657). Mike has approved each ledger landing asked so far.

The `animator` fix lane never ran: fix run 14's crash killed `fix-lane.sh`'s loop before it reached `animator`.

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
