# TODO

Open work on skulkr. Each entry says when it closes.

- [ ] (P2) Cut weasel over to skulkr (README.md "Moving weasel over"). Closes when weasel runs its nightly round
  from `skulkr.config.mjs` and `scripts/skulk/` is gone. Waiting on the user's go.
- [ ] (P1) A failure the frozen tree already has is repaired once per area, and the batch then drops every area
  whose repairs conflict. Round 62 (2026-11-21): eight areas' verify failed on the same outline-font browser tests,
  a weasel install problem none of them caused; each repair re-fixed `scripts/vitest-browser-deps.ts` its own way,
  and seven verified areas were left out at the batch step for conflicting there (round 63 lost five the same way).
  Closes when verify judges an area by the failures its commits add over the frozen tree's own (run once per round on
  the frozen tree, or the failures two or more areas share), a repair brief names only those, and a test covers an
  area whose only failure is a baseline one passing verify.
- [ ] (P3) Enlist skulkr on the fleet (`onto-enlist`), so `onto test` can run its suite. Closes when `.onto/tests`
  exists and one fleet run of the suite is green.
- [ ] (P3) Typecheck `dashboard/` once (`ALPO_WEASEL=<built checkout> npm run typecheck` there). It has never run:
  the controller refuses it locally, and a fleet node lacks the built weasel and `../../wake`. Closes on one clean run.
- [ ] (P3) The dashboard's two gate stripes are fixed as weasel's (`GATE_RUNS` in `phases.ts`: "fleet tests" and
  "postbuild"), while the pipeline reads a project's gate runs from `gate.progress`. Closes when the map names the
  gate runs and their labels and the dashboard draws whichever it is given.
- [ ] (P3) A resumed round's status starts its `costUsd` at 0 (`resume` in `src/night.mjs`), and its summary then holds
  only the resumed part, so continuous mode's night spend misses what the round spent before it stopped. Left as is
  for parity with weasel's `scripts/skulk`. Closes when a resumed round carries its earlier spend into `status.json`.
- [ ] (P3) README "Tenants" still says weasel is registered read-only; `~/.config/skulkr/tenants.json` lists it without
  `readOnly` (2026-11-20). Closes when the paragraph says how weasel is registered now.
