/**
 * The checks a batch passes before its gate joins the fleet queue, and the same checks on `main`'s tip over a red
 * result's failures (README "Preflight"). Each runs as a job of the round's gate lane, from a local tree at the commit
 * it checks; its output marks failures with the gate's `failPrefix` lines, so a red preflight reads as a red gate.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { stripAnsi } from './ansi.mjs';
import { addWorktree, gitIn, removeWorktree } from './batch.mjs';
import { JOB_OUT } from './config.mjs';
import { dispatch } from './dispatch.mjs';
import { failedWhereIn, failLinesIn } from './gate.mjs';
import { jobDir, treeLines } from './jobs.mjs';
import { q, readIf } from './text.mjs';
import { TIMED_OUT, isTestPath } from './verify.mjs';

/** The config's preflight, or undefined when it names none. */
export const preflightOf = (cfg) => (cfg.checks?.preflight?.command ? cfg.checks.preflight : undefined);

/**
 * A node job running the preflight (its GUI part with `gui`) on the synced tree, readied as a fixer's is
 * (`treeLines`: it must hash to `$FROZEN_TREE`), over `$PREFLIGHT_TESTS`; it writes `verify.log` and `verify.exit`
 * under the job's output, as a verify job does.
 */
export const preflightShell = (cfg, { gui = false } = {}) => {
  const pre = preflightOf(cfg);
  const command = gui ? pre.gui.command : pre.command;
  return [
    'set -e', ...(cfg.setup.prelude ? [cfg.setup.prelude] : []), `rm -rf ${JOB_OUT} && mkdir -p ${JOB_OUT}`, ...treeLines(cfg),
    'set +e',
    'export PREFLIGHT_TESTS',
    `perl -e 'alarm shift; exec @ARGV' ${(pre.timeoutMin ?? 20) * 60} bash -c ${q(command.replaceAll('{tests}', '$PREFLIGHT_TESTS'))} > ${JOB_OUT}/verify.log 2>&1; echo $? > ${JOB_OUT}/verify.exit`,
    'exit 0',
  ].join('\n');
};

/**
 * The test files a red log's failure lines name, split by where they run: `gui`, those whose line's project (its first
 * word) the preflight's `gui.project` matches, and `plain` the rest. Without a GUI part every file is plain.
 */
export const testsToRerun = (text, cfg) => {
  const re = preflightOf(cfg)?.gui?.project ? new RegExp(preflightOf(cfg).gui.project) : null;
  const plain = new Set();
  const gui = new Set();
  for (const key of failureKeysIn(text, cfg.gate)) {
    if (!key.includes(' :: ')) continue;
    const [project, file] = key.split(' :: ')[0].split(' ');
    if (!file || !isTestPath(file)) continue;
    (re?.test(project) ? gui : plain).add(file);
  }
  return { plain: [...plain], gui: [...gui] };
};

/** One part of the preflight as job `label`: answers `{ exit, text }`, `exit` NaN where it left none. */
const runPart = async (ctx, { tree, commit, tests, label, gui }) => {
  const { cfg, root, nightDir } = ctx;
  const git = gitIn(root);
  const to = jobDir(nightDir, 'gate', label);
  const job = { ...ctx, frozen: tree, base: git('merge-base', commit, `${cfg.git.remote}/${cfg.git.main}`) };
  try {
    await dispatch(job, { id: 'gate' }, 'verify', {
      kind: 'test', expect: 'none', gui, shell: preflightShell(cfg, { gui }), to, logPath: `${to}.log`,
      env: { FROZEN_TREE: git('rev-parse', `${commit}^{tree}`), PREFLIGHT_TESTS: tests.join(' ') },
      task: cfg.names.task(ctx.round, 'gate', 'verify'), timeoutMin: (preflightOf(cfg).timeoutMin ?? 20) + 15,
      about: `Runs ${gui ? 'the browser tests the last red gate failed' : 'the checks'} on audit round ${ctx.round}'s batch, or ${cfg.git.main}'s tip, before the fleet gate.`,
    });
  } catch (error) {
    ctx.say(`preflight ${label}: did not run (${error.message ?? error})`);
    return { exit: Number.NaN, text: '' };
  }
  return { exit: Number.parseInt(readIf(join(to, 'verify.exit')).trim(), 10), text: readIf(join(to, 'verify.log')) };
};

