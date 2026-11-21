# TODO

Open work on skulkr. Each entry says when it closes.

- [ ] (P2) Finish cutting weasel over to skulkr (README.md "Moving weasel over"). The `skulkr` service already runs
  weasel's rounds from `examples/weasel.config.mjs` (2026-11-21); left are moving the config and its briefs into
  weasel and deleting `scripts/skulk/`. Closes when weasel's own `skulkr.config.mjs` drives its rounds and
  `scripts/skulk/` is gone. Waiting on the user's go.
- [ ] (P3) The dashboard installs weasel from tarballs on this repository's `weasel-70a055a` release, since no published
  `@weasel-js/ui` has `SpanStrip` yet (1.19.1 on 2026-11-21; `dashboard/README.md` "weasel"). Closes when a weasel
  release carries everything the dashboard imports, `package.json` pins it from npm, and the release is deleted.
- [ ] (P2) Some jobs' `claude.json` ends up empty after skulkr has already read its usage from it: seven in blits
  nights 1–3 (2026-11-21), e.g. `nights/2026-11-21T17-02-12-742Z-round2/jobs/apps.playground/A/`, whose review-A
  usage record is complete while the file beside `.onto-fetch-cache.json` is 0 bytes. Something truncates it later,
  perhaps a second fetch into the same job directory; not yet traced. It costs money: `cameHome` treats an empty
  envelope as not home, so `--resume` pays for those jobs again. Closes when the writer is found and fixed.
