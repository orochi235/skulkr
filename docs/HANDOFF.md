# Handoff

For the next session in skulkr. Written 2026-11-22; check each claim against the tree before acting on it.

## State

On `main`. `git log --oneline @{u}..HEAD` lists what is committed but not pushed (the user pushes on asking).

## In flight

- **weasel round 71** runs through the service (`onto call skulkr '{"id":1,"status":true,"tenant":"weasel"}'`).
- **Round 72 is to be the first preload trial** (`--trial preload`, README "A run"). A background loop in the
  session that wrote this started it once 71 left the live runs; that loop dies with its session. If no round 72
  is running or finished with a `<night>/trial/` directory, start it once 71 has ended:
  `onto call skulkr '{"id":1,"start":true,"tenant":"weasel","trial":"preload"}'`. A stranded round refuses the start
  (README "Stranded rounds"), which is the point.
- **Reading the trial:** `skulkr trial --tenant weasel` prints each area's two pairs: dollars, turns, cache writes and
  reads, output, and overlap (shared over distinct). Decided (2026-11-22): one round is the first pass; repeat only if
  the result sits near the line. Preload is worth adopting only if it costs less per review **and** its overlap does
  not rise, since a higher overlap means the pairs stopped being independent and Chapman's estimate reads low.
  Baseline measured on round 70: reviews $1.49 each, 63% of the round's spend; cache writes 36%, cache reads 37%,
  output 27% of a review's cost.

## Waiting on the user

- Delete skulkr's `weasel-70a055a` GitHub release (`docs/TODO.md`); nothing uses its tarballs since the dashboard
  moved to `@weasel-js/*` 2.0.0 from npm.
- The `warm-programs` branch and worktree (`../skulkr-warm-programs`, one commit): proposed moving its TODO line to
  `main` and marking it parked (`git config branch.warm-programs.parked …`); weasel 2.0.0 still lacks
  `warmPrograms`, so it cannot merge yet.
- This machine's alpo link (`dashboard/.alpo.local.json`, gitignored) serves `~/src/weasel` over npm; it existed for
  `SpanStrip`, which 2.0.0 has. `alpo unlink weasel` would put the dev server on npm. Not done: it is the user's.

## Traps

- **The dev server's file watcher went dead once** (2026-11-22): :5214 served morning modules all day and every
  dashboard change looked broken. Check what it serves (`curl -s localhost:5214/src/audits/<file> | grep …`) before
  debugging a change that "didn't take"; `emilia restart skulkr/dashboard` fixes it.
- **The fleet is short of work space** (studio and msb-uai near their 40 GiB); the nodes await an onto update that
  prunes caches. Jobs queue or are refused meanwhile; that is onto's, not skulkr's.
- `git.push` defaults to true (2026-11-22): a green round pushes its project's `main`, weasel's and blits' included.
