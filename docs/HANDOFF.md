# Handoff

For the next session in skulkr. Written 2026-11-24, late evening; check each claim against the tree before acting on it.

## State

On `main`, pushed (`git log --oneline @{u}..HEAD` to check). README.md and CLAUDE.md's weasel parity list describe
everything landed on 2026-11-24: local mode, fleet verify and preflight, the usage-limit retry, resumed-round lanes,
pins, the dashboard changes.

**Round 83 of weasel is running locally** (started 2026-11-24 21:39 UTC, resumed 23:52 UTC after the usage limit cut
off six fixers and two repairs). It was started with
`node ~/src/skulkr/bin/skulkr.mjs night --local --resume 83 --config <scratchpad config>` from `~/src/weasel`; the
scratchpad is gone, and the same config is now at `~/.local/state/weasel-skulkr/weasel-local.config.mjs` — use it for
any further resume or round. Its log is `~/.local/state/weasel-skulkr/nights/2026-11-24T21-39-55-824Z-round83/night.log`.
`pgrep -fl "skulkr.mjs night"` shows whether it still runs. When it ends: if green, weasel's `main` is fast-forwarded
locally (local mode never pushes); if red, the standing rule is to fix the batch and land it.

## Decisions made in conversation (2026-11-24)

- **Local mode means only that Claude runs on this machine.** Every non-model job — a fixer's `checks:gate`, verifies,
  GUI verifies, baselines, the preflight, the gate — goes to the onto fleet where it can take it. Never add a heavy
  local job under the local runner.
- **Don't assume anything in flight will finish soon**: read its elapsed time against what such jobs take before
  waiting on it.
- Pass/fail captions are mark-space-word (`✓ passed`, `✗ failed`); a count puts the mark first with no space (`✗1`).
  Marks are set in Zapf Dingbats (the page fonts lack them).
- Finished steps in the steps view are flat dark gray (no tinted gray); the rounds and calibration charts show the
  latest 30 rounds.

## Open

- kouhai's ledger holds the open work for this repo (`owed`): t-543 #calibration-per-area-round, t-544
  #local-verify-to-fleet (built; settle it), t-545 #next-round-criteria (pins are its first criterion), t-546
  #stale-local-job-records, t-547 #killed-fixer-reads-done, t-548 #usage-limit-reads-as-done (built in `4285645`;
  settle it).
- Fleet verifies run from skulkr's local job trees (`~/.local/state/weasel-skulkr/trees/tN`), which onto names as
  repositories `t1`, `t2`, …, so each needs a cold setup per node and they pile onto whichever node set one up. Proposed,
  not decided: present them to onto as weasel so they use its warm pooled trees.
- Proposed, not decided: a pin mark on a pinned area's lane (the map cell and the area panel show pins today).
- keiei's onto copy of skulkr has no dashboard `node_modules`; dashboard fleet runs install first (`npm ci` in the
  command).

## Traps

- **The dev server misses edits when `fseventsd` wedges** (100% CPU, many GB), which kills directory watches
  machine-wide. Check `ps -p $(pgrep -x fseventsd) -o %cpu,rss`; the user runs `sudo killall fseventsd`. The dashboard
  dev server must be restarted to load changes to `dashboard/server/plugin.ts`.
- **A stale map shows as a red header** ("updated … · N min old") with the build's error below it; `skulkr map --tenant
  weasel` run by hand shows the error's stack.
- `git.push` defaults to true outside local mode: a green round pushes its project's `main`.
- Running weasel's root `biome check --write` reformats whole files outside labkit: biome lints only `packages/labkit`.
