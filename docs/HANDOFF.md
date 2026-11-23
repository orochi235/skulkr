# Handoff

For the next session in skulkr. Written 2026-11-22 (evening); check each claim against the tree before acting on it.

## State

On `main`, nothing uncommitted. `git log --oneline @{u}..HEAD` lists what is not pushed, here and in `~/src/weasel`
(`git -C ~/src/weasel log --oneline @{u}..main`); the user pushes on asking.

## In flight

- **weasel round 73** (8 areas) is in its capstone (`onto call skulkr '{"id":1,"status":true,"tenant":"weasel"}'`).
  Its batch was built before two fixes to weasel's `main` (`a47f56fe45`, `7e4cbfd639`), and every one of its gate
  failures came from `main`, not the audits. If it ends stranded, fix and land it (memory: never ask).
  It started before the per-area cap, so it runs under the old $160; later rounds get $10 per area.

## Next: approved, not built (2026-11-22)

The user wants the fleet gate to be a formality, running only tests. Approved in conversation ("ok do that", then
"move everything that isn't a test out of this part of the pipeline"):

1. **The checks leave the gate.** weasel's `gate` vitest project (`scripts/ci-checks.gate.ts`: ci.yml's typecheck,
   lint, `check:*`, `audit:*`; `npm run checks:gate` runs the same list in about 2 minutes) runs instead:
   - in each fixer's and repair's verify (`examples/weasel.config.mjs` `checks.verify.command`, which today runs
     only `check:changesets` and `vitest related` without the `gate` project);
   - once on the batch's tree before the gate joins the fleet queue, as a preflight that also reruns the last red
     gate's failing tests.
   The fleet gate then skips the `gate` project, which needs a switch on weasel's side in `test:batch`
   (`scripts/fleet-batch.mjs`, not yet read). Run `biome check --write` before lint wherever lint runs, so a fixable
   finding (today's was import order) is fixed, never failed.
   A check `main` already fails would fail every fixer's verify, so verify needs the set-aside it gives test files
   that fail on the frozen tree (`verdictText`'s `baseline` in `src/verify.mjs`).
2. **Check `main` before blaming a branch.** On a red gate, run each failing test or step on `main`'s tip first. What
   `main` fails too gets no repair; the round reports `main` red and names the commit that last touched the file.
   Related code: `alreadyFailing` and the `unproven` rule in `src/land.mjs`'s `batchAndTest`.
3. **No re-gate after a cycle that changed nothing.** In `batchAndTest`'s capstone loop, a branch counts as repaired
   when its repair verified, even with 0 commits, so the gate reran unchanged trees twice in round 73's early landing.

Proposed and not decided: a weasel pre-commit hook running `biome check --write` on staged files, since other
sessions commit straight to weasel's `main` without a full run.

## Why (2026-11-22)

Every gate failure this evening was caught by something no earlier step runs:

| Failure | Cause |
|---|---|
| round 72: `check:changesets` (title over 140) | a fixer's changeset; now a warning in weasel (`4c4ae24882`), and the check runs in verify (`97d9eba`) |
| round 73: `kitActionParams.test.tsx`, `lint -w @weasel-js/labkit`, `audit:jsdoc` | weasel `main`'s loupe commit `c6211023d2`; fixed in `a47f56fe45` and `7e4cbfd639` |
| round 73: `check:token-reads` | weasel `main`'s `21732c6ae9` (ToolbarDock); fixed in `7e4cbfd639` |

The capstone blamed audit branches for each `main` failure, and their repairs, unable to reproduce it on their own
branch, made no commits.

## Decided today, beyond the code

- weasel runs 8 areas a round with `budget.areaCapUsd` $10 (`examples/weasel.config.mjs`).
- The lanes open on Steps, A and B in a column each; a round's title counts checks and verify apart from fix.

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
