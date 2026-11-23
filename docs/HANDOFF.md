# Handoff

For the next session in skulkr. Written 2026-11-22 (late evening); check each claim against the tree before acting on
it.

## State

On `main`. `git log --oneline @{u}..HEAD` lists what is not pushed, here and in `~/src/weasel`
(`git -C ~/src/weasel log --oneline @{u}..main`); the user pushes on asking.

The gate overhaul approved on 2026-11-22 is built (README "Preflight"; weasel `d017b471cf` adds `test:fleet
--no-checks`). The first round to run it is the next one the service starts: each round is a fresh `skulkr night`.
Watch that round's night log for `preflight:` and `main:` lines, and its first fixers' `verify` times, which now
include ci.yml's checks (about 2 minutes each, measured on this machine by `checks:gate`; not yet measured on a node).

## Open

- weasel's `main` is 89 commits ahead of `origin/main`, round 73's landing (`6bbe10b467`, landed by hand on 2026-11-22 after a
  green `test:batch`) among them; unpushed until the user asks.
- Proposed, not decided (2026-11-22): a weasel pre-commit hook running the linters' safe fixes on staged files, since
  other sessions commit straight to weasel's `main` without a full run.
- A failed postbuild step (weasel's `test:fleet:postbuild`) is still found only by the fleet gate, and never checked on
  `main`: moving it out would put a build in every preflight.

## Traps

- **The dev server missed every edit because `fseventsd` wedged** (100% CPU, 14 GB after 21 days), which kills
  directory watches machine-wide. If edits stop reaching :5214, check
  `ps -p $(pgrep -x fseventsd) -o %cpu,rss`; the user runs `sudo killall fseventsd`, then
  `emilia restart skulkr/dashboard`.
- **The dashboard serves weasel from `~/src/weasel` through alpo** (for SpanStrip's label fix, weasel `a4da9befcb`),
  so a restart takes about 2 minutes. `alpo unlink weasel` once a weasel release carries the fix.
- A repair on msb-uai could not send a test to the fleet: that node's onto agent is not enrolled with the queue
  (its `onto doctor`).
- `git.push` defaults to true: a green round pushes its project's `main`.
- Running weasel's root `biome check --write` reformats whole files outside labkit (it did `README.md` and
  `scripts/lib/fleet-tree.mjs`, 2026-11-22): biome lints only `packages/labkit`, with that package's config.
