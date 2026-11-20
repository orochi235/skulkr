/**
 * Model jobs on the fleet. Each job runs through the runner from the frozen tree, so the node's tree is the
 * frozen commit plus `.skulk/in`, in a tree name of its own (a slot) so jobs on one node never
 * share a tree. What a job writes under `.skulk/out` comes back to a local directory.
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JOB_IN, JOB_OUT, noFixers, nodesAt } from './config.mjs';
import { leaseAt, pidAlive, takeLease } from './lease.mjs';

export const BUSY_WAIT_MS = 30_000;

const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/** The progress filter, copied into each frozen tree's `.skulk/in` so a node runs the one this run ships. */
export const progressSource = () => fileURLToPath(new URL('./progress.mjs', import.meta.url));
export const PROGRESS_IN = `${JOB_IN}/progress.mjs`;
/** The config's `checks.tally`, beside the filter, for the fixer's checks. */
export const CHECKS_IN = `${JOB_IN}/checks.json`;

/**
 * Runs `claude -p` on a prompt file, stopped by an alarm before the runner's timeout so what it wrote still comes
 * home. With `progress` (the progress filter's arguments before the result path), it streams through the
 * filter, which prints onto progress lines and writes the same result envelope to `claude.json`.
 */
const claudeLine = (cfg, promptFile, budgetUsd, flags, progress) =>
  [
    ...(cfg.claude.configDir ? [`CLAUDE_CONFIG_DIR=${cfg.claude.configDir}`] : []),
    `perl -e 'alarm shift; exec @ARGV' ${cfg.claude.timeoutMin * 60}`,
    'claude -p "$(cat', `${q(promptFile)})"`,
    `--output-format ${progress ? 'stream-json --verbose' : 'json'} --strict-mcp-config`,
    ...(cfg.claude.settingSources ? [`--setting-sources ${cfg.claude.settingSources}`] : []),
    `--max-budget-usd ${budgetUsd}`, ...flags,
    progress
      ? `2> ${JOB_OUT}/claude.err | node ${PROGRESS_IN} ${progress} ${JOB_OUT}/claude.json; echo "\${PIPESTATUS[0]}" > ${JOB_OUT}/exit`
      : `> ${JOB_OUT}/claude.json 2> ${JOB_OUT}/claude.err; echo $? > ${JOB_OUT}/exit`,
  ].join(' ');

const model = (name) => (name ? ['--model', name] : []);
const effort = (level) => (level ? ['--effort', level] : []);
const fresh = `rm -rf ${JOB_OUT} && mkdir -p ${JOB_OUT}`;
const prelude = (cfg) => (cfg.setup.prelude ? [cfg.setup.prelude] : []);

/** A reviewer, counted through the files listed in `.skulk/in/<area>/files.txt`. */
export const reviewShell = (cfg, area, budgetUsd) =>
  [...prelude(cfg), fresh, claudeLine(cfg, `${JOB_IN}/${area}/review.md`, budgetUsd, [
    '--allowedTools', q(cfg.claude.reviewTools.join(',')), '--disallowedTools', q(cfg.claude.reviewDenied.join(',')), ...model(cfg.claude.models.review), ...effort(cfg.claude.effort?.review),
  ], q(`${JOB_IN}/${area}/files.txt`))].join(' && ');

export const matchShell = (cfg, area, budgetUsd) =>
  [fresh, claudeLine(cfg, `${JOB_IN}/${area}/match.md`, budgetUsd, ['--disallowedTools', q('Bash,Edit,Write,Task,Agent'), ...model(cfg.claude.models.match), ...effort(cfg.claude.effort?.match)])].join(' && ');

/** Installs when the lockfile changed since the tree's last install, or nothing when the config names no install. */
const installLines = (cfg) => {
  const install = cfg.setup.install;
  if (!install?.command) return [];
  if (!install.lockfile) return [`${install.command} > ${JOB_OUT}/install.log 2>&1`];
  const marker = install.marker ?? 'node_modules/.skulk-lock';
  return [
    `LOCK=$(shasum ${q(install.lockfile)} | cut -d" " -f1)`,
    `if [ "$(cat ${marker} 2>/dev/null)" != "$LOCK" ]; then ${install.command} > ${JOB_OUT}/npm-ci.log 2>&1 && echo "$LOCK" > ${marker}; fi`,
  ];
};

/**
 * The fixer commits the synced tree as it stands (it must hash to the frozen commit's tree), installs
 * when the lockfile changed since the tree's last install, lets the model fix and commit, and hands
 * back its commits as one mbox.
 */
