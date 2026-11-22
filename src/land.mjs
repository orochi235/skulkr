/**
 * How a run lands what its fixers made: each mbox onto its own `audit<N>-<area>` branch, the branches into
 * the batch, the record committed there, the gate run on its tip, and `main` fast-forwarded when green.
 * The gate run through the fast-forward holds the merge lock, so runs land one at a time, and the gate itself holds
 * the fleet queue's lease (`fleet.mjs`), so one gate runs at a time across every tenant.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyFix, catchUpWithMain, commitRecord, fastForwardMain, makeBatch, pushMain, removeWorktree, runGate } from './batch.mjs';
import { capstoneText, repairCapstone } from './capstone.mjs';
import { failedWhereIn } from './gate.mjs';
import { fleetDir, waitForFleet } from './fleet.mjs';
import { leftOutIn, leftOutWhy, recordLeftOut, retryable } from './leftOut.mjs';
import { waitForLease } from './lease.mjs';
import { mergeLock } from './runs.mjs';
import { isTestPath } from './verify.mjs';
/** How many times a green batch merges a moved main in and tests again before leaving the fast-forward to fail. */
const MAIN_CATCH_UPS = 2;

/** Whether a fixer's verify step failed for good: a run that timed out lands, for the capstone to check. */
export const failedVerify = (verify) => verify?.ok === false && !verify.timedOut;
/** An area's outcome when its verify step still fails after its repairs. */
const leftOutText = (verify) => `left out: verify still failing after ${verify.repairs ?? 0} repairs (${verify.why})`;

/** Each fixer's mbox onto its own `audit<N>-<area>` branch. Answers the branches that took their patches. */
export const patchAreas = ({ cfg, root, round, commit, nightDir, results, outcomes, say }) => {
  const branches = [];
  for (const summary of results) {
    const mbox = join(nightDir, 'areas', summary.id, 'fix.mbox');
    if (!existsSync(mbox)) {
      outcomes[summary.id] = summary.distinct > 0 || summary.carried > 0 ? 'no commits' : 'nothing to fix';
      continue;
    }
    if (failedVerify(summary.verify)) {
      outcomes[summary.id] = leftOutText(summary.verify);
      say(`patch ${summary.id}: ${outcomes[summary.id]}`);
      continue;
    }
    const applied = applyFix(cfg, root, { round, area: summary.id, commit, mbox });
    if (applied.error) {
      outcomes[summary.id] = 'patches did not apply';
      say(`patch ${summary.id}: did not apply: ${applied.error}`);
      continue;
    }
    summary.fixCommits = applied.commits;
    branches.push(applied.branch);
    say(`patch ${summary.id}: ${applied.commits.length} commits on ${applied.branch}`);
  }
  return branches;
};

/** The sweep fixer's mbox onto `audit<N>-<sweep id>`, added to `branches`. Answers its commits and patches. */
export const patchSweep = ({ cfg, root, round, commit, fixed, branches, outcomes, say }) => {
  const SWEEP_ID = cfg.sweep.id;
  if (!fixed.mbox) {
    outcomes[SWEEP_ID] = 'no commits';
    return { patches: 0, commits: [], report: fixed.report };
  }
  if (failedVerify(fixed.verify)) {
    outcomes[SWEEP_ID] = leftOutText(fixed.verify);
    say(`patch ${SWEEP_ID}: ${outcomes[SWEEP_ID]}`);
    return { patches: fixed.patches, commits: [], report: fixed.report };
  }
  const applied = applyFix(cfg, root, { round, area: SWEEP_ID, commit, mbox: fixed.mbox });
  if (applied.error) {
    outcomes[SWEEP_ID] = 'patches did not apply';
    say(`patch ${SWEEP_ID}: did not apply: ${applied.error}`);
    return { patches: fixed.patches, commits: [], report: fixed.report };
  }
  branches.push(applied.branch);
  say(`patch ${SWEEP_ID}: ${applied.commits.length} commits on ${applied.branch}`);
  return { patches: fixed.patches, commits: applied.commits, report: fixed.report, costUsd: fixed.usage?.costUsd };
};