/**
 * The preflight on `commit` checked out at `tree` (a local worktree), as job `label` of the gate lane: the checks with
 * `tests.plain` beside them, and, at once on a GUI node, the config's GUI part over `tests.gui`. Answers
 * `{ ok, unrun, log }`: `log` the path of both parts' output in `nightDir`, `unrun` when a part gave no verdict (it
 * never ran, timed out, or failed naming no failure), which says nothing of the commit.
 */
export const runPreflight = async (ctx, { tree, commit, tests = /** @type {{ plain: string[], gui: string[] }} */ ({ plain: [], gui: [] }), label }) => {
  const { cfg, nightDir } = ctx;
  const gui = preflightOf(cfg).gui?.command ? tests.gui : [];
  const parts = await Promise.all([
    runPart(ctx, { tree, commit, tests: tests.plain, label, gui: false }),
    ...(gui.length ? [runPart(ctx, { tree, commit, tests: gui, label: `${label}-gui`, gui: true })] : []),
  ]);
  const log = join(nightDir, `${label}.preflight.log`);
  writeFileSync(log, parts.map((p) => p.text).join('\n'));
  const unrun = parts.some((p) => !Number.isInteger(p.exit) || p.exit === TIMED_OUT || (p.exit !== 0 && !failedWhereIn(p.text, cfg.gate).length));
  return { ok: parts.every((p) => p.exit === 0), unrun, log };
};

/** Each failure a gate log's text names, as its `failPrefix` line gives it: a test's line or a step's, once each. */
export const failureKeysIn = (text, gate) => [...new Set(failLinesIn(stripAnsi(text).split('\n'), gate))];

/**
 * The preflight on `main`'s tip over the failures of the red log at `logPath`: which fail there too. Answers
 * `{ tip, keys, where }`, the tip checked, the failure lines it shares, and the files or steps those name; null when
 * the check gave no verdict, so nothing is set aside.
 */
export const failingOnMain = async (ctx, logPath) => {
  const { cfg, root } = ctx;
  const text = readFileSync(logPath, 'utf8');
  const keys = failureKeysIn(text, cfg.gate);
  if (!keys.length) return null;
  const tip = gitIn(root)('rev-parse', cfg.git.main);
  const tests = testsToRerun(text, cfg);
  const tree = addWorktree(root, `${cfg.naming.prefix}${ctx.round}-main-check`, tip);
  try {
    const ran = await runPreflight(ctx, { tree, commit: tip, tests, label: `main-${tip.slice(0, 10)}` });
    if (ran.unrun) {
      ctx.say(`main: the check on ${cfg.git.main}'s tip ${tip.slice(0, 10)} gave no verdict; every failure stays the batch's`);
      return null;
    }
    const there = new Set(failureKeysIn(readFileSync(ran.log, 'utf8'), cfg.gate));
    const shared = keys.filter((k) => there.has(k));
    return { tip, keys: shared, where: [...new Set(failedWhereIn(shared.map((k) => `${cfg.gate.failPrefix} ${k}`).join('\n'), cfg.gate))] };
  } finally {
    removeWorktree(root, tree);
  }
};

/** The red log at `logPath` less the failure lines `keys`, written beside it as `<log>.own`; answers its path. */
export const withoutKeys = (logPath, keys, gate) => {
  const drop = new Set(keys);
  const own = stripAnsi(readFileSync(logPath, 'utf8')).split('\n').filter((l) => !(l.startsWith(gate.failPrefix) && drop.has(l.slice(gate.failPrefix.length).trim())));
  const path = `${logPath}.own`;
  writeFileSync(path, own.join('\n'));
  return path;
};