export const fixShell = (cfg, area, budgetUsd, findings) =>
  [
    'set -e', ...prelude(cfg), fresh,
    'grep -qx ".skulk/" .git/info/exclude 2>/dev/null || echo ".skulk/" >> .git/info/exclude',
    'git add -A',
    'git -c user.name=skulk -c user.email=skulk@localhost commit -q --no-verify --allow-empty -m "skulk: frozen tree"',
    `if [ "$(git rev-parse 'HEAD^{tree}')" != "$FROZEN_TREE" ]; then echo "synced tree $(git rev-parse 'HEAD^{tree}') is not the frozen tree $FROZEN_TREE" > ${JOB_OUT}/tree-mismatch; exit 0; fi`,
    'BASE=$(git rev-parse HEAD)',
    ...installLines(cfg),
    'set +e',
    claudeLine(cfg, `${JOB_IN}/${area}/fix.md`, budgetUsd, ['--dangerously-skip-permissions', ...model(cfg.claude.models.fix), ...effort(cfg.claude.effort?.fix)], `--commits ${findings} --checks ${CHECKS_IN}`),
    `git format-patch --stdout "$BASE..HEAD" > ${JOB_OUT}/fix.mbox`,
    `git status --porcelain > ${JOB_OUT}/uncommitted.txt`,
    'exit 0',
  ].join('\n');

/**
 * Slots per node for `role`, read again at every lease from `<state>/limits.json` (`{ "review": n, "fix": n }`)
 * when it names one, so a change reaches runs already going; else the config's.
 */
export const slotsPerNode = (cfg, role) => {
  const fallback = role === 'fix' ? cfg.nodes.fixSlots : cfg.nodes.reviewSlots;
  try {
    const n = JSON.parse(readFileSync(join(cfg.state, 'limits.json'), 'utf8'))[role === 'fix' ? 'fix' : 'review'];
    return Number.isInteger(n) && n > 0 ? n : fallback;
  } catch {
    return fallback;
  }
};

/**
 * Slots: one tree name per concurrent job on a node, leased on disk under `<state>/slots/<node>/<tree>`
 * so every run on this machine shares them. `pinned` replaces the time-of-day node list; `about` goes into
 * each lease (the run's round).
 */
export const createSlots = (cfg, pinned, { about = {} } = {}) => {
  const held = new Set();
  const refusedUntil = new Map();
  const state = cfg.state;
  const noFix = noFixers(cfg);
  const take = (role, { now = new Date(), exclude = new Set() } = {}) => {
    const perNode = slotsPerNode(cfg, role);
    const prefix = role === 'fix' ? cfg.names.trees.fix : cfg.names.trees.review;
    // Fewest live leases of this role first, so jobs spread across nodes instead of filling the first.
    const busy = (node) => {
      const dir = join(state, 'slots', node);
      return existsSync(dir) ? readdirSync(dir).filter((t) => t.startsWith(prefix) && pidAlive(leaseAt(join(dir, t))?.pid)).length : 0;
    };
    const nodes = (pinned ?? nodesAt(cfg, now)).map((node, i) => ({ node, i, n: busy(node) })).sort((a, b) => a.n - b.n || a.i - b.i).map((e) => e.node);
    for (const node of nodes) {
      if (role === 'fix' && noFix.includes(node)) continue;
      if (exclude.has(node) || (refusedUntil.get(node) ?? 0) > now.getTime()) continue;
      for (let k = 1; k <= perNode; k++) {
        const tree = `${prefix}${k}`;
        const key = `${node}/${tree}`;
        const unlease = takeLease(join(state, 'slots', node, tree), { ...about, role });
        if (!unlease) continue;
        held.add(key);
        return {
          node, tree, release: () => {
            held.delete(key);
            unlease();
          },
        };
      }
    }
    return undefined;
  };
  const refuse = (node, now = Date.now()) => refusedUntil.set(node, now + cfg.nodes.refusedCooldownMin * 60_000);
  return { take, refuse, inUse: () => held.size };
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One runner job from `cwd`, tried again while its tree is busy; its output goes to `logPath`. Answers `{ status, refused }`. */
export const runUntilFree = async (runner, job, { cwd, logPath, waitMs = BUSY_WAIT_MS }) => {
  mkdirSync(job.to, { recursive: true });
  const log = createWriteStream(logPath, { flags: 'a' });
  try {
    for (;;) {
      const run = await runner.run(job, { cwd, log });
      if (run.busy) {
        await sleep(waitMs);
        continue;
      }
      return { status: run.status, refused: Boolean(run.refused) };
    }
  } finally {
    log.end();
  }
};

/**
 * One model job in `slot`; `expect` is the runner's `--expect`, a duration or `none`. Answers
 * `{ status, refused }`: `refused` when the node turned the job away as quiet or unavailable before
 * anything ran, so the caller tries another node.
 */
export const runJob = ({ cfg, runner, frozen, base, slot, kind, task, about, expect, env = {}, shell, to, logPath }) =>
  runUntilFree(runner, {
    kind, node: slot.node, tree: slot.tree, ref: base, timeout: `${cfg.claude.timeoutMin + 10}m`, expect, task, about,
    out: JOB_OUT, to, env, shell,
  }, { cwd: frozen, logPath });

export const jobDir = (nightDir, area, role) => join(nightDir, 'jobs', area, role);
