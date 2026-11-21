/**
 * Verify and repair: after a fixer's job, skulkr reads the verdict of the verify step that job ran itself, runs the
 * GUI part in a job of its own where the changes need it, and, while the verdict is failing, hands the failing output
 * to a repair job on the same area's commits, up to {@link MAX_REPAIRS} times. Nothing here reads the fixer's report.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brief, fill, projectVars } from './brief.mjs';
import { JOB_IN } from './config.mjs';
import { dispatch } from './dispatch.mjs';
import { AREA_MBOX, baselineShell, jobDir, repairShell, stoppedBeforeModel, timeoutOf, verifyShell } from './jobs.mjs';
import { failureExcerpt, needsGui, verdictIn, verdictText, verifyOf } from './verify.mjs';

export const MAX_REPAIRS = 2;

const patchesIn = (mbox) => (mbox && existsSync(mbox) ? (readFileSync(mbox, 'utf8').match(/^From [0-9a-f]{40} /gm) ?? []).length : 0);

/** Puts the area's commits so far where a node job applies them from: `.skulkr/in/<area>/area.mbox`. */
const stage = (ctx, id, mbox) => {
  const inDir = join(ctx.frozen, JOB_IN, id);
  mkdirSync(inDir, { recursive: true });
  copyFileSync(mbox, join(inDir, AREA_MBOX));
  return inDir;
};

const nodeEnv = (ctx, extra = []) => ({ FROZEN_TREE: ctx.frozenTree, ...ctx.identity, ...(extra.length ? { VERIFY_EXTRA: extra.join(' ') } : {}) });

/** The verify step alone on `mbox`, its GUI part with `gui`, in a job of its own. Answers its verdict. */
const verifyJob = async (ctx, area, mbox, { gui, label, extra }) => {
  stage(ctx, area.id, mbox);
  const to = jobDir(ctx.nightDir, area.id, `verify-${label}${gui ? '-gui' : ''}`);
  await dispatch(ctx, area, 'verify', {
    kind: 'test', expect: 'none', gui, shell: verifyShell(ctx.cfg, area.id, { gui }), to, env: nodeEnv(ctx, extra),
    task: ctx.cfg.names.task(ctx.round, area.id, 'verify'), logPath: join(to, '..', `verify-${label}${gui ? '-gui' : ''}.log`),
    timeoutMin: timeoutOf(ctx.cfg, { model: false }),
    about: `Runs ${gui ? 'the browser part of ' : ''}the verify step on audit round ${ctx.round}'s fixes to area ${area.id}.`,
  });
  return { ...verdictIn(to), dir: to, gui };
};

/**
 * Which of `verdict`'s failing test files fail on the frozen tree without any area's commits. Each file is checked
 * once a round, in a job of `area`'s that runs the same part of the verify step, and the answer kept on `ctx` for
 * every area after it: a failure the tree already has is no area's to repair.
 */
export const baselineFailures = async (ctx, area, verdict) => {
  const files = verdict.failedFiles ?? [];
  if (!files.length) return [];
  const known = (ctx.baseline ??= new Map());
  const key = (file) => `${verdict.gui ? 'gui' : 'plain'}\n${file}`;
  const unknown = files.filter((file) => !known.has(key(file)));
  if (unknown.length) {
    const to = jobDir(ctx.nightDir, area.id, `verify-baseline-${known.size}${verdict.gui ? '-gui' : ''}`);
    const ran = dispatch(ctx, area, 'verify', {
      kind: 'test', expect: 'none', gui: Boolean(verdict.gui), shell: baselineShell(ctx.cfg, { gui: verdict.gui }), to,
      env: nodeEnv(ctx, unknown), task: ctx.cfg.names.task(ctx.round, area.id, 'verify'), logPath: `${to}.log`,
      timeoutMin: timeoutOf(ctx.cfg, { model: false }),
      about: `Checks whether the tests that failed on audit round ${ctx.round}'s fixes to ${area.id} fail on the frozen tree without them.`,
    }).then(() => verdictIn(to), (error) => {
      ctx.say(`verify ${area.id}: the frozen-tree check failed (${error.message ?? error}); its files stay the area's`);
      return { unrun: true };
    });
    // A baseline run that gave no file-level answer, or none at all, clears nothing: those files stay the area's.
    for (const file of unknown) known.set(key(file), ran.then((v) => !v.unrun && v.counts !== undefined && v.failedFiles.includes(file)));
  }
  const fails = await Promise.all(files.map((file) => known.get(key(file))));
  return files.filter((_, i) => fails[i]);
};

