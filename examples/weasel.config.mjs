/**
 * weasel's skulkr config: reproduces the nightly audit weasel's own `scripts/skulk` ran up to round 49. At cutover it
 * becomes `skulkr.config.mjs` at weasel's root, with `weasel/` beside this file moved to `scripts/audit/` and the
 * `./weasel/` paths below changed to match (README.md "Moving weasel over").
 */
import { icons } from './weasel/icons.mjs';
import { sweep } from './weasel/sweep.mjs';

/** The root vitest config's projects that run in Chromium: `browser`, `browser (webgpu)`, and `forge-stories`. */
const BROWSER_PROJECTS = ['browser*', 'forge-stories'];

/**
 * What a failed `npm run lint -w @weasel-js/<name>` (one of `ci-checks.gate.ts`'s tests, named for the step) blames: the
 * files biome's report in vitest's failure summary marks with an error (`×`), else the package's directory; null for
 * any other step.
 */
const blameLint = (lines, step) => {
  const name = /\bnpm run lint -w @weasel-js\/([\w.-]+)$/.exec(step)?.[1];
  if (!name) return null;
  const dir = `packages/${name}`;
  const plain = lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, ''));
  const at = plain.findIndex((l) => /^\s*FAIL\b/.test(l) && l.trimEnd().endsWith(step));
  const files = [];
  for (let i = at + 1; at >= 0 && i < plain.length && !/^\s*FAIL\b|⎯⎯⎯/.test(plain[i]); i++) {
    const head = /^(?:\w*Error: )?(\S+\.\w+)(?::\d+:\d+)? [\w/]+(?:\s+FIXABLE)?\s+━/.exec(plain[i]);
    if (!head || !plain.slice(i + 1).find((l) => l.trim())?.trim().startsWith('×')) continue;
    const at2 = head[1].lastIndexOf(`${dir}/`);
    files.push(at2 >= 0 ? head[1].slice(at2) : `${dir}/${head[1]}`);
  }
  return files.length ? [...new Set(files)] : [dir];
};

/**
 * The packages a failed post-build step blames: its output, after its `fleet-fail:` line and up to the next step,
 * names each as `@weasel-js/<name>: …` (`check:unnameable`'s report) or on a line saying it failed (the build's
 * `[build] 31/65 FAIL … @weasel-js/<name>`), and a package's directory is its name.
 */
export const blameStep = (text, step) => {
  const lines = text.split('\n');
  const lint = blameLint(lines, step);
  if (lint) return lint;
  const at = lines.findIndex((l) => l.startsWith('fleet-fail:') && l.endsWith(step));
  if (at < 0) return [];
  const end = lines.findIndex((l, i) => i > at && /\bci-run:|^fleet-fail:/.test(l));
  const section = lines.slice(at + 1, end < 0 ? undefined : end);
  const named = (l) => [...l.matchAll(/@weasel-js\/([\w.-]+):\s/g), ...(/\bFAIL\b|\bfailed\b/.test(l) ? l.matchAll(/@weasel-js\/([\w.-]+)/g) : [])];
  return [...new Set(section.flatMap((l) => named(l).map((m) => `packages/${m[1]}`)))];
};

/** ci.yml's checks as vitest tests, three at once (the `gate` project's `maxConcurrency`). */
const CHECKS = 'npx vitest run --project=gate scripts/ci-checks.gate.ts';

/** The changed files `{files}` lists matching `re`, one a line, with `strip` cut from each. */
const pick = (re, strip = '') => `$(printf '%s\\n' {files} | grep -E '${re}'${strip ? ` | sed 's#^${strip}##'` : ''})`;
const FIXUP = [
  `L=${pick(String.raw`^packages/labkit/.*\.(tsx?|jsx?|mjs|css|json)$`, 'packages/labkit/')}`,
  '[ -z "$L" ] || (cd packages/labkit && npx biome check --write --no-errors-on-unmatched $L)',
  `E=${pick(String.raw`^(packages|apps|tests)/.*\.(tsx?|jsx?|mjs)$`)}`,
  '[ -z "$E" ] || npx eslint --fix $E',
  'true',
].join('; ');

// `nvm use` swaps its own PATH entry in place, so a Node earlier on PATH (Homebrew's, on this Mac) still won.
const NVM = 'export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"; . "$NVM_DIR/nvm.sh" >/dev/null; nvm use >/dev/null; export PATH="$NVM_BIN:$PATH"';

