# TODO

Open work on skulkr. Each entry says when it closes.

- [ ] (P2) Finish cutting weasel over to skulkr (README.md "Moving weasel over"). The `skulkr` service already runs
  weasel's rounds from `examples/weasel.config.mjs` (2026-11-21); left are moving the config and its briefs into
  weasel and deleting `scripts/skulk/`. Closes when weasel's own `skulkr.config.mjs` drives its rounds and
  `scripts/skulk/` is gone. Waiting on the user's go.
- [ ] (P3) The dashboard installs weasel from tarballs on this repository's `weasel-70a055a` release, since no published
  `@weasel-js/ui` has `SpanStrip` yet (1.19.1 on 2026-11-21; `dashboard/README.md` "weasel"). Closes when a weasel
  release carries everything the dashboard imports, `package.json` pins it from npm, and the release is deleted.
