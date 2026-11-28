/**
 * Landing a scour fix run (docs/scour.md "Landing"): the area's newest fix branch, which holds all of its unlanded
 * fixes, goes through the rounds' batch, gate, capstone repair and fast-forward of `main` (`land.mjs:batchAndTest`),
 * under scour's own names (`scour<N>-<area>-b<k>`, `batch/<date>-scour<N>`). It commits its own record, every fix run
 * whose batches it carries, and rewrites the defect registry; it neither retries rounds' left-out branches nor leaves
 * its own for them, since a branch that does not land stays the area's newest and the next fix run stacks on it.
 */
import { mkdirSync, writeFileSync, cpSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gitIn } from './batch.mjs';
import { capstoneRepairer } from './capstone.mjs';
import { namesFor } from './config.mjs';
import { conflictRepairer } from './conflict.mjs';
import { batchAndTest } from './land.mjs';
import { checksFor } from './preflight.mjs';
import { writeRegistry } from './registry.mjs';
import { gateBaseline } from './repair.mjs';
import { fixBranchesOf } from './scourFixBase.mjs';
import { fixRecordDirOf } from './scourPaths.mjs';
import { verifyOf } from './verify.mjs';

/** `cfg` with scour's names in place of the rounds': its branches, batches, trees and jobs all read `scour`. */
export const scourCfgOf = (cfg) => {
  const naming = { ...cfg.naming, prefix: 'scour', batch: undefined };
  return { ...cfg, naming, names: namesFor(cfg.name, naming) };
};

/** The fix runs among `runs` with a batch branch in `branch`'s stack above `commit`, by number. */
export const runsIn = (git, runs, area, branch, commit) => {
  const held = new Set(git('rev-list', `${commit}..${branch}`).split('\n').filter(Boolean));
  return [...new Set(fixBranchesOf(area, runs).filter((b) => {
    try {
      return held.has(git('rev-parse', `${b.branch}^{commit}`));
    } catch {
      return false;
    }
  }).map((b) => b.run))].sort((a, b) => a - b);
};

/** Commits on the batch at `tree` the records of `runs` (`fixRunsIn`'s) and the registry. Answers `{ tip, path }`. */
export const commitFixRecord = (cfg, tree, { runs, area }) => {
  const git = gitIn(tree);
  const paths = runs.filter((r) => existsSync(join(r.dir, 'record.json'))).map((r) => {
    const to = fixRecordDirOf(cfg, r.n);
    mkdirSync(join(tree, to), { recursive: true });
    cpSync(join(r.dir, 'record.json'), join(tree, to, 'record.json'));
    return to;
  });
  paths.push(writeRegistry(cfg, git, tree));
  git('add', '-A', '--', ...paths);
  const trailer = cfg.record.trailer ? `\n\n${cfg.record.trailer}` : '';
  git('commit', '-q', '-m', `record scour fix ${runs.map((r) => r.n).join(', ')} on ${area}${trailer}`);
  return { tip: git('rev-parse', 'HEAD'), path: paths.map((p) => `${p}/`).join(', ') };
};

/**
 * Lands `branch`, area `area`'s newest fix branch, from fix run `ctx` (its jobs, its frozen tree, its run directory as
 * `nightDir`). `runs` are the fix runs on record (`fixRunsIn`). Deletes the area's fix branches `main` then holds.
 * Answers the landing's report, as a round's batch step words it.
 */
export const landFixBranch = async ({ ctx, cfg, root, area, branch, runs, say }) => {
  const scour = scourCfgOf(cfg);
  const git = gitIn(root);
  const main = cfg.git.main;
  const round = scour.names.branchOf(branch)?.round;
  if (round === undefined) throw new Error(`${branch} is not a scour fix branch`);
  const commit = git('merge-base', branch, main);
  const id = scour.names.idOf(branch);
  // A capstone repair rebuilds the branch from `commit` and this mbox, as it rebuilds a round's area branch.
  mkdirSync(join(ctx.nightDir, 'areas', id), { recursive: true });
  writeFileSync(join(ctx.nightDir, 'areas', id, 'fix.mbox'), `${git('format-patch', '--stdout', `${commit}..${branch}`)}\n`);
  const fixCommits = git('rev-list', '--reverse', `${commit}..${branch}`).split('\n').filter(Boolean);
  gitIn(ctx.frozen)('checkout', '--quiet', '--detach', commit);
  const land = { ...ctx, cfg: scour, root, round, commit, frozenTree: gitIn(ctx.frozen)('rev-parse', 'HEAD^{tree}') };
  const carried = runsIn(git, runs, area, branch, commit);
  const results = [{ id, fixCommits }];
  say(`land: ${branch}, ${fixCommits.length} commits from fix runs ${carried.join(', ')}, onto ${main}`);
  const report = await batchAndTest({
    cfg: scour, root, git, round, commit, date: new Date().toISOString().slice(0, 10), nightDir: ctx.nightDir,
    branches: [branch], results, sweep: undefined, outcomes: {}, merge: true, say, setStep: () => {},
    repair: verifyOf(cfg) ? capstoneRepairer(land, { root, results }) : undefined,
    resolve: cfg.conflicts?.repair ? conflictRepairer(land, { root }) : undefined,
    baseline: verifyOf(cfg) ? gateBaseline(land) : undefined,
    checks: checksFor(land),
    record: (tree) => commitFixRecord(cfg, tree, { runs: runs.filter((r) => carried.includes(r.n)), area }),
    leftOut: null,
  });
  for (const b of fixBranchesOf(area, runs)) {
    try {
      git('merge-base', '--is-ancestor', b.branch, main);
      git('branch', '-D', b.branch);
    } catch { /* gone already, or not landed */ }
  }
  say(`land: ${report}`);
  return report;
};
