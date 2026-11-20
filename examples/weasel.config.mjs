/**
 * weasel's skulk config: reproduces the nightly audit weasel's own `scripts/skulk` ran up to round 49. At cutover it
 * becomes `skulk.config.mjs` at weasel's root, with `weasel/` beside this file moved to `scripts/audit/` and the
 * three `./weasel/` paths below changed to match (README.md "Moving weasel over").
 */
import { sweep } from './weasel/sweep.mjs';

const NVM = 'export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"; . "$NVM_DIR/nvm.sh" >/dev/null; nvm use >/dev/null';

export default {
  name: 'weasel',
  // Unset `root` is the main worktree of the repo holding this file; from x-skulk, pass --root ~/src/weasel.
  state: '~/.local/state/weasel-skulk',
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

  // `test:batch` checks the ref out into a throwaway worktree itself, so it runs from the main checkout.
  gate: { name: 'test:batch', command: ['npm', 'run', 'test:batch', '--', '{ref}'], cwd: 'root' },

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
    models: { review: undefined, fix: undefined, match: 'haiku' },
    timeoutMin: 45,
  },

  areasPerRound: 16,
  budget: { review: 8, match: 1, fix: 15, capUsd: 160, areaGuessUsd: 10 },
  schedule: { startAt: '23:00', stopAt: '07:00' },

  sweep,
};
