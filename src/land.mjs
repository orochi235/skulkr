/**
 * How a run lands what its fixers made: each mbox onto its own `audit<N>-<area>` branch, the branches into
 * the batch, the record committed there, the gate run on its tip, and `main` fast-forwarded when green.
 * The gate run through the fast-forward holds the merge lock, so runs land one at a time.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { applyFix, catchUpWithMain, commitRecord, fastForwardMain, makeBatch, removeWorktree, runGate } from './batch.mjs';
import { waitForLease } from './lease.mjs';
import { mergeLock } from './runs.mjs';
/** How many times a green batch merges a moved main in and tests again before leaving the fast-forward to fail. */
const MAIN_CATCH_UPS = 2;

/** Each fixer's mbox onto its own `audit<N>-<area>` branch. Answers the branches that took their patches. */
export const patchAreas = ({ cfg, root, round, commit, nightDir, results, outcomes, say }) => {
  const branches = [];
  for (const summary of results) {
    const mbox = join(nightDir, 'areas', summary.id, 'fix.mbox');
    if (!existsSync(mbox)) {
      outcomes[summary.id] = summary.distinct > 0 ? 'no commits' : 'nothing to fix';
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

/** Tests the batch with the config's gate, merging a moved `main` in first and between passes. Answers the tip to land, or `{ report }`. */
const testBatch = async ({ cfg, root, batch, nightDir, merge, say, tip }) => {
  const logName = batch.name.replace(/\//g, '-');
  const main = cfg.git.main;
  const gate = cfg.gate.name;
  const catchUp = () => {
    const caught = catchUpWithMain(batch.tree, main);
    if (caught.moved) {
      tip = caught.tip;
      say(`batch: ${main} moved; merged it in at ${tip.slice(0, 10)} and testing that`);
    }
    return caught;
  };
  const kept = `${batch.name} and its branches kept; worktree ${batch.tree}`;
  // Another run may have landed while this one waited for the lock: test with its work in, not twice.
  if (merge && catchUp().conflict) return { report: `untested: merging ${main} into the batch conflicts: ${kept}` };
  for (let pass = 1; ; pass++) {
    const suffix = pass === 1 ? '' : `.${pass}`;
    const log = join(nightDir, `${logName}${suffix}${cfg.gate.logSuffix}`);
    const status = await runGate(cfg, { root, batch, logPath: log });
    say(`gate: ${gate} ${status === 0 ? 'passed' : `failed (${status}); its log is ${log}`}`);
    if (status !== 0) return { report: `red: ${batch.name} and its branches kept; worktree ${batch.tree}; logs in ${nightDir}` };
    if (!merge || pass === MAIN_CATCH_UPS + 1) return { tip };
    const caught = catchUp();
    if (caught.conflict) return { report: `green, but ${main} moved and merging it conflicts: ${kept}` };
    if (!caught.moved) return { tip };
  }
};

/** Merges the branches into the batch, records the round there, runs the gate on its tip, and merges if green. */
export const batchAndTest = async ({ cfg, root, git, round, commit, date, nightDir, branches, results, sweep, outcomes, merge, say, setStep }) => {
  const batch = makeBatch(cfg, root, { round, date, commit, branches });
  const idOf = (branch) => branch.replace(cfg.names.area(round, ''), '');
  for (const branch of batch.merged) outcomes[idOf(branch)] = `\`${branch}\``;
  for (const branch of batch.conflicted) {
    outcomes[idOf(branch)] = `\`${branch}\`, left out: merge conflict`;
    const area = results.find((s) => s.id === idOf(branch));
    if (area) area.fixCommits = [];
    say(`batch: ${branch} conflicts; left out`);
  }
  const recorded = commitRecord(cfg, batch.tree, { round, commit, date, nightDir, areas: results, sweep, outcomes });
  say(`record: ${cfg.record.dir}/round-${round}/ committed on ${batch.name} at ${recorded.slice(0, 10)}`);

  setStep('merge-wait');
  const release = await waitForLease(mergeLock(cfg.state), { round }, {
    onWait: (holder) => say(`batch: waiting for the merge lock${holder?.round ? `, held by round ${holder.round}` : ''}`),
  });
  try {
    setStep('fleet');
    const tested = await testBatch({ cfg, root, batch, nightDir, merge, say, tip: recorded });
    if (tested.report) return tested.report;
    removeWorktree(root, batch.tree);
    if (!merge) return `green; --no-merge, so ${cfg.git.main} is untouched and ${batch.name} and its branches are kept`;
    const result = fastForwardMain(root, tested.tip, cfg.git.main);
    if (result.startsWith(`${cfg.git.main} fast-forwarded`)) for (const b of [...batch.merged, batch.name]) git('branch', '-D', b);
    return result;
  } finally {
    release();
  }
};