/**
 * What `main` failing too reads as in the round's report: each file or step, with the commit that last touched it
 * (the paths `gate.blame` names for a step, the file itself for a test).
 */
export const mainRedText = (cfg, root, onMain, logText) => {
  const git = gitIn(root);
  const last = (paths) => {
    if (!paths.length) return '';
    try {
      return git('log', '-1', '--format=%h %s', onMain.tip, '--', ...paths);
    } catch {
      return '';
    }
  };
  const each = onMain.where.slice(0, 3).map((w) => {
    const paths = isTestPath(w) ? [w] : (cfg.gate.blame?.(logText, w) ?? []);
    const by = last(paths);
    return by ? `${w}, last touched by ${by}` : w;
  });
  const more = onMain.where.length > 3 ? `, and ${onMain.where.length - 3} more` : '';
  return `${cfg.git.main} red at ${onMain.tip.slice(0, 10)}: ${onMain.keys.length} failures it has too (${each.join('; ')}${more})`;
};

/**
 * One test of the batch at `tip`, checks first where `checks` is given (`checksFor`): the preflight with `rerun`, the
 * last red result's test files; then, unless it fails for the batch's own commits, the gate through `gate(extra)`,
 * told the checks ran where they passed (`gateArgs`). A red result's failures are checked on `main`'s tip. Answers the
 * gate's result, red with `{ report, log }`, plus `own`, the log less what `main` fails too, and `onMain`, what it
 * does; a preflight whose every failure `main` has goes on to the gate, and its `onMain` stays on the result.
 */
export const testChecked = async ({ cfg, checks, batch, tip, rerun = /** @type {{ plain: string[], gui: string[] }} */ ({ plain: [], gui: [] }), tag, gate, say }) => {
  if (!checks) return gate([]);
  const pre = await checks.preflight({ tree: batch.tree, commit: tip, tests: rerun, label: `preflight${tag}-${tip.slice(0, 10)}` });
  let extra = [];
  let preMain = null;
  if (pre.ok) {
    say(`preflight: passed on ${tip.slice(0, 10)}${rerun.plain.length + rerun.gui.length ? `, with ${rerun.plain.length + rerun.gui.length} test files the last red result failed` : ''}`);
    extra = checks.gateArgs;
  } else if (pre.unrun) say('preflight: gave no verdict, so the gate runs the checks');
  else {
    const onMain = await checks.onMain(pre.log);
    const own = onMain?.keys.length ? withoutKeys(pre.log, onMain.keys, cfg.gate) : pre.log;
    if (failureKeysIn(readFileSync(own, 'utf8'), cfg.gate).length) {
      say(`preflight: failed on ${tip.slice(0, 10)}; its log is ${pre.log}`);
      return { batch, tip, log: pre.log, own, onMain, report: `red: the preflight failed on ${batch.name}, which is kept; logs in ${dirname(pre.log)}` };
    }
    say(`preflight: every failure fails on ${cfg.git.main}'s tip too; the gate runs the tests`);
    extra = checks.gateArgs;
    preMain = onMain;
  }
  const tested = await gate(extra);
  if (!tested.report) return { ...tested, onMain: preMain };
  const onMain = await checks.onMain(tested.log);
  return { ...tested, own: onMain?.keys.length ? withoutKeys(tested.log, onMain.keys, cfg.gate) : tested.log, onMain: onMain ?? preMain };
};


/** The `checks` `testChecked` takes, for the round in `ctx`, or undefined where the config names no preflight. */
export const checksFor = (ctx) => (preflightOf(ctx.cfg) ? {
  preflight: (args) => runPreflight(ctx, args),
  onMain: (log) => failingOnMain(ctx, log),
  gateArgs: preflightOf(ctx.cfg).gateArgs ?? [],
} : undefined);
