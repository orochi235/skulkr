# TODO

Open work on skulkr. Each entry says when it closes.

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
- [ ] (P3) Merge the parked `warm-programs` branch (worktree `../skulkr-warm-programs`): the dashboard calls weasel's
  `warmPrograms()` before React renders so the map's shaders compile during boot. `@weasel-js/*` 2.0.0 lacks it.
  Closes when the dashboard pins a weasel release that has `warmPrograms` and the branch merges.
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
