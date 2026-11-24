/**
 * The gate on a batch: run in its turn in the fleet queue, `main` merged in when it moves, and its log read for what
 * failed. `land.mjs` decides what to do with the result.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { catchUpWithMain, runGate } from './batch.mjs';
import { failedWhereIn } from './gate.mjs';
import { fleetDir, waitForFleet } from './fleet.mjs';
import { isTestPath } from './verify.mjs';

/** How many times a green batch merges a moved main in and tests again before leaving the fast-forward to fail. */
const MAIN_CATCH_UPS = 2;

/** `<dir>/<name><suffix>`, or with `.r2`, `.r3`… before `suffix` where an earlier run of the round (a resumed one's)
 *  left that file: the gate appends to its log, and progress read from a log holding two runs reads the first. */
export const freshLog = (dir, name, suffix) => {
  for (let n = 1; ; n++) {
    const path = join(dir, `${name}${n === 1 ? '' : `.r${n}`}${suffix}`);
    if (!existsSync(path)) return path;
  }
};

/** How many failures the gate log at `log` names (`failedWhereIn`); 0 where it cannot be read. */
export const failuresIn = (log, gate) => {
  try {
    return failedWhereIn(readFileSync(log, 'utf8'), gate).length;
  } catch {
    return 0;
  }
};

/** Whether the gate log at `log` names no failure though the gate failed: only where the gate marks its failures. */
const crashedIn = (log, gate) => {
  if (!gate.failPrefix) return false;
  try {
    return failedWhereIn(readFileSync(log, 'utf8'), gate).length === 0;
  } catch {
    return false;
  }
};

/** Tests the batch with the config's gate, merging a moved `main` in first and between passes. Where that merge
 *  conflicts, `rebuild` makes the batch again on the new `main`, leaving out the branches that now conflict, and the
 *  round goes on with the rest. Answers the batch and the tip to land, or, red, the batch, its gate log, and `{ report }`;
 *  `tag` marks the gate's logs apart from an earlier test of the round's batch; `extra` goes after the gate's command. */
const testBatch = async ({ cfg, root, batch, nightDir, merge, say, tip, rebuild, tag = '', extra = [] }) => {
  const logName = `${batch.name.replace(/\//g, '-')}${tag}`;
  const main = cfg.git.main;
  const gate = cfg.gate.name;
  const catchUp = async () => {
    const caught = catchUpWithMain(batch.tree, main, cfg.record.ledger ?? null);
    if (caught.moved) {
      tip = caught.tip;
      say(`batch: ${main} moved; merged it in at ${tip.slice(0, 10)} and testing that`);
      return true;
    }
    if (!caught.conflict && !caught.failed) return false;
    ({ batch, tip } = await rebuild());
    const why = caught.conflict ? 'conflicted' : `failed (${caught.failed})`;
    say(`batch: ${main} moved and merging it ${why}; rebuilt the batch on it at ${tip.slice(0, 10)} and testing that`);
    return true;
  };
  // Another run may have landed while this one waited for the lock: test with its work in, not twice.
  if (merge) await catchUp();
  for (let pass = 1; ; pass++) {
    const suffix = pass === 1 ? '' : `.${pass}`;
    let log = freshLog(nightDir, `${logName}${suffix}`, cfg.gate.logSuffix);
    let status = await runGate(cfg, { root, batch, logPath: log, extra });
    say(`gate: ${gate} ${status === 0 ? 'passed' : `failed (${status}); its log is ${log}`}`);
    // A failed gate whose log names no failure crashed or was killed, which says nothing of the batch: run it once more.
    if (status !== 0 && crashedIn(log, cfg.gate)) {
      say(`gate: ${gate} named no failure, as a crashed run does; running it once more`);
      log = freshLog(nightDir, `${logName}${suffix}.rerun`, cfg.gate.logSuffix);
      status = await runGate(cfg, { root, batch, logPath: log, extra });
      say(`gate: ${gate} ${status === 0 ? 'passed' : `failed (${status}); its log is ${log}`}`);
    }
    if (status !== 0) return { batch, tip, log, report: `red: ${batch.name} and its branches kept; worktree ${batch.tree}; logs in ${nightDir}` };
    if (!merge || pass === MAIN_CATCH_UPS + 1 || !(await catchUp())) return { batch, tip };
  }
};

/**
 * The failures a red gate's log at `logPath` names, when every one is a test file `baseline` finds failing on the
 * frozen commit as well; else null. A failed step, or a log naming no failure, is never discounted.
 */
export const alreadyFailing = async (cfg, logPath, baseline) => {
  const where = failedWhereIn(readFileSync(logPath, 'utf8'), cfg.gate);
  if (!where.length || where.some((w) => !isTestPath(w))) return null;
  const old = await baseline(where);
  return where.every((w) => old.includes(w)) ? where : null;
};

/** The gate on the batch, in its turn in the fleet queue, which it holds only while it runs. */
export const gateOnFleet = async ({ cfg, setStep, round, say, ...test }) => {
  setStep('fleet-wait');
  const releaseFleet = await waitForFleet(fleetDir(), { tenant: cfg.name, round }, {
    onWait: ({ holder, ahead }) => {
      const behind = holder ? `${holder.tenant} round ${holder.round}` : ahead[0] ? `${ahead[0].tenant} round ${ahead[0].round}` : undefined;
      say(`batch: waiting for the fleet${behind ? `, behind ${behind}` : ''}${ahead.length ? ` (${ahead.length} ahead)` : ''}`);
      setStep('fleet-wait', behind ? { behind } : {});
    },
  });
  try {
    setStep('fleet');
    return await testBatch({ cfg, say, ...test });
  } finally {
    releaseFleet();
  }
};
