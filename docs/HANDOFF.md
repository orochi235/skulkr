# Handoff

For the next session in skulkr. Written 2026-11-26, late evening. Check each claim against the tree before acting on it.

## State

On `main`, pushed (`git log --oneline @{u}..HEAD` shows anything since). The fleet suite passed on the last pushed
commit. Built today (README, `docs/scour.md` and `docs/TODO.md` say how each works):

- **`skulkr scour fix <area> [--dry] [--batch k,…]`** (`src/scourFix.mjs`, `src/scourTriage.mjs`): triage a ledger's
  open defects into batches, run each through a round's fixer job on `main`'s tip (verify, up to two repairs), and
  put its commits on `scour<N>-<area>-b<k>` in the project. `main` is never touched; landing, close and ask are
  unbuilt (`docs/scour.md` "Building the fix stage" says what is built and designs the rest). Record:
  `<state>/scour/fix-<N>/record.json`.
- The Scour page: the fix shelf (each open defect a tile, grouped by batch, colored by fix status, recurrent ones
  dotted; hover traces it on the delve chart too), a Fix column in the defects table (branch in a tooltip), a live
  box for a running fix run, the scour queue pane atop the sidebar, the 2.5D map with a height dropdown, queue
  numbers, and chart legends behind ⓘ buttons (`dashboard/src/AboutButton.tsx`, shared by the rounds and
  calibration charts).
- `skulkr <command> --help` on every command (`src/cliHelp.mjs`); `scour ls --json` answers `{ ledgers, queue }`.

## In flight: the Timeline fix trial

ui.components.Timeline (34 delve passes, 39 defects, six batches). **Fix run 1** did batch 6 (D34, D4): both fixed,
on `scour1-ui.components.Timeline-b6`, verify passing after one repair, $1.44. **Fix run 2** runs batches 1–5 one at
a time, started from the previous session as a child process: if that session has closed, run 2 probably died with
it. Check `~/.local/state/weasel-skulkr/scour/fix-2/record.json` for the batches it finished, remove a leftover
`~/src/weasel/.worktrees/audit-scour-fix2` worktree, and run the rest with `node bin/skulkr.mjs scour fix --tenant
weasel ui.components.Timeline --batch <the rest>` (runs as this account locally; verify goes to the fleet).

Then: report per batch (verdicts, the `not a defect` rate, repairs, cost per fixed defect), have the user review the
`scour<N>-…` branches in weasel, and only then build landing (`docs/scour.md`).

## Decisions made in conversation (2026-11-26), not yet in docs

- Fix batches group only for the fixer's efficiency (shared files, shared cause), never by severity: every defect is
  to be fixed. In `docs/scour.md`.
- A recurrent defect is flagged, nothing more for now; it may later go straight to fix. In `docs/scour.md`.
- Fix runs stop at verified branches until the user has reviewed the trial's diffs; landing comes after.
- Non-model jobs (verify, checks, typecheck) belong on the fleet; model jobs run locally unless the user says
  otherwise for that run.
- Batches run one at a time; running two at once (the local runner allows it) is the user's call.
- Delves: the user said not to start any more passes (2026-11-26). Don't resume delving without asking.

## Loose ends

- **weasel's root holds 235 untracked Codex reports** plus `ingested/` and `other-commit/`, a copy of
  `/private/tmp/skulkr-saturation/reports/` made by some other session around 18:58–19:11. Every report is already in
  a ledger; the user has not said to delete them.
- **orochi's service** may start weasel round 90 at 23:00 if it registers weasel writable; ssh to orochi failed host
  key verification, so its `~/.config/skulkr/tenants.json` was never read. This machine's service has weasel and
  blits read-only.
- Unpushed elsewhere: transom `1ec7f5c` (the wall nudge skips an image already posted), chezmoi `de3dc5f` (the CLI
  `--help` rule in the shared CLAUDE.md).
- kouhai t-619: measure the `ready to fix` threshold from the ledgers, offered and awaiting the user's go.
- The dashboard dev server on 5214 was started by the previous session (`npx vite --force` from `dashboard/`); it may
  have gone with it. `npm run dev` restarts it.

## Traps

- **weasel's `node_modules` lags its lockfile** after weasel commits a dependency bump: the dashboard then fails on a
  missing export (blits `penner`, 2026-11-26). `npm install` in `~/src/weasel`, then restart vite with `--force`.
- **perl `s|…|…|` with a `|` in the pattern** (a TypeScript union) silently mangles files; use the Edit tool.
- **`checksOnFleet` keys on `cfg.runner === 'local'`**: scour's local mode must say so (the fix path does) or verify
  runs on this machine.
- A fixer cannot run browser tests: a fix that only shows in Chromium passes the fixer's own checks and fails verify.
- **onto syncs a job's tree by `git ls-files`**: `.skulkr/in/` and `.skulkr/out/` must never be gitignored.
- `git.push` defaults to true outside local mode: a green round or scour landing pushes the project's `main`.