/**
 * `verdict` with the failures the frozen tree already has set aside, naming them in `baseline`: passing only when
 * every failing file is one of them and the failing files account for the whole failure, so a non-zero exit from
 * an unhandled error or a command after the tests still fails.
 */
export const judged = async (ctx, area, verdict) => {
  if (verdict.ok || verdict.timedOut || verdict.unrun) return verdict;
  const baseline = await baselineFailures(ctx, area, verdict);
  if (!baseline.length) return verdict;
  const own = verdict.failedFiles.filter((file) => !baseline.includes(file));
  if (own.length) return { ...verdict, failedFiles: own, baseline };
  const accounted = verdict.counts?.failed === verdict.failedFiles.length && !verdict.unhandled;
  if (accounted) return { ...verdict, ok: true, failedFiles: [], baseline };
  return { ...verdict, failedFiles: [], baseline, why: verdict.unhandled ? 'unhandled errors outside the test files' : `exited ${verdict.exit} beyond the failing test files` };
};

/**
 * The verdict on the commits a model job left in `dir` (its mbox `mbox`): the one that job ran, or one run now where
 * it left none, then the GUI part where the changes need it and the rest passed; `extra` are files checked beside
 * the changed ones.
 */
export const checkedIn = async (ctx, area, dir, mbox, label, extra = []) => {
  const verify = verifyOf(ctx.cfg);
  let plain = { ...verdictIn(dir), dir };
  if (plain.unrun) plain = await verifyJob(ctx, area, mbox, { gui: false, label, extra });
  plain = await judged(ctx, area, plain);
  if (!plain.ok || !needsGui(verify, plain.dir)) return plain;
  const gui = await judged(ctx, area, await verifyJob(ctx, area, mbox, { gui: true, label, extra }));
  const sum = (k) => (plain.counts?.[k] ?? 0) + (gui.counts?.[k] ?? 0);
  const counts = plain.counts || gui.counts ? { failed: sum('failed'), passed: sum('passed'), total: sum('total') } : undefined;
  const baseline = [...(plain.baseline ?? []), ...(gui.baseline ?? [])];
  return { ...gui, ok: gui.ok, counts, failedFiles: gui.failedFiles, files: plain.files, guiRan: true, ...(baseline.length ? { baseline } : {}) };
};

/**
 * One repair job on `area`'s commits `mbox`, given `log`, the failing output, and asked to make it pass; `extra` are
 * files its verify step checks beside the ones the commits change. Answers the job's result, the mbox now holding
 * every commit of the area, how many commits the repair added, and the directory its verdict is in.
 */
export const repairJob = async (ctx, area, { mbox, log, label, attempt, extra = [], baseline = [] }) => {
  const inDir = stage(ctx, area.id, mbox);
  writeFileSync(join(inDir, 'verify.log'), log);
  const vars = {
    ...projectVars(ctx.cfg, 'repair'), round: ctx.round, area: area.id, attempt, command: verifyOf(ctx.cfg).command,
    failures: failureExcerpt(log), log: `${JOB_IN}/${area.id}/verify.log`,
    baseline: baseline.length
      ? `These failing files fail on the frozen tree without the area's commits too, so they are not yours to repair; leave them: ${baseline.map((f) => `\`${f}\``).join(', ')}.`
      : '',
  };
  writeFileSync(join(inDir, 'repair.md'), fill(brief(ctx.cfg, 'repair'), vars));
  const to = jobDir(ctx.nightDir, area.id, `repair-${label}`);
  const run = await dispatch(ctx, area, 'repair', {
    kind: 'fix', expect: 'none', shell: repairShell(ctx.cfg, area.id, ctx.budget.fix), to, env: nodeEnv(ctx, extra),
    task: ctx.cfg.names.task(ctx.round, area.id, 'repair'), logPath: join(to, '..', `repair-${label}.log`), timeoutMin: timeoutOf(ctx.cfg),
    about: `Repairs audit round ${ctx.round}'s fixes to area ${area.id}, whose tests fail, without weakening the tests.`,
  });
  const stopped = stoppedBeforeModel(to);
  if (stopped) ctx.say(`repair ${area.id}: ${stopped}`);
  const next = join(to, 'fix.mbox');
  const total = patchesIn(next);
  const had = patchesIn(mbox);
  return { ...run, to, mbox: total >= had && total > 0 ? next : mbox, added: Math.max(0, total - had) };
};

