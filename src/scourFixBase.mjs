/**
 * Where a scour fix run's batches start (docs/scour.md "Stacking"). An area's fixes stack: each batch is fixed on the
 * tip of the one before it, and a run given no `--on` starts from the area's newest fix branch, so that branch always
 * holds all of the area's unlanded fixes.
 */
import { gitIn } from './batch.mjs';
import { fixRunsIn } from './scourFixStatus.mjs';

/** Each batch branch the fix runs' records name for `area`, newest first (highest run, then batch), with its verify. */
export const fixBranchesOf = (area, runs) => runs
  .filter((r) => r.record?.area === area)
  .flatMap((r) => r.record.batches.filter((b) => b.branch).map((b) => ({ run: r.n, n: b.n, branch: b.branch, ok: b.verify?.ok !== false })))
  .sort((a, b) => b.run - a.run || b.n - a.n);

/**
 * The branch a run on `area` with no `--on` stacks on: the newest whose verify did not fail, while it still exists in
 * `root` and `main` does not already hold it. Null otherwise, and the run starts from `main`'s tip.
 */
export const stackBranchFor = (cfg, root, area, runs = fixRunsIn(cfg)) => {
  const newest = fixBranchesOf(area, runs).find((b) => b.ok);
  if (!newest) return null;
  const git = gitIn(root);
  try {
    git('rev-parse', '--verify', '--quiet', `refs/heads/${newest.branch}`);
  } catch {
    return null;
  }
  try {
    git('merge-base', '--is-ancestor', newest.branch, cfg.git.main);
    return null;
  } catch {
    return newest.branch;
  }
};
