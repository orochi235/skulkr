# TODO

Open work on skulkr. Each entry says when it closes.

- [ ] (P1) Gates go red on checks the verify step never runs, so `main` stops moving and later rounds reuse a stale
  base. From 2026-11-20 10:00 to 2026-11-21 10:00 only round 56 of 48–65 landed: 59 and 64 failed on
  `npm run check:unnameable` (postbuild only), 60 in `npm run build`, and 62 and 63 on `Toast/containment.test.ts`, which the
  capstone could not attribute. 148 gate and salvage jobs ran (59.5 CPU-h) against about 36 for one gate per round.
  Closes when weasel's `checks.verify` covers what the gate fails on (the build of the changed packages and
  `check:unnameable`), and a gate failure the base commit already has does not count against the round.
- [ ] (P2) Continuous rounds pile up behind each other: rounds 62–64 overlapped overnight and took 262–289 min each, 61–64%
  of job time waiting, against 42–74 min before; round 62's gate waited 103 min behind rounds 63 and 64's reviews.
  Closes when the next continuous round starts only when the fleet has room for its reviews, and a round's gate and
  verify jobs go ahead of other rounds' reviews.
- [ ] (P2) A node at its disk ceiling (`409 Conflict: teitou holds 40.1 GiB ... at or over this node's 40.0 GiB ceiling`)
  stopped rounds 56 and 57 before they started: 38 reviews never launched, and round 57 picked the same areas and failed
  the same way. teitou still holds the pre-rename `weasel-skulk-r1..6` and `weasel-skulk-f1..6` trees (about 12 GiB),
  which README "Moving weasel over" says can go. Closes when those trees are dropped, and an area whose reviewer never
  launched is re-placed rather than recorded incomplete.
- [ ] (P3) A stopped round's finished reviews are thrown away: round 53 re-reviewed round 52's areas at the same commit
  (`830b463cc`), $29.41 again. Closes when a round reuses a finished review of the same area at the same commit.
- [ ] (P3) Every job's prompt cache writes are one-hour writes (`cacheWrite5m` is 0 in every record; 72.7M one-hour write
  tokens in 24 h). If the `claude` CLI can be asked for five-minute writes, the inferred saving is about $167 a day,
  assuming a reviewer's turns stay under five minutes apart. Closes when that is checked and, if it holds, used.
- [ ] (P2) Finish cutting weasel over to skulkr (README.md "Moving weasel over"). The `skulkr` service already runs
  weasel's rounds from `examples/weasel.config.mjs` (2026-11-21); left are moving the config and its briefs into
  weasel and deleting `scripts/skulk/`. Closes when weasel's own `skulkr.config.mjs` drives its rounds and
  `scripts/skulk/` is gone. Waiting on the user's go.
- [ ] (P3) The dashboard installs weasel from tarballs on this repository's `weasel-70a055a` release, since no published
  `@weasel-js/ui` has `SpanStrip` yet (1.19.1 on 2026-11-21; `dashboard/README.md` "weasel"). Closes when a weasel
  release carries everything the dashboard imports, `package.json` pins it from npm, and the release is deleted.
- [ ] (P3) Enlist skulkr on the fleet (`onto-enlist`), so `onto test` can run its suite. Closes when `.onto/tests`
  exists and one fleet run of the suite is green.
- [ ] (P3) The dashboard's two gate stripes are fixed as weasel's (`GATE_RUNS` in `phases.ts`: "fleet tests" and
  "postbuild"), while the pipeline reads a project's gate runs from `gate.progress`. Closes when the map names the
  gate runs and their labels and the dashboard draws whichever it is given.
- [ ] (P3) A resumed round's status starts its `costUsd` at 0 (`resume` in `src/night.mjs`), and its summary then holds
  only the resumed part, so continuous mode's night spend misses what the round spent before it stopped. Left as is
  for parity with weasel's `scripts/skulk`. Closes when a resumed round carries its earlier spend into `status.json`.
