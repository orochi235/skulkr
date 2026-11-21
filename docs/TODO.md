# TODO

Open work on skulkr. Each entry says when it closes.

- [ ] (P3) A read-only tenant's `status` reply still gives a `nextStart`: blits, registered `--read-only` so nothing
  runs it overnight, answered `"nextStart":"2026-11-22T04:00:00.000Z"` (2026-11-21), though `src/host.mjs` never
  starts a read-only tenant. Closes when a read-only tenant's reply has no `nextStart`.
- [ ] (P2) Finish cutting weasel over to skulkr (README.md "Moving weasel over"). The `skulkr` service already runs
  weasel's rounds from `examples/weasel.config.mjs` (2026-11-21); left are moving the config and its briefs into
  weasel and deleting `scripts/skulk/`. Closes when weasel's own `skulkr.config.mjs` drives its rounds and
  `scripts/skulk/` is gone. Waiting on the user's go.
- [ ] (P3) The dashboard installs weasel from tarballs on this repository's `weasel-70a055a` release, since no published
  `@weasel-js/ui` has `SpanStrip` yet (1.19.1 on 2026-11-21; `dashboard/README.md` "weasel"). Closes when a weasel
  release carries everything the dashboard imports, `package.json` pins it from npm, and the release is deleted.
- [ ] (P3) The dashboard's two gate stripes are fixed as weasel's (`GATE_RUNS` in `phases.ts`: "fleet tests" and
  "postbuild"), while the pipeline reads a project's gate runs from `gate.progress`. Closes when the map names the
  gate runs and their labels and the dashboard draws whichever it is given.
