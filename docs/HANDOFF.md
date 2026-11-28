# Handoff

For the next session in skulkr. Updated 2026-11-28 ~07:30 local. Check each claim against the tree.

## State

On `main`; unpushed commits: `git log --oneline @{u}..HEAD`. Live jobs: `pgrep -fl "skulkr.mjs scour"`; per-run
step times `node scripts/fixRunStats.mjs`; cost per defect by batch size `skulkr scour batches`.
Commit each verified change on `main` without asking (Mike, 2026-11-27).

## Running now (2026-11-28)

The fix queue (log `.playwright-mcp/logs/fix-queue-2.log`, one lane, each run landing): `scale`, then the 20 ready-to-fix
areas never fixed, smallest first, ≈400 defects at ≈$0.31 each. `scour queue ls` shows what is left.
Delves on `prefs-editor`, `simulation`, `labkit.clock` (next in the queue; log `.playwright-mcp/logs/delve-prefs-sim-clock.log`).

Before that: A fresh `scale` delve at weasel `5343c0a1cb` stopped ready to fix after 5 passes: 5 distinct (5.4 per kloc),
unseen ≈ 0.8, next-new 15%, $4.22; landed at weasel `cb221bc44a` (log `.playwright-mcp/logs/delve-scale-2.log`). Before it, `scour land --all` landed 237 ledgers (weasel `5343c0a1cb`, 1325 defects), so the
"Ledgers to land" list below is done.

Before that: The fix queue drained: its last run, fix 23 on `rig`, landed and weasel `main` is at `f30993007a`. Per-area
fix logs are `<state>/scour/fix-<area>.log` (`<state>` = `~/.local/state/weasel-skulkr`).

**Open question:** `rig`'s delve found 11 distinct, but fix 23 batched 9 (D1–D6, D9–D11); D7 and D8 were left out
and I didn't find why. Check `skulkr scour fix rig --dry` and the ledger before re-sending them with `--defects D7,D8`.

Done since 2026-11-27 evening (all local `claude -p`, Mike's account):

| What | Result |
|---|---|
| Fix 17 `routing.interactions.dispatcher` | 47 fixed, 2 not defects, 7 batches, $17.89; weasel `main` → `fa57555d6c` |
| Delves `select`, `parallax` (log `.playwright-mcp/logs/delve-select-parallax.log`) | each ready to fix after 5 passes, 3 distinct |
| Delves `ui.components.Field`, `scale`, `headless`, `rig` (log `.playwright-mcp/logs/delve-field-scale-headless-rig.log`) | all ready to fix after 5 passes: 6, 12, 4, 11 distinct |
| Fix 18 `select`, 19 `parallax`, 20 `ui.components.Field` | all fixed, each landed (weasel `main` → `bb201046c7` after 20) |
| Fix 21 `scale` | 12 fixed in 2 batches, landed (weasel `main` → `4a3dcd2e38`) |
| Fix 22 `headless`, 23 `rig` | 4 and 9 fixed, landed (weasel `main` → `f30993007a`) |

Decisions from conversation:

- "A couple"/"four more" delves counts areas, run uncapped, next in `scour ls --json`'s `queue` (2026-11-27).
- Mike asked for fix runs on "the ready areas" (2026-11-28); I added each delve that later stopped ready to fix
  (`scale`, `headless`, `rig`) to the queue on that reading. He hasn't objected.
- **`scale` wants another delve now that fix 21 landed:** at its ready-to-fix stop it was still finding 3 new per pass,
  ≈16 unseen. The ready-to-fix stop fires at `minPasses` (5) regardless of how far from saturated an area is, and no
  stop (cost or saturation) applies before pass 5 (`src/saturation.mjs`).

**Ledgers to land** (`skulkr scour land <area>`; Mike has approved each landing asked so far, but ask): 
`routing.interactions.dispatcher` (t-657, free now that fix 17 ended), and the six areas delved this session once
their fix runs end. Earlier ledgers landed at weasel `fa11f1f06b` and `1408b23ddf`.

**Dashboard outline mask:** `outline.mask` is on in `dashboard/src/audits/Treemap.tsx` (`9a788c1`), served from the
`~/src/weasel` checkout through the alpo link (`.alpo.local.json`, untracked, lists the needed weasel commits). That
checkout's `packages/*/dist` came from a fleet build at weasel `23763806`; local `npm run build` there is refused by a
hook, so rebuild with `onto do --kind build … --out` (flags before `--`).

The `animator` fix lane never ran: fix run 14's crash killed `fix-lane.sh`'s loop before it reached `animator`.

## This session (2026-11-27 ~20:30–21:00)

- Dashboard: estimates (left, next new, next defect) in sky blue via `--sk-estimate` in `dashboard/src/app.css`,
  no italic; a delve's kloc and files moved into its header before the pid; the live row leads with pass or batch,
  clock second (`44091e9`, `1d867ac`).
- **Outline occlusion** (kouhai t-661): done; `mask: true` is on (`9a788c1`), checked on labkit.config's cell, whose
  right edge gives way to its later neighbor. Not yet checked: routing.dispatcher raised over routing.actions, the
  case Mike named.
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
