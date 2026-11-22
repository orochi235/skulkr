# skulkr dashboard

A live page of each tenant's audit rounds: the areas as a treemap shaded by what the audits estimate is left, every
running round's lanes, the rounds chart, the jobs coming back, the queue, and an area's defects. Its data comes from
the pipeline's CLI (`../bin/skulkr.mjs tenants ls`, `map` and `defects <area>`), which a small Vite plugin
(`server/plugin.ts`) runs on each request at `api/tenants`, `api/t/<name>/map` and `api/t/<name>/area?id=<area>`.
The title's menu switches tenants; the URL hash names the one shown. A slider above the treemap shows it as it stood
after an earlier round, shaded only by what was left then (settling, changes and live runs are known only of now);
the hash carries the round after an `@` (`#weasel@41`), so the view survives a reload and can be shared. Maps without
`lastByRound`, the demo's among them, show no slider. Reaching a round whose record recut the partition (the map's
`recuts`) flashes a lime outline, fading, on the areas it made or split; the prefs' "Flash recut areas" turns it off.

```sh
npm install
npm run dev   # http://localhost:5214, and the LAN address: every tenant in ~/.config/skulkr/tenants.json
npm run serve # the same page built: one bundle, so it loads in a fraction of the time; for watching rounds
```

With no tenant registered it reads the one project the CLI finds: `SKULKR_CONFIG` names its config and `SKULKR_ROOT`
its root; with neither, `skulkr.config.mjs` in the directory the server starts in. Under emilia: `emilia up dev` from this directory.

## weasel

The page is built on weasel (`@weasel-js/*`) and needs more of it than npm has (`SpanStrip` and its neighbors), so
until a weasel release carries them, `package.json` installs every `@weasel-js` package, its `overrides` included, from
tarballs on this repository's `weasel-70a055a` release: weasel's built packages at that commit, made with `npm pack`.
A fresh clone needs nothing else. Once a release carries them, the pins go back to the published version and the
release can be deleted.

On a machine with weasel checked out, alpo can still serve the checkout over those tarballs:

```sh
alpo link weasel --for "<why>"   # serve ~/src/weasel's built dist; alpo unlink weasel goes back to the tarballs
ALPO_WEASEL=<checkout> npm run dev   # another checkout, for one run
```

alpo serves the checkout's **built** `dist`, so that checkout's packages must be built first. Build all of them together (`npm run build` in the checkout), never one package alone: the packages call each
other across their `dist`, and a newer `ui` over an older `text` left the map drawing nothing (2026-11-20). Tests resolve through
the same plugin (`vitest.config.ts` also inlines the checkout's third-party modules, so they share the app's
React). `npm run typecheck` checks against the linked checkout's types while a link is active.

`vite-plugin-wake` is an optional dependency from a sibling checkout (`../../wake`); without it the page runs as is.

## The demo

`npm run snapshot -- <tenant>` writes what the page reads for one registered tenant as static files in `demo/`
(home paths as `~`), and `npm run build:demo` builds a page that reads them, for `/skulkr/`.
`.github/workflows/pages.yml` builds and deploys it on every push to `main` that touches `dashboard/`, to
michaelbaker.tech/skulkr/. The committed snapshot is weasel's, mid-round 65 (2026-11-21); refreshing it is the
snapshot command and a commit.
