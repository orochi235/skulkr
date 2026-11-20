# TODO

Open work on x-skulk. Each entry says when it closes.

- [ ] (P2) Cut weasel over to x-skulk (README.md "Moving weasel over"). Closes when weasel runs its nightly round
  from `skulk.config.mjs` and `scripts/skulk/` is gone. Waiting on the user's go.
- [ ] (P3) Enlist x-skulk on the fleet (`onto-enlist`), so `onto test` can run its suite. Closes when `.onto/tests`
  exists and one fleet run of the suite is green.
- [ ] (P3) Typecheck `dashboard/` once (`ALPO_WEASEL=<built checkout> npm run typecheck` there). It has never run:
  the controller refuses it locally, and a fleet node lacks the built weasel and `../../wake`. Closes on one clean run.
