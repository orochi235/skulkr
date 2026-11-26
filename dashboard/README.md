# skulkr dashboard

A live page of each tenant's audit rounds: the areas as a treemap shaded by what the audits estimate is left, every
running round's lanes, the rounds chart, the jobs coming back, the queue, and an area's defects. Its data comes from
the pipeline's CLI (`../bin/skulkr.mjs tenants ls`, `map` and `defects <area>`), which a small Vite plugin
(`server/plugin.ts`) runs on each request at `api/tenants`, `api/t/<name>/map` and `api/t/<name>/area?id=<area>`; the
area panel's pin toggle POSTs to `api/t/<name>/pin?id=<area>&on=1|0`, which runs `pin` or `unpin`. The job-log callout
over a running round's lane reads `api/t/<name>/tail?id=<area>` every 3 seconds, which the plugin answers itself from the
area's newest job log (`server/jobTail.ts`), adding `onto logs --tail` for a job it handed to the fleet; the log tab reads `api/t/<name>/log`, the end of the
running round's `night.log`, the same way. `api/t/<name>/saturation` serves `skulkr scour ls --json`, every
saturation ledger with its defects, for the saturation page.
`api/t/<name>/events` (`server/feed.ts`) streams server-sent events: `map`, on connecting and after each build that
changed it, and `areas`, the areas whose files a running round wrote. While a page listens, the server looks at the
running rounds' night directories and the state's `runs/` every second (by size and change time: FSEvents reports
nothing of a log its writer holds open), runs `skulkr fetch` to keep the fleet's listings fresh so no build waits on
the fleet, lifts macOS's background policy off each CLI child it starts, builds the map after a change, one build at a time and at least 2 seconds
apart, and every 15 seconds besides. The page asks for the map only while the stream is down; the defects list asks
again when its area is touched.
The menu under the map colors it by defects left (the default), defects left per 10 files, fixed, found, the queue's
order, open findings, lines changed since a pass, rounds since a pass, rounds read, or files; each has its own ramp in
the prefs (the defects-left ramp also colors the charts). Under the map, the jobs feed, the queue's head and the pinned
areas (tabs), and the running round's `night.log`, raw, beside the issues (what the gate fails, failed steps, left-out
branches, open findings; tabs) sit side by side, their seams dragged to resize them. A reload starts from the tenant list and map this browser read last.
The title's menu switches tenants; the URL hash names the one shown. The switch beside it moves to the Scour page
(`#weasel/scour`): every saturation ledger, sortable, beside the audit map and the picked one's distinct
defects, the area in the hash after it (`#weasel/scour/core.animation`). Above them, each ledger a live scour process holds shows what it does, for how long,
its occasions against its `--max`, each job it has out with its newest log line, and the end of its `scour.log`, and the
map outlines its area, pulsing, in the review or match color as the audit map does a live round's. Each such box, and a
picked ledger's panel, charts its passes: one stack of tiles per pass, a tile per defect that pass reported, colored by
whether it was new and seen again since, new and seen by no other pass, or seen before, with the count estimated not
found yet beside the last. The page asks every 5 seconds while one runs, else every 30. Its map shades areas by what their scour ledgers say (the
chance the next review finds a new defect, defects not found yet, open, found, the estimated total, reviews, spend),
kept apart from the audit map's choice, and draws only the queue numbers, pins, area icons and live outlines over
them, none of the audit history's marks; picking an area on the map or in the list picks it in both. A slider above the treemap shows it as it stood
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
its root; with neither, `.skulkr/config.mjs` or `skulkr.config.mjs` in the directory the server starts in. Under emilia: `emilia up dev` from this directory.

## weasel

The page is built on weasel (`@weasel-js/*`), pinned to 2.0.0 from npm. The map's loupe (F2, or the loupe button in
the header) is `@weasel-js/hud`'s round lens, over the map's canvas; the round lens is unreleased (weasel 7d11e12034), so
it needs the alpo link below until a release carries it.

On a machine with weasel checked out, alpo can serve the checkout over the published packages:

```sh
alpo link weasel --for "<why>"   # serve ~/src/weasel's built dist; alpo unlink weasel goes back to npm
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