/** Tests the batch with the config's gate, merging a moved `main` in first and between passes. Where that merge
 *  conflicts, `rebuild` makes the batch again on the new `main`, leaving out the branches that now conflict, and the
 *  round goes on with the rest. Answers the batch and the tip to land, or, red, the batch, its gate log, and `{ report }`;
 *  `tag` marks the gate's logs apart from an earlier test of the round's batch. */
/** How many failures the gate log at `log` names (`failedWhereIn`); 0 where it cannot be read. */
const failuresIn = (log, gate) => {
  try {
    return failedWhereIn(readFileSync(log, 'utf8'), gate).length;
  } catch {
    return 0;
  }
};

/** Two capstone cycles' outcomes as one, a branch's later outcome replacing its earlier; `a` may be undefined. */
const mergeCycles = (a, b) => {
  if (!a) return { ...b, cycles: 1 };
  const out = new Set([...a.dropped, ...a.skipped, ...a.unrepairable, ...b.dropped, ...b.skipped, ...b.unrepairable]);
  return {
    repaired: [...new Set([...a.repaired, ...b.repaired])].filter((x) => !out.has(x)),
    dropped: [...new Set([...a.dropped, ...b.dropped])],
    skipped: [...new Set([...a.skipped, ...b.skipped])],
    unrepairable: [...new Set([...a.unrepairable, ...b.unrepairable])],
    byBranch: { ...a.byBranch, ...b.byBranch },
    unattributed: b.unattributed,
    cycles: a.cycles + 1,
  };
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

const testBatch = async ({ cfg, root, batch, nightDir, merge, say, tip, rebuild, tag = '' }) => {
  const logName = `${batch.name.replace(/\//g, '-')}${tag}`;
  const main = cfg.git.main;
  const gate = cfg.gate.name;
  const catchUp = () => {
    const caught = catchUpWithMain(batch.tree, main, cfg.record.ledger ?? null);
    if (caught.moved) {
      tip = caught.tip;
      say(`batch: ${main} moved; merged it in at ${tip.slice(0, 10)} and testing that`);
      return true;
    }
    if (!caught.conflict && !caught.failed) return false;
    ({ batch, tip } = rebuild());
    const why = caught.conflict ? 'conflicted' : `failed (${caught.failed})`;
    say(`batch: ${main} moved and merging it ${why}; rebuilt the batch on it at ${tip.slice(0, 10)} and testing that`);
    return true;
  };
  // Another run may have landed while this one waited for the lock: test with its work in, not twice.
  if (merge) catchUp();
  for (let pass = 1; ; pass++) {
    const suffix = pass === 1 ? '' : `.${pass}`;
    let log = join(nightDir, `${logName}${suffix}${cfg.gate.logSuffix}`);
    let status = await runGate(cfg, { root, batch, logPath: log });
    say(`gate: ${gate} ${status === 0 ? 'passed' : `failed (${status}); its log is ${log}`}`);
    // A failed gate whose log names no failure crashed or was killed, which says nothing of the batch: run it once more.
    if (status !== 0 && crashedIn(log, cfg.gate)) {
      say(`gate: ${gate} named no failure, as a crashed run does; running it once more`);
      log = join(nightDir, `${logName}${suffix}.rerun${cfg.gate.logSuffix}`);
      status = await runGate(cfg, { root, batch, logPath: log });
      say(`gate: ${gate} ${status === 0 ? 'passed' : `failed (${status}); its log is ${log}`}`);
    }
    if (status !== 0) return { batch, tip, log, report: `red: ${batch.name} and its branches kept; worktree ${batch.tree}; logs in ${nightDir}` };
    if (!merge || pass === MAIN_CATCH_UPS + 1 || !catchUp()) return { batch, tip };
  }
};

/**
 * Merges the branches into the batch, records the round there, runs the gate on its tip, and merges if green. A red
 * gate gets one capstone repair cycle where `repair` is given (`capstone.mjs`): its failures go to the branches that
 * caused them, each repair starting only while `mayRepair` allows (`repairCapstone`), the batch is rebuilt from the repaired ones, and the gate runs once more. Still red, it lands anyway
 * where `baseline(files)` says every failure left is a test file that fails on the frozen commit too: `main` has
 * those failures already, so landing leaves it no worse. A branch left out because it would not merge is recorded
 * (`leftOut.mjs`), and the next round's batch tries it again after its own branches. `onLanded({ tip, areas })` hears
 * that `main` fast-forwarded to `tip` with the round's `areas` in it.
 */
export const batchAndTest = async ({ cfg, root, git, round, commit, date, nightDir, branches, results, sweep, outcomes, merge, say, setStep, repair, mayRepair = /** @type {(started: number) => string} */ (() => ''), baseline, onLanded = /** @type {(landed: { tip: string, areas: string[] }) => void} */ (() => {}) }) => {
  const idOf = cfg.names.idOf;
  const fixCommits = new Map(results.map((a) => [a.id, a.fixCommits]));
  const main = cfg.git.main;
  const earlier = new Map(retryable(git, leftOutIn(cfg.state), main).filter((e) => !branches.includes(e.branch)).map((e) => [e.branch, e]));
  if (earlier.size) say(`batch: retrying ${earlier.size} branches left out of earlier rounds: ${[...earlier.keys()].join(', ')}`);
  let landing = [...branches, ...earlier.keys()];
  let left = [];
  let retried = { merged: 0, out: 0 };
  /** The batch on main as it is now, with the round's record committed on it. */
  const build = () => {
    const made = makeBatch(cfg, root, { round, date, commit, branches: landing });
    retried = { merged: made.merged.filter((b) => earlier.has(b)).length, out: 0 };
    for (const branch of made.merged) {
      if (earlier.has(branch)) {
        say(`batch: ${branch}, left out of round ${earlier.get(branch).round}, merged`);
        continue;
      }
      outcomes[idOf(branch)] = `\`${branch}\``;
      const area = results.find((a) => a.id === idOf(branch));
      if (area) area.fixCommits = fixCommits.get(area.id);
    }
    left = [];
    for (const out of [...made.conflicted, ...made.failed]) {
      const { branch } = out;
      const why = leftOutWhy(out);
      const before = earlier.get(branch);
      left.push({ branch, round: before?.round ?? round, why });
      say(`batch: ${branch}${before ? ` (round ${before.round})` : ''} left out: ${why}`);
      if (before) {
        retried.out += 1;
        continue;
      }
      outcomes[idOf(branch)] = `\`${branch}\`, left out: ${why}`;
      const area = results.find((a) => a.id === idOf(branch));
      if (area) area.fixCommits = [];
    }
    const tip = commitRecord(cfg, made.tree, { round, commit, date, nightDir, areas: results, sweep, outcomes });
    say(`record: ${cfg.record.dir}/round-${round}/ committed on ${made.name} at ${tip.slice(0, 10)}`);
    return { batch: made, tip };
  };
  let { batch, tip: recorded } = build();

  setStep('merge-wait');
  const release = await waitForLease(mergeLock(cfg.state), { round }, {
    onWait: (holder) => {
      say(`batch: waiting for the merge lock${holder?.round ? `, held by round ${holder.round}` : ''}`);
      if (holder?.round) setStep('merge-wait', { behind: `round ${holder.round}` });
    },
  });
  try {
    let tested;
    let cycle;
    let cycles = 0;
    /** How many failures the gate before the last repair cycle named. */
    let before = Infinity;
    for (;;) {
      tested = await gateOnFleet({ cfg, root, batch, nightDir, merge, say, setStep, round, tip: recorded, rebuild: build, tag: cycles === 0 ? '' : cycles === 1 ? '.capstone' : `.capstone${cycles}` });
      batch = tested.batch ?? batch;
      if (!tested.report || !repair) break;
      // One repair cycle per round, and another after it only while each leaves fewer failures than the one before.
      const failures = failuresIn(tested.log, cfg.gate);
      if (cycles > 0 && !(failures < before)) break;
      if (cycles > 0) say(`capstone: ${failures} failures, down from ${before}; repairing again`);
      before = failures;
      cycles += 1;
      setStep('repair');
      const now = await repairCapstone({ cfg, root, round, commit, batch, logPath: tested.log, repair, say, mayRepair, attempt: cycles });
      cycle = mergeCycles(cycle, now);
      for (const id of now.repaired.map(idOf)) fixCommits.set(id, results.find((a) => a.id === id)?.fixCommits);
      for (const branch of [...now.dropped, ...now.skipped]) {
        fixCommits.set(idOf(branch), []);
        const area = results.find((a) => a.id === idOf(branch));
        if (area) area.fixCommits = [];
        outcomes[idOf(branch)] = `\`${branch}\`, left out: ${now.skipped.includes(branch) ? 'its capstone repair never started, for the dollar cap or a stop request' : 'its capstone failures still failed after a repair'}`;
      }
      const out = [...now.dropped, ...now.skipped, ...now.unrepairable];
      if (!now.repaired.length && !out.length) break;
      landing = landing.filter((b) => !out.includes(b));
      ({ batch, tip: recorded } = build());
      say(`capstone: rebuilt ${batch.name} with ${now.repaired.length} repaired and ${out.length} left out; testing again`);
    }
    const retested = cycle && (cycle.repaired.length || cycle.dropped.length || cycle.skipped.length || cycle.unrepairable.length) ? !tested.report : undefined;
    let tried = earlier.size ? `; retried ${earlier.size} branches left out of earlier rounds, ${retried.merged} merged and ${retried.out} still left out` : '';
    if (cycle) tried += `; ${capstoneText(cycle, idOf, retested)}`;
    const over = tested.report && baseline ? await alreadyFailing(cfg, tested.log, baseline) : null;
    if (over) {
      say(`gate: every failure left (${over.length}) fails on ${commit.slice(0, 10)} too; landing over them`);
      tried += `; landed over ${over.length} failures ${cfg.git.main} already has (${over.slice(0, 3).join(', ')}${over.length > 3 ? ', …' : ''})`;
    } else if (tested.report) return `${tested.report}${tried}`;
    removeWorktree(root, batch.tree);
    if (!merge) return `green; --no-merge, so ${cfg.git.main} is untouched and ${batch.name} and its branches are kept${tried}`;
    let result = fastForwardMain(root, tested.tip, cfg.git.main);
    if (result.startsWith(`${cfg.git.main} fast-forwarded`)) {
      if (cfg.git.push) result += ` and ${pushMain(root, cfg.git.main, cfg.git.remote)}`;
      onLanded({ tip: tested.tip, areas: batch.merged.filter((b) => !earlier.has(b)).map(idOf) });
      // Another round may have landed and deleted a branch both took from the left-out record. A branch the capstone
      // dropped goes too, as a verify failure leaves no branch: kept, it would hold its area out of every later plan.
      // One blamed but never repaired (an earlier round's, or one the cap skipped) goes when a failure laid at it went
      // away without it. It is kept for a retry only when every failure laid at it is one main already has, so the
      // blame is unproven; deleting it then would destroy good fixes, and keeping a proven one would retry it forever.
      const already = new Set(over ?? []);
      const laidAt = (b) => cycle.byBranch[b] ?? cycle.byBranch[idOf(b)] ?? [];
      const unproven = (b) => laidAt(b).length > 0 && laidAt(b).every((f) => already.has(f));
      const unrepaired = [...(cycle?.skipped ?? []), ...(cycle?.unrepairable ?? [])];
      const kept = unrepaired.filter(unproven);
      for (const b of [...batch.merged, batch.name, ...(cycle?.dropped ?? []), ...unrepaired.filter((b) => !kept.includes(b))]) tryDelete(git, b);
      for (const b of (cycle?.skipped ?? []).filter((b) => kept.includes(b))) left.push({ branch: b, round, why: 'its capstone repair never started, and every failure laid at it is one main already has' });
    }
    return `${result}${tried}`;
  } finally {
    recordLeftOut(cfg.state, git, main, left);
    release();
  }
};

const tryDelete = (git, branch) => {
  try {
    git('branch', '-D', branch);
  } catch {}
};

/**
 * The failures a red gate's log at `logPath` names, when every one is a test file `baseline` finds failing on the
 * frozen commit as well; else null. A failed step, or a log naming no failure, is never discounted.
 */
const alreadyFailing = async (cfg, logPath, baseline) => {
  const where = failedWhereIn(readFileSync(logPath, 'utf8'), cfg.gate);
  if (!where.length || where.some((w) => !isTestPath(w))) return null;
  const old = await baseline(where);
  return where.every((w) => old.includes(w)) ? where : null;
};

/** The gate on the batch, in its turn in the fleet queue, which it holds only while it runs. */
const gateOnFleet = async ({ cfg, setStep, round, say, ...test }) => {
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
