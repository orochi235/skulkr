# TODO

Open work on x-skulk. Each entry says when it closes.

- [ ] (P2) Cut weasel over to x-skulk (README.md "Moving weasel over"). Closes when weasel runs its nightly round
  from `skulk.config.mjs` and `scripts/skulk/` is gone. Waiting on the user's go.
- [ ] (P3) Enlist x-skulk on the fleet (`onto-enlist`), so `onto test` can run its suite. Closes when `.onto/tests`
  exists and one fleet run of the suite is green.
- [ ] (P3) Typecheck `dashboard/` once (`ALPO_WEASEL=<built checkout> npm run typecheck` there). It has never run:
  the controller refuses it locally, and a fleet node lacks the built weasel and `../../wake`. Closes on one clean run.
- [ ] (P3) `dashboard/src/audits/auditData.test.ts` "puts defects left on a heat scale…" fails against the linked
  weasel checkout's `scale` dist (built 2026-11-19 15:30), which predates weasel's warp-scale tick changes
  (`29c0156c77`, `20bb330f0d`, 2026-11-20): that dist ticks `[0, 2, 4, 6, 8]`, while `packages/scale/src` bundled
  from source ticks `[0, 1, 2, 5, 8]`, which the test expects. Nothing in x-skulk is wrong. Closes when weasel's
  `scale` is rebuilt (`npm run build -w @weasel-js/scale`, refused on this machine by the controller hook) and the
  test passes.
- [ ] (P3) `AuditsPage.test.tsx` and anything importing `LiveRuns` cannot run: the linked weasel checkout's `ui` dist
  predates `SpanStrip` (2026-11-19), and npm's 1.19.1 has none. Closes when one run passes against a built checkout.
- [ ] (P3) The dashboard's two gate stripes are fixed as weasel's (`GATE_RUNS` in `phases.ts`: "fleet tests" and
  "postbuild"), while the pipeline reads a project's gate runs from `gate.progress`. Closes when the map names the
  gate runs and their labels and the dashboard draws whichever it is given.