const config = {
  name: 'weasel',
  // Kept here in skulkr, so it names weasel's checkout; at cutover drop it: unset is the repo holding the config.
  root: '~/src/weasel',
  state: '~/.local/state/weasel-skulkr',
  keepNights: 30,

  partition: {
    roots: ['packages/*/src', 'apps/*'],
    extensions: ['ts', 'tsx', 'mts', 'mjs', 'js', 'jsx', 'css', 'less'],
    exclude: [/\.test\.[^/]+$/, /\.pbt\.fixture\.ts$/, /\.d\.ts$/, /(^|\/)(fixtures|vendor|__tests__)\//],
    maxFiles: 50,
    minFiles: 10,
    // `packages/core/src/canvas` → `core.canvas`; `apps/draw/src` → `apps.draw.src`.
    areaId: (dir) => dir.replace(/^packages\/([^/]+)\/src/, '$1').replace(/\//g, '.'),
  },

  git: { main: 'main', remote: 'origin' },
  naming: { prefix: 'audit', batchPrefix: 'batch' },

  record: {
    dir: '.skulkr',
    formerDirs: ['docs/audits'],
    intro: [
      'Blind pairs at `{{commit}}` ({{date}}), run by skulkr. Each area\'s directory holds its file',
      'list (`files.txt`), both reviewers\' findings (`A.md`, `B.md`), the matching (`match.json`), the fixer\'s',
      'report (`fix.md`) and the numbers below (`area.json`). The method is `docs/hardening.md`, "Blind pairs".',
      '',
      '"Read" is how many listed files each reviewer says it read. "Est." is Chapman\'s estimate of what the area held,',
      '"left" that less the distinct findings, and "last left" the previous pass\'s figure, which this pass tests.',
      '"New code" counts findings citing a file changed since that pass. "Commits" is what the fixer committed.',
      '"Weighted tokens" counts each kind of token at its price against an input token (`TOKEN_WEIGHTS` in skulkr\'s `src/usage.mjs`); "cost" is list price.',
      'One record per job is in `usage.jsonl`. The shas in `fix.md` are the fixer\'s, on its node; the same commits',
      'as applied here are `fixCommits` in `area.json`.',
    ],
    ledger: {
      path: 'docs/hardening.md',
      section: 'Record',
      row: ({ round, date, areas }) => {
        const found = areas.reduce((s, a) => s + a.distinct, 0);
        const fixed = areas.reduce((s, a) => s + a.patches, 0);
        const each = areas.map((a) => `${a.id} ${a.a}/${a.b}/${a.m}, ${a.chapman === undefined ? 'incomplete' : `est. ${a.chapman.toFixed(1)}`}`).join('; ');
        return `| ${date} | ${areas.map((a) => a.id).join(', ')} (audit round ${round}, nightly) | blind pairs | 0 | ${found} / ${fixed} commits | `
          + `Run by skulkr with one file list per area; raw lists in \`.skulkr/round-${round}/\`. A/B/shared and Chapman's estimate per area: ${each}. |`;
      },
    },
    trailer: 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>',
  },

  // weasel's briefs name its own rules (CLAUDE.md, docs/unruled.md, changesets, checks:gate) outright.
  briefs: {
    reviewer: './weasel/briefs/reviewer.md',
    matcher: './weasel/briefs/matcher.md',
    fixer: './weasel/briefs/fixer.md',
  },

  // How the fixer brief's checks show in its stream: one vitest file, a package's lint, and `checks:gate`.
  checks: {
    tally: {
      test: String.raw`\bvitest run\b.*?\s([\w./@-]+\.test\.[cm]?[jt]sx?)\b`,
      testPath: String.raw`^(?!.*\.browser\.test\.).*\.test\.[cm]?[jt]sx?$`,
      lint: String.raw`\bnpm run(?: -s)? lint -w (?:@weasel-js\/)?([\w.-]+)`,
      lintOf: String.raw`^packages\/([^/]+)\/`,
      final: String.raw`\bnpm run(?: -s)? checks:gate\b`,
    },
    // Every test file whose imports reach what the fixer changed, under the root config's projects: all but the checks
    // (`gate`) and the projects that need a browser, which run on a GUI node. Then the checks themselves, ci.yml's
    // typecheck, lint, `check:*` and `audit:*` (`scripts/ci-checks.gate.ts`, a vitest file whose tests are the
    // steps), so the fleet gate runs only tests (2026-11-22). Last, `check:unnameable` on the packages the changes are
    // in, built first: it reads `dist`, so it otherwise first ran at the gate's full build (2026-11-23).
    verify: {
      // The checks are skipped where the fixer's own `checks:gate`, the same checks, passed at this commit (2026-11-24).
      command: `npx vitest related --run --maxWorkers=4 ${['!gate', ...BROWSER_PROJECTS.map((p) => `!${p}`)].map((p) => `--project='${p}'`).join(' ')} {files}; s=$?; if [ -n "$VERIFY_PROVEN" ]; then echo "skulkr: checks:gate passed at this commit in the fixer's own run; not run again"; else ${CHECKS} || s=1; fi; npm run -s check:unnameable -- --build {files} || s=1; exit $s`,
      gui: {
        probe: `npx vitest list --filesOnly ${BROWSER_PROJECTS.map((p) => `--project='${p}'`).join(' ')} {related}`,
        command: `npx vitest related --run --maxWorkers=2 ${BROWSER_PROJECTS.map((p) => `--project='${p}'`).join(' ')} {files}`,
      },
      timeoutMin: 30,
    },
    // Lint's safe fixes committed before a fixer's work is handed back, so a fixable finding (an import order) is fixed
    // rather than failed: biome from labkit, the one package it lints, on labkit's files; eslint on the rest.
    fixup: { command: FIXUP, message: 'apply the linters\' safe fixes' },
    // The checks once on the batch's tip, and on main's tip over a red result's failures, beside the last red gate's
    // test files outside the browser projects (and its browser ones in a GUI job beside it); the reporter prints the gate's `fleet-fail:` lines. The gate is then
    // told the checks ran (`test:fleet --no-checks`).
    preflight: {
      command: `npx vitest run --maxWorkers=4 --reporter=default --reporter=./scripts/vitest-fleet-fail.mjs ${BROWSER_PROJECTS.map((p) => `--project='!${p}'`).join(' ')} scripts/ci-checks.gate.ts {tests}`,
      // The last red gate's browser tests, at once on a GUI node.
      gui: {
        command: `npx vitest run --maxWorkers=2 --reporter=default --reporter=./scripts/vitest-fleet-fail.mjs ${BROWSER_PROJECTS.map((p) => `--project='${p}'`).join(' ')} {tests}`,
        project: '^(browser|forge-stories)',
      },
      gateArgs: ['--no-checks'],
      timeoutMin: 20,
    },
  },

  // `test:batch` checks the ref out into a throwaway worktree itself, so it runs from the main checkout.
  // Its two parallel runs: the tests, with unprefixed progress lines, and test:fleet:postbuild, prefixed `postbuild| `,
  // whose onto jobs are `postbuild-…`; each closes its log with `<script> passed|failed`.
  gate: {
    name: 'test:batch', command: ['npm', 'run', 'test:batch', '--', '{ref}'], cwd: 'root',
    progress: { tests: '', build: 'postbuild\\| ' },
    outcome: { tests: 'test:fleet', build: 'test:fleet:postbuild' },
    jobs: { build: '^postbuild-' },
    labels: { tests: 'fleet tests', build: 'postbuild' },
    failPrefix: 'fleet-fail:',
    failRun: { build: 'postbuild' },
    blame: blameStep,
  },

  setup: {
    prelude: NVM,
    install: { lockfile: 'package-lock.json', command: 'npm ci --no-audit --no-fund' },
  },

  runner: 'onto',
  // onto places each job on whichever node has room as it starts; what a node takes is its own onto policy (orochi,
  // this Mac, refuses `kind:fix` and is weighted low, and onto holds no job there while someone is using it).
  concurrency: { review: 18, fix: 18 },

  claude: {
    configDir: '~/.claude-msb',
    // Jobs start without the account's own settings, so the opus at medium effort those gave is named here (2026-11-20).
    // The scour's ledger matcher stays on the default opus: replaying 15 past matches, haiku and sonnet each got one
    // wrong where opus agreed on all, for a saving of about $0.05 a pass (`scripts/matcherTrial.mjs`, 2026-11-26).
    models: { review: 'opus', fix: 'opus', match: 'haiku' },
    effort: { review: 'medium', fix: 'medium' },
    timeoutMin: 45,
  },

  areasPerRound: 8,
  budget: { review: 8, match: 1, fix: 15, areaCapUsd: 10, areaGuessUsd: 10 },
  schedule: { startAt: '23:00', stopAt: '07:00' },
  // Local mode: the brief runs the whole gate through {{onFleet}}; run bare, several fixers' gates pegged this machine.
  local: { fleetOnly: ['npm run checks:gate'] },

  sweep,
  icons,
};

// Local mode keeps the fleet gate: only model calls need to stay on this machine.
export default config;
