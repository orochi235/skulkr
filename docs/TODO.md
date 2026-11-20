# TODO

Open work on x-skulk. Each entry says when it closes.

- [ ] (P2) Cut weasel over to x-skulk (README.md "Moving weasel over"). Closes when weasel runs its nightly round
  from `skulk.config.mjs` and `scripts/skulk/` is gone. Waiting on the user's go.
- [ ] (P3) Enlist x-skulk on the fleet (`onto-enlist`), so `onto test` can run its suite. Closes when `.onto/tests`
  exists and one fleet run of the suite is green.
- [ ] (P3) Typecheck `dashboard/` once (`ALPO_WEASEL=<built checkout> npm run typecheck` there). It has never run:
  the controller refuses it locally, and a fleet node lacks the built weasel and `../../wake`. Closes on one clean run.
- [ ] (P3) `dashboard/src/audits/auditData.test.ts` "puts defects left on a heat scale…" fails: its ticks come out
  `[0, 2, 4, 6]` against the expected `[0, 1, 2, 5]`, already before the 2026-11-20 ports (the test and `areaData.ts`
  were untouched). Likely the linked weasel checkout's stale `@weasel-js/scale` dist. Closes when it passes against a
  freshly built weasel.
- [ ] (P3) `AuditsPage.test.tsx` and anything importing `LiveRuns` cannot run: the linked weasel checkout's `ui` dist
  predates `SpanStrip` (2026-11-19), and npm's 1.19.1 has none. Closes when one run passes against a built checkout.
- [ ] (P3) The dashboard's two gate stripes are fixed as weasel's (`GATE_RUNS` in `phases.ts`: "fleet tests" and
  "postbuild"), while the pipeline reads a project's gate runs from `gate.progress`. Closes when the map names the
  gate runs and their labels and the dashboard draws whichever it is given.
- [ ] (P3) Root `npm run typecheck` has not run since 2026-11-20's three changes: the controller refuses it locally.
  Closes on one clean run.