/**
 * Checks what a fixer committed and repairs it until its verdict passes or {@link MAX_REPAIRS} repairs have run.
 * `fixed` is `fix`'s result and `dir` its job's directory. Answers `{ ok, mbox, verify, repairs, usage }`: `verify`
 * the last verdict's summary, `repairs` each repair's `{ node, added, minutes, ok }`, and `usage` their records.
 */
export const verifyAndRepair = async (ctx, area, fixed, dir) => {
  let mbox = fixed.mbox;
  let verdict = await checkedIn(ctx, area, dir, mbox, 'fix');
  ctx.say(`verify ${area.id}: ${verdictText(verdict)}`);
  const repairs = [];
  const usage = [];
  // A run that timed out says nothing a repair could act on; the area lands, and the capstone is its check.
  while (!verdict.ok && !verdict.timedOut && repairs.length < MAX_REPAIRS) {
    const attempt = repairs.length + 1;
    const run = await repairJob(ctx, area, { mbox, log: verdict.log, label: String(attempt), attempt, baseline: verdict.baseline });
    if (run.usage) usage.push(run.usage);
    mbox = run.mbox;
    verdict = await checkedIn(ctx, area, run.to, mbox, `repair-${attempt}`);
    repairs.push({ node: run.node, added: run.added, minutes: Number(run.minutes.toFixed(1)), ok: verdict.ok });
    ctx.say(`repair ${area.id} ${attempt}/${MAX_REPAIRS} on ${run.node}: ${run.added} commits, ${run.minutes.toFixed(1)} min; verify ${verdict.ok ? 'passed' : verdictText(verdict)}`);
  }
  if (verdict.timedOut) ctx.say(`verify ${area.id}: timed out unverified; kept for the capstone to check`);
  else if (!verdict.ok) ctx.say(`verify ${area.id}: still failing after ${repairs.length} repairs; left out of the batch`);
  return { ok: verdict.ok, mbox, verify: summaryOf(verdict), repairs, usage };
};

/** A verdict as the area's record keeps it. */
export const summaryOf = (v) => ({
  ok: v.ok, ...(v.ok ? {} : { why: v.why }), ...(v.timedOut ? { timedOut: true } : {}), files: v.files?.length ?? 0, ...(v.counts ? { testFiles: v.counts } : {}),
  ...(v.failedFiles?.length ? { failedFiles: v.failedFiles.slice(0, 20) } : {}), ...(v.guiRan ? { gui: true } : {}),
  ...(v.baseline?.length ? { baseline: v.baseline.slice(0, 20) } : {}),
});

/**
 * Which of `files`, test files a red gate named, fail on the frozen tree too: the verify step's plain part first, then
 * its GUI part for the rest, each in a job of the round's `gate` lane.
 */
export const gateBaseline = (ctx) => async (files) => {
  const gate = { id: 'gate' };
  const plain = await baselineFailures(ctx, gate, { failedFiles: files, gui: false });
  const rest = files.filter((f) => !plain.includes(f));
  const gui = rest.length && verifyOf(ctx.cfg)?.gui ? await baselineFailures(ctx, gate, { failedFiles: rest, gui: true }) : [];
  return [...plain, ...gui];
};
