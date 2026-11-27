/**
 * How a run lands what its fixers made: each mbox onto its own `audit<N>-<area>` branch, the branches into
 * the batch, the record committed there, the gate run on its tip, and `main` fast-forwarded when green.
 * The gate run through the fast-forward holds the merge lock, so runs land one at a time, and the gate itself holds
 * the fleet queue's lease (`fleet.mjs`), so one gate runs at a time across every tenant.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyFix, commitRecord, fastForwardMain, gitIn, makeBatch, pushMain, removeWorktree } from './batch.mjs';
import { capstoneText, repairCapstone } from './capstone.mjs';
import { resolveConflicts } from './conflict.mjs';
import { alreadyFailing, failuresIn, gateOnFleet } from './gateRun.mjs';
import { mainRedText, testChecked, testsToRerun } from './preflight.mjs';
import { leftOutIn, leftOutWhy, recordLeftOut, retryable } from './leftOut.mjs';
import { waitForLease } from './lease.mjs';
import { mergeLock } from './runs.mjs';
/** What an early landing's batch branch, worktree and gate logs end in (README "Early landings"). */
export const EARLY = '-early';

/** Whether a fixer's verify step failed for good: a run that timed out lands, for the capstone to check. */
export const failedVerify = (verify) => verify?.ok === false && !verify.timedOut;
/** An area's outcome when a conflict repair merged its branch into the batch. */
export const conflictRepairedText = (branch) => `\`${branch}\`, merged after a conflict repair`;
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

/**
 * Merges the branches into the batch, records the round there, runs the gate on its tip, and merges if green. A red
 * gate gets one capstone repair cycle where `repair` is given (`capstone.mjs`): its failures go to the branches that
 * caused them, each repair starting only while `mayRepair` allows (`repairCapstone`), the batch is rebuilt from the
 * repaired ones, and the gate runs once more. `checks` (`checksFor`) runs the preflight before each gate and checks a
 * red result's failures on `main`'s tip, and what `main` fails too is no branch's to repair (README "Preflight"). Still
 * red, it lands anyway where every failure left is one `main` has (without `checks`, where `baseline(files)` says each
 * is a test file failing on the frozen commit too): landing leaves `main` no worse. A branch left out because it would not merge is recorded
 * (`leftOut.mjs`), and the next round's batch tries it again after its own branches. `onLanded({ tip, areas })` hears
 * that `main` fast-forwarded to `tip` with the round's `areas` in it. `early` makes it an early landing (README "Early
 * landings"): no record, no retry of earlier rounds' branches, and a branch that will not merge, or a batch still red,
 * leaves its branches for the round's own batch rather than out of it.
 * `resolve(branch, { batch, paths, label })`, where given, is a conflict repair (`conflict.mjs`): a branch that conflicts
 * with the batch is merged with its resolution, which a rebuilt batch reuses while it applies, and is left out only when
 * that fails; an early landing tries none. A run that is not a round (a scour fix run, docs/scour.md "Landing") passes
 * `record(tree)`, which commits its own record on the batch and answers `{ tip, path }`, and `leftOut: null`, so it
 * neither retries rounds' left-out branches nor leaves its own for them.
 */
