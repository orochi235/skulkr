# skulk dashboard

A live page of each tenant's audit rounds: the areas as a treemap shaded by what the audits estimate is left, every
running round's lanes, the rounds chart, the jobs coming back, the queue, and an area's defects. Its data comes from
the pipeline's CLI (`../bin/skulk.mjs tenants ls`, `map` and `defects <area>`), which a small Vite plugin
(`server/plugin.ts`) runs on each request at `api/tenants`, `api/t/<name>/map` and `api/t/<name>/area?id=<area>`.
The title's menu switches tenants; the URL hash names the one shown.

```sh
npm install
npm run dev   # http://localhost:5214, and the LAN address: every tenant in ~/.config/skulk/tenants.json
```

With no tenant registered it reads the one project the CLI finds: `SKULK_CONFIG` names its config and `SKULK_ROOT`
its root; with neither, `skulk.config.mjs` in the directory the server starts in. Under emilia: `emilia up dev` from this directory.

## weasel

The page is built on weasel (`@weasel-js/*`) and needs more of it than npm has (`SpanStrip`), so it runs against a
local checkout through alpo. The pins stay on the published version.

```sh
alpo link weasel --for "<why>"   # serve ~/src/weasel's built dist; alpo unlink weasel goes back to npm
ALPO_WEASEL=<checkout> npm run dev   # another checkout, for one run
```

alpo serves the checkout's **built** `dist`, so that checkout's packages must be built first. Build all of them together (`npm run build` in the checkout), never one package alone: the packages call each
other across their `dist`, and a newer `ui` over an older `text` left the map drawing nothing (2026-11-20). Tests resolve through
the same plugin (`vitest.config.ts` also inlines the checkout's third-party modules, so they share the app's
React). `npm run typecheck` checks against the linked checkout's types while a link is active.
