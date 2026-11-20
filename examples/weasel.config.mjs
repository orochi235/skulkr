/**
 * weasel's skulkr config: reproduces the nightly audit weasel's own `scripts/skulk` ran up to round 49. At cutover it
 * becomes `skulkr.config.mjs` at weasel's root, with `weasel/` beside this file moved to `scripts/audit/` and the
 * three `./weasel/` paths below changed to match (README.md "Moving weasel over").
 */
import { sweep } from './weasel/sweep.mjs';

const NVM = 'export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"; . "$NVM_DIR/nvm.sh" >/dev/null; nvm use >/dev/null';

export default {
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
    dir: 'docs/audits',
    intro: [
      'Blind pairs at `{{commit}}` ({{date}}), run by `scripts/skulk`. Each area\'s directory holds its file',
      'list (`files.txt`), both reviewers\' findings (`A.md`, `B.md`), the matching (`match.json`), the fixer\'s',
      'report (`fix.md`) and the numbers below (`area.json`). The method is `docs/hardening.md`, "Blind pairs".',
      '',
      '"Read" is how many listed files each reviewer says it read. "Est." is Chapman\'s estimate of what the area held,',
      '"left" that less the distinct findings, and "last left" the previous pass\'s figure, which this pass tests.',
      '"New code" counts findings citing a file changed since that pass. "Commits" is what the fixer committed.',
      '"Weighted tokens" counts each kind of token at its price against an input token (`TOKEN_WEIGHTS` in `scripts/skulk/usage.mjs`); "cost" is list price.',
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
          + `Run by \`scripts/skulk\` with one file list per area; raw lists in \`docs/audits/round-${round}/\`. A/B/shared and Chapman's estimate per area: ${each}. |`;
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
  },

  // `test:batch` checks the ref out into a throwaway worktree itself, so it runs from the main checkout.
  // Its two parallel runs: the tests, with unprefixed progress lines, and test:fleet:postbuild, prefixed `postbuild| `,
  // whose onto jobs are `postbuild-…`; each closes its log with `<script> passed|failed`.
  gate: {
    name: 'test:batch', command: ['npm', 'run', 'test:batch', '--', '{ref}'], cwd: 'root',
    progress: { tests: '', build: 'postbuild\\| ' },
    outcome: { tests: 'test:fleet', build: 'test:fleet:postbuild' },
    jobs: { build: '^postbuild-' },
    failPrefix: 'fleet-fail:',
    failRun: { build: 'postbuild' },
  },

  setup: {
    prelude: NVM,
    install: { lockfile: 'package-lock.json', command: 'npm ci --no-audit --no-fund' },
  },

  runner: 'onto',
  nodes: {
    // Logged into the personal Claude account (`CLAUDE_CONFIG_DIR=~/.claude-msb`).
    list: ['studio', 'teitou', 'msb-uai'],
    // This Mac takes model jobs only overnight, and never a fixer.
    local: { name: 'orochi', from: '00:00', until: '09:00', fixers: false },
    noFixers: [],
    refusedCooldownMin: 30,
    reviewSlots: 6,
    fixSlots: 6,
  },

  claude: {
    configDir: '~/.claude-msb',
    // Jobs start without the account's own settings, so the opus at medium effort those gave is named here (2026-11-20).
    models: { review: 'opus', fix: 'opus', match: 'haiku' },
    effort: { review: 'medium', fix: 'medium' },
    timeoutMin: 45,
  },

  areasPerRound: 16,
  budget: { review: 8, match: 1, fix: 15, capUsd: 160, areaGuessUsd: 10 },
  schedule: { startAt: '23:00', stopAt: '07:00' },

  sweep,
};
