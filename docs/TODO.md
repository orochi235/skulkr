# TODO

Open work on skulkr. Each entry says when it closes.

- [ ] (P3) Compare fixers' cost and effectiveness with the same fixes made in an interactive Claude Code session,
  which carries the user's account-level rules a fixer never gets (fixers run with `--setting-sources project,local`,
  mostly on nodes without the user's config; decided 2026-11-22 not to send that prompt to them). Fixer side, already
  recorded: each job's `usage.jsonl` record (dollars, tokens by kind, turns, minutes), `fix.md`'s verdicts and tally,
  verify and its repairs, capstone failures laid at the branch, and calibration's later finds. Missing: (1) a way to
  hand a session the same work, e.g. `skulkr brief <round> <area>` printing the fixer's brief and findings as it was
  dispatched; (2) the session's cost, summed from its transcript's per-reply `usage` (`~/.claude*/projects/<cwd>/
  <session>.jsonl`); (3) its outcome put through the same verify, and the two diffs scored side by side. Closes when
  one area has been fixed both ways and the comparison reads from a command.
- [ ] (P2) Fix steps on the dashboard don't show progress reliably, and keep showing an error after it has
  presumably been fixed (reported 2026-11-22, not yet traced): work out where each comes from (the fixer's progress
  counter in `progress.mjs`, the map's run and lane state) and how a fixed error should clear. Closes when a fix
  step's progress tracks its work and a cleared error stops showing.
- [ ] (P3) The dashboard doesn't show an early landing (README "Early landings"): the run's `status.early` step
  reaches neither the map nor a lane, so only its gate progress shows. Closes when a run's lane shows its early
  landing's step.
- [ ] (P2) The dashboard dev server's file watcher misses edits, so :5214 keeps serving the old module until
  `emilia restart skulkr/dashboard`. Not vite, wake or alpo: with both plugins off it still misses, and a bare Node
  `fs.watch` on any directory (every Node from 24 to 26, in and out of the sandbox) gets no events while one on a
  single file does. Directory watches go through FSEvents, and `fseventsd` was at 100% CPU and 14 GB after 21 days up
  (2026-11-22). Fix: `sudo killall fseventsd` (launchd restarts it), then restart the dev server. Closes when an edit
  reaches the served module without a restart; if `fseventsd` wedges again, find what floods it (`sudo fs_usage -f
  filesys`).
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
