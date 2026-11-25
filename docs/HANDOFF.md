# Handoff

For the next session in skulkr. Written 2026-11-25, late evening. Check each claim against the tree before acting on it.

## State

On `main`, pushed (`git log --oneline @{u}..HEAD` shows anything unpushed). The fleet suite passed on the last
commits of the day. Built today, all described in README.md:

- `.skulkr/` as each project's committed audit state: rounds, partition, landed scour ledgers, the defect registry
  (`.skulkr/defects/<area>.jsonl`), and a SQLite index at `.skulkr/cache/skulkr.db` that `skulkr q <sql>` queries.
  weasel's record moved there (weasel `be05bfd59e`); its registry holds every defect of rounds 29–88 and the ledgers.
- The saturation workflow is now called **scour**: `skulkr scour` (aliases `saturate`, `sat`), the dashboard's Scour
  page (`#<tenant>/scour/<area>`) with the audit map, the ledger list and the defect table, picks synced.
- The orochi service (`onto service`, tree `skulkr`) runs current skulkr; re-sync it with `onto sync --in skulkr orochi`
  after changes that matter to rounds.

- Scour, built 2026-11-25 on `main`: ledgers under `scour/` (state and `.skulkr/`, `saturation/` still read),
  `scour trawl` and `scour fold` as separate commands, the triage fields from reviewer to registry, `scour ls --ids`
  for the Codex skill, and the Scour page's left panel as a tree of every map area.

## Next: build the fix stage

`docs/scour.md` is the plan; its status line says what is built, and "Building the fix stage" is the design for the
rest. Order: landing as a shared library (names from a prefix, `record` and the left-out store passed in), then
triage, fix, ask and close, then the Scour page's fix queue and "needs you" list. The user said go on building all of
it (2026-11-25). Its stage table's middle columns (core action, UI, user sees) are the user's own wording.

weasel's parity rule in CLAUDE.md applies to every landing change: rounds must keep the same names, record and map.

## Decisions made in conversation (2026-11-25)

All are in `docs/scour.md` "Decided" or README.md except these:

- Pushing weasel's `main` needs the user's go-ahead each time.
- Scour defects are never handed to a round's fixer; they wait for scour's own fix stage.

## Loose ends

- **weasel `758e1efac7`, local and unpushed**: moves its landed ledgers from `.skulkr/saturation/` to `.skulkr/scour/`
  (530 renames; the registry rebuilds identically from it). The user has not yet said to push it; skulkr reads both
  paths, so nothing breaks while it waits. A round or landing on weasel would push it along with its own commit.
- Asked the user, unanswered: whether to add a map lens counting every agent review of an area (two per round read,
  plus scour occasions), and whether to reword the "saturation unseen" lens's legend (`dashboard/src/audits/heatMetrics.ts`).
- `~/.local/state/weasel-skulkr/saturation-hand/` holds the hand-run viewport experiment's inputs, already imported
  into the viewport ledger; nothing reads it.
- A stray onto tree `skulkr-weasel` on orochi, made by a mistaken sync, is unused.
- kouhai's ledger still holds older open work for this repo (`owed`): t-543, t-545, t-546, t-547.

## Traps

- **onto syncs a job's tree by `git ls-files`**, which leaves ignored files behind. `.skulkr/in/` and `.skulkr/out/`
  (a job's scratch) must never be gitignored, or every job loses its inputs; `.skulkr/.gitignore` ignores `cache/` only.
- **A test that hardcodes `docs/audits/`** now fails, since `record.dir` defaults to `.skulkr`. Build paths from
  `cfg.record.dir`.
- **The macOS filesystem is case-insensitive**: `pages.tsx` and `Pages.tsx` are one file.
- **The dev server misses edits when `fseventsd` wedges**; `dashboard/server/plugin.ts` changes need a dev-server restart.
- `git.push` defaults to true outside local mode: a green round, a scour landing and the record move all push the
  project's `main`.
