# TODO

Open work on skulkr. Each entry says when it closes.

- [ ] (P2) A local fixer's usage record reads its tokens from the job's last turn alone: scour fix 1's fixer, ten
  minutes and two commits, recorded 1 turn, 331 output tokens and 0.01M weighted tokens, while its `claude.json`
  `total_cost_usd` ($0.82) was right (2026-11-26). Costs stay correct; turns, tokens and weighted tokens do not.
  Closes when a fixer's record sums every turn, as a reviewer's does.

- [ ] (P2) A flag a command doesn't know is ignored, not refused: `skulkr night --dyr` runs a real round. Each command
  reads its flags out of `rest` itself (`rest.includes('--dry')`), so nothing knows the full set. Closes when every
  command declares its flags beside its usage in `src/cliHelp.mjs` and an unknown one exits 2 with that usage.

- [ ] (P2) `skills/skulkr-review-saturation` reviews `main`'s tip even for an area whose ledger is frozen at an older
  commit, so `scour ingest` refuses its report. On 2026-11-26 this happened to five of Codex's reports
  (routing.interactions, routing.interactions.actions, routing.interactions.dispatcher, routing.tools, text-dom); each
  was reviewed again by hand in a worktree at its ledger's commit. Closes when the skill learns an existing ledger's
  commit and file list without reading the ledger (say, `scour ls --ids --at`), and reviews a worktree at that commit.

- [ ] (P2) A killed `delve` (local or fleet mode) leaves its frozen worktree (`.worktrees/audit-saturate-<area>`) in the project and
  its `jobs/<NN>-<source>/` beside the ledger; only a normal stop removes them (`withFrozen`'s `finally`), and SIGTERM
  skips it. On 2026-11-26 the user stopped two `scour run` lanes at 15:21Z, and two more were stopped at 16:30Z,
  because their `claude -p` jobs ran as the account weasel's config names (`claude.configDir`), not the one that started them; each
  time the worktrees were removed by hand. Session mode (`scour next`) reuses its worktree, so this is `delve`'s
  alone. Closes when a delve removes them on SIGTERM/SIGINT and the next delve of the area clears any a SIGKILL left.

- [ ] (P1) Build saturation as stages, `docs/scour.md` (designed 2026-11-25, mostly unbuilt). Closes when its
  stages run on their own and the doc is folded into the README and deleted.
- [ ] (P2) Scour ledgers' defects reach no fixer: landed ledgers under `<record.dir>/scour/` are read by no fixer
  yet. The mechanism is scour's triage and fix stages, `docs/scour.md` (decided 2026-11-25). Closes when a landed
  ledger's open defects reach a fixer and its verdicts are recorded against the registry's ids.
- [ ] (P1) Review the whole state flow end to end (asked for 2026-11-23): every state an area, lane, batch, and round
  can be in, which log line or job moves it, and what the map and dashboard show for each. The pieces were built
  one step at a time (verify, repair, early landings, capstone cycles, left-out retries), and the dashboard has
  drifted from what is running (it showed areas done while the capstone repaired them, fixed 2026-11-23). Closes
  when the states and their transitions are written down in one place, and each mismatch between that and the map
  or dashboard is fixed or filed.
- [ ] (P3) Compare fixers' cost and effectiveness with the same fixes made in an interactive Claude Code session,
  which carries the user's account-level rules a fixer never gets (fixers run with `--setting-sources project,local`,
  mostly on nodes without the user's config; decided 2026-11-22 not to send that prompt to them). Fixer side, already
  recorded: each job's `usage.jsonl` record (dollars, tokens by kind, turns, minutes), `fix.md`'s verdicts and tally,
  verify and its repairs, capstone failures laid at the branch, and calibration's later finds. Missing: (1) a way to
  hand a session the same work, e.g. `skulkr brief <round> <area>` printing the fixer's brief and findings as it was
  dispatched; (2) the session's cost, summed from its transcript's per-reply `usage` (`~/.claude*/projects/<cwd>/
  <session>.jsonl`); (3) its outcome put through the same verify, and the two diffs scored side by side. Closes when
  one area has been fixed both ways and the comparison reads from a command.
- [ ] (P2) A red gate step whose output names only files no branch changed goes unattributed, so the capstone
  repair has nothing to hand a fixer and the round stays red. Round 78 (2026-11-23): icons-plugin's fixer made
  `weaselIcons.esbuild` refuse a minified library build, which broke `packages/headless`'s page build in
  `npm run build`; the log blamed only headless, so the batch sat red until fixed by hand. A fixer's verify runs only
  tests related to its files, so a consumer's build is never exercised before the gate. Closes when an unattributed
  failure is bisected over the batch's branches (rebuild without each, or rerun the failing step per branch) and the
  repair goes to the branch that turns it red.
- [ ] (P2) A running fixer is opaque under the onto runner (raised 2026-11-23). Under the local runner the dashboard's
  job tail shows what it says, each command, commit and check as it goes, and a fleet verify's own output (2026-11-24);
  the onto runner's job logs come home only when the job ends, so its rounds show the commit count alone. Closes when
  the tail reads a running onto job's log too (`onto logs --tail`, as it already does for a local job's fleet verify).
