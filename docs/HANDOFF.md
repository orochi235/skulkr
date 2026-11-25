# Handoff

For the next session in skulkr. Written 2026-11-24, late evening, pruned the same night; check each claim against the tree before acting on it.

## State

On `main` (`git log --oneline @{u}..HEAD` shows what is unpushed). README.md and CLAUDE.md's weasel parity list describe
everything landed on 2026-11-24: local mode, fleet verify and preflight, the usage-limit retry, resumed-round lanes,
pins, the dashboard changes.

**Round 85 of weasel is running on the fleet** (started 2026-11-24 ~22:00 local with `skulkr night --tenant weasel`
from `~/src/weasel`; log under `~/.local/state/weasel-skulkr/nights/2026-11-25T02-59-57-769Z-round85/`). Outside local
mode a green round pushes weasel's `main`. Rounds 83 and 84 landed. For a local round, the config is at
`~/.local/state/weasel-skulkr/weasel-local.config.mjs`.

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

- kouhai's ledger holds the open work for this repo (`owed`): t-543 #calibration-per-area-round, t-545
  #next-round-criteria (pins are its first criterion), t-546 #stale-local-job-records, t-547 #killed-fixer-reads-done.
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
