# TODO

Open work on skulkr. Each entry says when it closes.

- [ ] (P2) Finish cutting weasel over to skulkr (README.md "Moving weasel over"). The `skulkr` service already runs
  weasel's rounds from `examples/weasel.config.mjs` (2026-11-21); left are moving the config and its briefs into
  weasel and deleting `scripts/skulk/`. Closes when weasel's own `skulkr.config.mjs` drives its rounds and
  `scripts/skulk/` is gone. Waiting on the user's go.
- [ ] (P2) The dashboard installs only on this machine: `vite-plugin-wake` is `file:../../wake`, and it needs weasel's
  `SpanStrip`, which no published `@weasel-js/ui` has yet (1.19.1 on 2026-11-21), through alpo. Closes when
  `npm install && npm run dev` works in a fresh clone with no sibling checkouts: a weasel release carrying `SpanStrip`,
  and wake either published or loaded only when present.
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