- [ ] (P2) weasel's GUI probe always fails (found 2026-11-24): `vitest list --filesOnly … --related=<file>` dies with
  `Unknown option --related` in weasel's vitest, and a failed probe reads as needing the GUI (`needsGui`), so every
  fix's hand-back sends a GUI verify to the fleet whether or not its changes reach a browser test. Every fixer of
  round 83 did. Closes when the probe lists the browser tests related to the changed files (`vitest related` has no
  list mode; the probe may need `--changed` or a module-graph walk) and a fix touching none runs no GUI verify.
- [ ] (P2) Fix steps on the dashboard don't show progress reliably, and keep showing an error after it has
  presumably been fixed (reported 2026-11-22, not yet traced): work out where each comes from (the fixer's progress
  counter in `progress.mjs`, the map's run and lane state) and how a fixed error should clear. Closes when a fix
  step's progress tracks its work and a cleared error stops showing.
- [ ] (P3) The dashboard doesn't show an early landing (README "Early landings"): the run's `status.early` step
  reaches neither the map nor a lane, so only its gate progress shows. Closes when a run's lane shows its early
  landing's step.
- [ ] (P2) Finish cutting weasel over to skulkr (README.md "Moving weasel over"). The `skulkr` service already runs
  weasel's rounds from `examples/weasel.config.mjs` (2026-11-21); left are moving the config and its briefs into
  weasel and deleting `scripts/skulk/`. Closes when weasel's own `skulkr.config.mjs` drives its rounds and
  `scripts/skulk/` is gone. Waiting on the user's go.
- [ ] (P3) The dashboard calls weasel's `warmPrograms()` before React renders, so the map's shaders compile during
  boot (merged from `warm-programs`, 2026-11-24), but no published `@weasel-js/core` exports it yet: against the pinned
  2.0.0 the call is skipped (`dashboard/src/main.tsx`). Closes when the pin moves to a release that has it and the
  call imports it by name.
- [ ] (P2) Some jobs' `claude.json` ends up empty after skulkr has already read its usage from it: seven in blits
  nights 1–3 (2026-11-21), e.g. `nights/2026-11-21T17-02-12-742Z-round2/jobs/apps.playground/A/`, whose review-A
  usage record is complete while the file beside `.onto-fetch-cache.json` is 0 bytes. Something truncates it later,
  perhaps a second fetch into the same job directory; not yet traced. It costs money: `cameHome` treats an empty
  envelope as not home, so `--resume` pays for those jobs again. Closes when the writer is found and fixed.
- [ ] (P3) A "next round" section in the dashboard's prefs that starts a round with the settings the service's `start`
  request takes (`areas`, `only`, `nodes`, `capUsd`, `budget` `{review, match, fix}`; README "The service"), asked for
  2026-11-22. Model, effort and timeout live only in the config, so they stay out unless `start` learns them. No cap on
  a reviewer's findings: Chapman's estimate reads the overlap of two complete lists, so a truncated list breaks it.
  Closes when the dashboard can start a round with those settings.
- [ ] (P2) A model job can come home with an empty `claude.json` beside a whole `exit` and `findings.md` (round 86,
  2026-11-25: renderer.cache's match and routing.interactions.actions' B, the onto fetch noting `working tree ... is
  busy: a sync is updating it`). `cameHome` then refuses it, so a resume reruns and pays for it again, and a rerun
  review replaces the report its area's reused fixer was given (likely why cursor A reran on the first resume). Closes when a
  job's result file coming home empty is fetched again or refused at fetch, not discovered on resume.