export const batchAndTest = async ({ cfg, root, git, round, commit, date, nightDir, branches, results, sweep, outcomes, merge, say, setStep, repair, resolve = /** @type {any} */ (undefined), mayRepair = /** @type {(started: number) => string} */ (() => ''), baseline, checks = /** @type {any} */ (undefined), early = false, record = /** @type {((tree: string) => { tip: string, path: string }) | undefined} */ (undefined), leftOut = /** @type {string | null} */ (cfg.state), onLanded = /** @type {(landed: { tip: string, areas: string[] }) => void} */ (() => {}) }) => {
  const idOf = cfg.names.idOf;
  const fixCommits = new Map(results.map((a) => [a.id, a.fixCommits]));
  const main = cfg.git.main;
  const earlier = early || !leftOut ? new Map() : new Map(retryable(git, leftOutIn(leftOut), main).filter((e) => !branches.includes(e.branch)).map((e) => [e.branch, e]));
  if (earlier.size) say(`batch: retrying ${earlier.size} branches left out of earlier rounds: ${[...earlier.keys()].join(', ')}`);
  let landing = [...branches, ...earlier.keys()];
  let left = [];
  let retried = { merged: 0, out: 0 };
  /** Each conflict repair's resolution by branch, for a rebuilt batch to reuse. */
  const kept = new Map();
  /** The batch on main as it is now, with the round's record committed on it. */
  const build = async () => {
    const made = makeBatch(cfg, root, { round, date, commit, branches: landing, ...(early ? { suffix: EARLY } : {}) });
    const resolved = resolve && !early && made.conflicted.length
      ? new Set(await resolveConflicts({ made, kept, resolve, mayRepair: () => mayRepair(0), say }))
      : new Set();
    retried = { merged: made.merged.filter((b) => earlier.has(b)).length, out: 0 };
    for (const branch of made.merged) {
      if (earlier.has(branch)) {
        say(`batch: ${branch}, left out of round ${earlier.get(branch).round}, merged`);
        continue;
      }
      outcomes[idOf(branch)] = resolved.has(branch) ? conflictRepairedText(branch) : `\`${branch}\``;
      const area = results.find((a) => a.id === idOf(branch));
      if (area) {
        area.fixCommits = fixCommits.get(area.id);
        if (resolved.has(branch)) area.conflictRepaired = true;
        else delete area.conflictRepaired;
      }
    }
    left = [];
    for (const out of [...made.conflicted, ...made.failed]) {
      const { branch } = out;
      const why = leftOutWhy(out);
      if (early) {
        say(`batch: ${branch} would not merge early (${why}); it waits for the round's batch`);
        continue;
      }
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
    if (early) return { batch: made, tip: gitIn(made.tree)('rev-parse', 'HEAD') };
    const { tip, path } = record?.(made.tree)
      ?? { tip: commitRecord(cfg, made.tree, { round, commit, date, nightDir, areas: results, sweep, outcomes }), path: `${cfg.record.dir}/round-${round}/` };
    say(`record: ${path} committed on ${made.name} at ${tip.slice(0, 10)}`);
    return { batch: made, tip };
  };
  let { batch, tip: recorded } = await build();

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
    /** The test files the last red result failed, which the next preflight runs first. */
    let rerun = { plain: [], gui: [] };
    for (;;) {
      const tag = `${early ? EARLY.replace('-', '.') : ''}${cycles === 0 ? '' : cycles === 1 ? '.capstone' : `.capstone${cycles}`}`;
      tested = await testChecked({
        cfg, checks, batch, tip: recorded, rerun, tag, say,
        gate: (extra) => gateOnFleet({ cfg, root, batch, nightDir, merge, say, setStep, round, tip: recorded, rebuild: build, tag, extra }),
      });
      batch = tested.batch ?? batch;
      if (tested.onMain?.keys.length) say(`main: ${mainRedText(cfg, root, tested.onMain, readFileSync(tested.log, 'utf8'))}`);
      if (!tested.report) break;
      const own = tested.own ?? tested.log;
      rerun = testsToRerun(readFileSync(tested.log, 'utf8'), cfg);
      // One repair cycle per round, and another after it only while each leaves fewer failures than the one before.
      const failures = failuresIn(own, cfg.gate);
      if (!failures || !repair) break;
      if (cycles > 0 && !(failures < before)) break;
      if (cycles > 0) say(`capstone: ${failures} failures, down from ${before}; repairing again`);
      before = failures;
      cycles += 1;
      setStep('repair');
      const now = await repairCapstone({ cfg, root, round, commit, batch, logPath: own, repair, say, mayRepair, attempt: cycles });
      cycle = mergeCycles(cycle, now);
      for (const id of now.repaired.map(idOf)) fixCommits.set(id, results.find((a) => a.id === id)?.fixCommits);
      for (const branch of [...now.dropped, ...now.skipped]) {
        fixCommits.set(idOf(branch), []);
        const area = results.find((a) => a.id === idOf(branch));
        if (area) area.fixCommits = [];
        outcomes[idOf(branch)] = `\`${branch}\`, left out: ${now.skipped.includes(branch) ? 'its capstone repair never started, for the dollar cap or a stop request' : 'its capstone failures still failed after a repair'}`;
      }
      const out = [...now.dropped, ...now.skipped, ...now.unrepairable];
      // Unless main moved since, a cycle whose repairs committed nothing and left nothing out would test the same tree.
      const moved = git('merge-base', main, tested.tip ?? recorded) !== git('rev-parse', main);
      if (!now.changed.length && !out.length && !moved) {
        if (now.repaired.length) say(`capstone: ${now.repaired.length} repairs passed with no commit and ${main} has not moved; not testing the same tree again`);
        break;
      }
      landing = landing.filter((b) => !out.includes(b));
      ({ batch, tip: recorded } = await build());
      say(`capstone: rebuilt ${batch.name} with ${now.repaired.length} repaired and ${out.length} left out; testing again`);
    }
    const retested = cycle && (cycle.repaired.length || cycle.dropped.length || cycle.skipped.length || cycle.unrepairable.length) ? !tested.report : undefined;
    let tried = earlier.size ? `; retried ${earlier.size} branches left out of earlier rounds, ${retried.merged} merged and ${retried.out} still left out` : '';
    if (cycle) tried += `; ${capstoneText(cycle, idOf, retested)}`;
    if (tested.onMain?.keys.length) tried += `; ${mainRedText(cfg, root, tested.onMain, readFileSync(tested.log, 'utf8'))}`;
    // With checks, what main fails too was set aside already, so a red result with nothing left of its own lands over
    // it; without, a red gate lands where every failure is a test file failing on the frozen commit too.
    const over = !tested.report ? null
      : checks ? (failuresIn(tested.own ?? tested.log, cfg.gate) === 0 && tested.onMain ? tested.onMain.where : null)
        : baseline ? await alreadyFailing(cfg, tested.log, baseline) : null;
    if (over) {
      say(`gate: every failure left (${over.length}) fails on ${checks ? `${main}'s tip` : commit.slice(0, 10)} too; landing over them`);
      tried += `; landed over ${over.length} failures ${cfg.git.main} already has (${over.slice(0, 3).join(', ')}${over.length > 3 ? ', …' : ''})`;
    } else if (tested.report && early) {
      removeWorktree(root, batch.tree);
      tryDelete(git, batch.name);
      return `red${tried}; its branches wait for the round's batch`;
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
    } else if (early) {
      tryDelete(git, batch.name);
      return `${result}${tried}; its branches wait for the round's batch`;
    }
    return `${result}${tried}`;
  } finally {
    if (!early && leftOut) recordLeftOut(leftOut, git, main, left);
    release();
  }
};

const tryDelete = (git, branch) => {
  try {
    git('branch', '-D', branch);
  } catch {}
};
