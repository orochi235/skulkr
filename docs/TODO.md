# TODO

Open work on skulkr. Each entry says when it closes.

- [ ] (P1) onto refuses a job when the controller is loaded: the client's `git rev-parse --show-toplevel` runs with a
  3-second timeout (onto `client.go` `localRepoAt` through `caps.go` `execRun`), and any error comes out as "<dir> is
  not inside a git repository". On 2026-11-26, at a load average of 400–570, that refused Timeline fix run 3's batch 4
  verify. Until 92dfdc1 the wrapper then ran the verify on the controller, adding to the load; now it asks three times
  and fails. weasel-cd is fixing onto. Closes when onto's client calls git with no probe timeout and reports git's real
  error.

- [ ] (P1) A scour fixer killed at its 45-minute limit (`perl -e 'alarm 2700'`) is recorded as if it finished: an
  empty `claude.json`, so "no verdicts read" and `$0.00`, with its commits verified and branched as usual (2026-11-27,
  Timeline batch 4 at 44.9 min and registry batch 1 at 44.9 min, both under a loaded controller). Their verdicts and
  costs were filled in by hand from the branches' commits and the transcripts. Closes when a fixer that hits the limit
  is reported as timed out, its cost is read from its transcript, and its verdicts are read from its commits or
  marked unread with that reason.

- [ ] (P2) A landing gates again whenever `main` moves during its gate, even when the move touches no code: fix run
  14's landing on 2026-11-27 ran its full gate three times, twice for other sessions' commits to weasel `main`, one
  of them only a `HANDOFF.md` note (`4b944b7604`). After `MAIN_CATCH_UPS` (2) catch-ups it stops merging, so a third
  move fails the fast-forward. Closes when a catch-up whose merged-in change touches only paths the gate cannot
  reach (docs, `HANDOFF.md`) merges without gating again, or the merge lock holds other sessions off `main`.

- [ ] (P2) The dashboard runs on unreleased weasel (`dashboard/README.md`): `Tooltip`'s `anchorRect` (41906fd420, only on
  weasel's `batch/2026-11-27-scour`) and `LiveQuantity` (2e6a59c4be, on weasel `main`). Until a weasel release carries
  both: the hover cards draw at the window's top-left whenever the linked `~/src/weasel` dist lacks 41906fd420; the
  fleet's dashboard suite fails six files on missing exports; and the dashboard typecheck runs nowhere (the hook
  refuses it here, and fleet nodes have no alpo). Closes when a weasel release has both and the dashboard pins it.

- [ ] (P2) On the Scour page in a window 900px tall with two live runs, the ledger's defects table gets no height at
  all: the live runs, the map and the ledger's header fill the right column, which does not scroll, so a picked
  defect's row is marked and scrolled to inside a pane nobody can see (2026-11-27, measured with Playwright at
  1440×900; at 1440×1500 the pane is 350px and picks show). Closes when the defects table keeps a usable minimum
  height, or the column scrolls, at 900px with two live runs.

- [ ] (P2) The dashboard's Scour page keeps a headless Chromium tab at 150–180% CPU while nobody touches it
  (2026-11-26, measured with `ps` on two headless browsers left open on it). Closes when an idle Scour page costs
  next to nothing.

- [ ] (P2) A local fixer's usage record reads its tokens from the job's last turn alone: scour fix 1's fixer, ten
  minutes and two commits, recorded 1 turn, 331 output tokens and 0.01M weighted tokens, while its `claude.json`
  `total_cost_usd` ($0.82) was right (2026-11-26). Costs stay correct; turns, tokens and weighted tokens do not.
  Closes when a fixer's record sums every turn, as a reviewer's does.

- [ ] (P2) A delve reviewer's file counter can sit at `onto: progress 0/31` for a whole pass: `text.layout`'s pass 4
  (2026-11-27) read 0/31 for its full 14 minutes and wrote nothing to `claude.json` until it ended, then logged 3
  findings, so a working pass looks hung in its log and on the Scour page. Likely cause (not checked): the files
  arrive preloaded in the prompt, so `progress.mjs` never sees a Read. Closes when a live reviewer shows it is working.
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
- [ ] (P2) A fix run's ledger lease vanished while the run was alive (found 2026-11-26): `scour fix` on
  ui.components.Timeline (pid 67599, run 2) took `<state>/scour/ui.components.Timeline/lock` at 02:18Z, and by 02:55Z
  the file was gone with the process still running, so the Scour page showed no live box and the map no fix outline.
  Nothing run on that area in between takes the lease (`scour report`, `scour flag`); other scour processes on other
  areas and another session shared the machine. The lease was rewritten by hand. Closes when what removes a live
  holder's lease is found (`reclaim` judging a live pid dead, or a cleanup outside `lease.mjs`) and fixed.
- [ ] (P3) The Scour page's defects table is two tables, unresolved above resolved (`defectGroupsOf` in
  `LedgerDetail.tsx`, 2026-11-26), because weasel's DataGrid cannot group rows; each sorts on its own, so a header
  click in one leaves the other as it was. Closes when DataGrid takes a public row-grouping prop (groups in a fixed
  order, sorted within, a heading row each), a weasel release carries it, and the page uses one table.
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
- [ ] (P3) The lanes' running times (`stepText` in `clockLane.ts` and `stepsLane.ts`, drawn on the lane canvas)
  still move only when a snapshot lands, counted to the map's `generated`. The headline elapsed, a live scour's
  elapsed and a job tail's age count on between snapshots through weasel's `LiveQuantity` (2026-11-27), which is DOM
  text; a lane label is drawn, so it needs the strip to redraw once a label's text changes, timed the same way
  (`nextChangeFor` over a `Reading`). Closes when a running lane's label counts on between snapshots without a
  per-frame redraw.

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
