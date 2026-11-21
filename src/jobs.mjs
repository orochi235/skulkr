/**
 * Model jobs on the fleet. Each job runs through the runner from the frozen tree, so the node's tree is the
 * frozen commit plus `.skulkr/in`, in one of onto's pooled trees, which no other running job holds. What a job writes under `.skulkr/out` comes back to a local directory.
 */
import { createWriteStream, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { JOB_IN, JOB_OUT } from './config.mjs';
import { sleep } from './after.mjs';
import { q, readIf } from './text.mjs';
import { verifyLines, verifyOf } from './verify.mjs';
import { agentFor } from './agent/index.mjs';

export const BUSY_WAIT_MS = 30_000;


/** The config's `checks.tally`, beside the progress filter, for the fixer's checks. */
export const CHECKS_IN = `${JOB_IN}/checks.json`;

/** The file a model job writes just before its agent starts: a job with it and no `exit` ran and was cut off. */
export const STARTED = 'started';

/** The agent the config names for `role`, run on `promptFile` after writing {@link STARTED}. */
const agentLine = (cfg, role, promptFile, budgetUsd, progress) =>
  `date -u +%FT%TZ > ${JOB_OUT}/${STARTED} && ${agentFor(cfg, role).line(cfg, role, { promptFile, budgetUsd, progress })}`;

const fresh = `rm -rf ${JOB_OUT} && mkdir -p ${JOB_OUT}`;
const prelude = (cfg) => (cfg.setup.prelude ? [cfg.setup.prelude] : []);

/** A reviewer, counted through the files listed in `.skulkr/in/<area>/files.txt`. */
export const reviewShell = (cfg, area, budgetUsd) =>
  [...prelude(cfg), fresh, agentLine(cfg, 'review', `${JOB_IN}/${area}/review.md`, budgetUsd, q(`${JOB_IN}/${area}/files.txt`))].join(' && ');

export const matchShell = (cfg, area, budgetUsd) =>
  [fresh, agentLine(cfg, 'match', `${JOB_IN}/${area}/match.md`, budgetUsd)].join(' && ');

/**
 * Files a job writes under its output when it stops before the model runs, each holding why: the synced tree is not
 * the frozen one, or the install failed.
 */
export const STOPPED_BEFORE_MODEL = ['tree-mismatch', 'install-failed'];

/** Why the job in `dir` stopped before its model ran, or '' when it did not. */
export const stoppedBeforeModel = (dir) => STOPPED_BEFORE_MODEL.map((f) => readIf(join(dir, f)).trim()).filter(Boolean).join('; ');

/**
 * Installs when the lockfile changed since the tree's last install, or nothing when the config names no install. A
 * failed install stops the job before the model runs.
 */
export const installLines = (cfg) => {
  const install = cfg.setup.install;
  if (!install?.command) return [];
  const run = `if ! ${install.command} > ${JOB_OUT}/install.log 2>&1; then echo ${q(`install failed: ${install.command}; see install.log`)} > ${JOB_OUT}/install-failed; exit 0; fi`;
  if (!install.lockfile) return [run];
  const marker = install.marker ?? 'node_modules/.skulkr-lock';
  return [
    `LOCK=$(shasum ${q(install.lockfile)} | cut -d" " -f1)`,
    `if [ "$(cat ${marker} 2>/dev/null)" != "$LOCK" ]; then`,
    `  ${run}`,
    `  echo "$LOCK" > ${marker}`,
    'fi',
  ];
};

/**
 * Readies a node tree for a job that commits: the synced tree committed as it stands (it must hash to the frozen
 * commit's tree), `BASE` set to that commit, and an install when the lockfile changed since the tree's last one.
 */
const treeLines = (cfg) => [
  'grep -qx ".skulkr/" .git/info/exclude 2>/dev/null || echo ".skulkr/" >> .git/info/exclude',
  'git add -A',
  'git -c user.name=skulkr -c user.email=skulkr@localhost commit -q --no-verify --allow-empty -m "skulkr: frozen tree"',
  `if [ "$(git rev-parse 'HEAD^{tree}')" != "$FROZEN_TREE" ]; then echo "synced tree $(git rev-parse 'HEAD^{tree}') is not the frozen tree $FROZEN_TREE" > ${JOB_OUT}/tree-mismatch; exit 0; fi`,
  'BASE=$(git rev-parse HEAD)',
  ...installLines(cfg),
];

/** The area's commits so far, `.skulkr/in/<area>/area.mbox`, applied on the frozen tree; a job whose patches do not
 *  apply stops there with a failing verdict. */
export const AREA_MBOX = 'area.mbox';
const applyLines = (area) => [
  `if ! git am -q --3way --keep-cr ${q(`${JOB_IN}/${area}/${AREA_MBOX}`)} > ${JOB_OUT}/am.log 2>&1; then git am --abort; `
    + `echo "the area's patches did not apply" > ${JOB_OUT}/verify.log; echo 1 > ${JOB_OUT}/verify.exit; exit 0; fi`,
];

/** A model job's hand-back: its commits since `BASE` as one mbox and what it left uncommitted, then the verify step. */
const handBackLines = (cfg) => {
  const verify = verifyOf(cfg);
  return [
    `git format-patch --stdout "$BASE..HEAD" > ${JOB_OUT}/fix.mbox`,
    `git status --porcelain > ${JOB_OUT}/uncommitted.txt`,
    ...(verify ? verifyLines(verify) : []),
    'exit 0',
  ];
};

/**
 * The fixer readies the tree, lets the model fix and commit, hands back its commits as one mbox, and runs the
 * config's verify step over the files they changed.
 */
export const fixShell = (cfg, area, budgetUsd, findings) =>
  [
    'set -e', ...prelude(cfg), fresh, ...treeLines(cfg), 'set +e',
    agentLine(cfg, 'fix', `${JOB_IN}/${area}/fix.md`, budgetUsd, `--commits ${findings} --checks ${CHECKS_IN}`),
    ...handBackLines(cfg),
  ].join('\n');

/** A repair: the area's commits applied, the model given `repair.md`, and every commit since the frozen tree handed
 *  back and verified, as a fixer's are. */
export const repairShell = (cfg, area, budgetUsd) =>
  [
    'set -e', ...prelude(cfg), fresh, ...treeLines(cfg), ...applyLines(area), 'set +e',
    agentLine(cfg, 'fix', `${JOB_IN}/${area}/repair.md`, budgetUsd),
    ...handBackLines(cfg),
  ].join('\n');

/** The verify step alone on the area's commits: its GUI part with `gui`, else the part a model job runs itself. */
export const verifyShell = (cfg, area, { gui = false } = {}) => {
  const verify = verifyOf(cfg);
  return [
    'set -e', ...prelude(cfg), fresh, ...treeLines(cfg), ...applyLines(area), 'set +e',
    ...verifyLines(verify, gui ? { command: verify.gui.command, probe: null } : {}),
    'exit 0',
  ].join('\n');
};

/**
 * The verify step on the frozen tree alone, no area's commits applied, over `$VERIFY_EXTRA`: which of the test files
 * an area's verify failed on fail without its commits too. Its GUI part with `gui`.
 */
export const baselineShell = (cfg, { gui = false } = {}) => {
  const verify = verifyOf(cfg);
  return [
    'set -e', ...prelude(cfg), fresh, ...treeLines(cfg), 'set +e',
    ...verifyLines(verify, gui ? { command: verify.gui.command, probe: null } : { probe: null }),
    'exit 0',
  ].join('\n');
};

/** A job's runner timeout in minutes: its model's, plus the verify step's where the job runs one. */
export const timeoutOf = (cfg, { model = true, verify = Boolean(verifyOf(cfg)) } = {}) =>
  (model ? agentFor(cfg, 'fix').timeoutMin(cfg) : 0) + (verify ? (verifyOf(cfg).timeoutMin ?? 20) + 5 : 0) + 10;

/** One runner job from `cwd`, tried again while its tree is busy; its output goes to `logPath`. Answers `{ status, refused, noRoom, node? }`. */
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
      return { status: run.status, refused: Boolean(run.refused), noRoom: Boolean(run.noRoom), ...(run.node ? { node: run.node } : {}) };
    }
  } finally {
    // Flushed before the caller reads the log back for why a launch failed.
    await new Promise((resolve) => {
      log.once('error', resolve);
      log.end(resolve);
    });
  }
};

/**
 * One job in `slot`; `expect` is the runner's `--expect`, a duration or `none`; `gui` asks for a node's GUI session. Answers
 * `{ status, refused }`: `refused` when the node turned the job away as quiet or unavailable before
 * anything ran, so the caller tries another node.
 */
export const runJob = ({ cfg, runner, frozen, base, slot, kind, task, about, expect, env = {}, shell, to, logPath, gui, timeoutMin = agentFor(cfg, kind === 'review' ? 'review' : 'fix').timeoutMin(cfg) + 10 }) =>
  runUntilFree(runner, {
    kind, node: slot.placed ? undefined : slot.node, ref: base, timeout: `${timeoutMin}m`, expect, task, about,
    out: JOB_OUT, to, env, shell, ...(gui ? { gui: true } : {}),
  }, { cwd: frozen, logPath });

export const jobDir = (nightDir, area, role) => join(nightDir, 'jobs', area, role);
