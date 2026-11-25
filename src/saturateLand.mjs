/**
 * `skulkr saturate land <area>`: commits an area's saturation ledger to the project's `main`, under
 * `<record.dir>/saturation/<area>/<commit>/`, so its defects outlive the state directory. README "Saturation", "Landing
 * a ledger", is its documentation.
 */
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { addWorktree, fastForwardMain, gitIn, pushMain, removeWorktree } from './batch.mjs';
import { ledgerDirOf, ledgerOf, withLedgerHeld } from './ledger.mjs';
import { waitForLease } from './lease.mjs';
import { mergeLock } from './runs.mjs';

/** Where `ledger` lands, relative to the project's root: one directory per area and frozen commit. */
export const landedDirOf = (cfg, ledger) => `${cfg.record.dir}/saturation/${ledger.area}/${ledger.commit.slice(0, 10)}`;

/** The landing commit's subject. */
export const landSubjectOf = (ledger) =>
  `record ${ledger.area}'s saturation ledger: ${ledger.defects.length} defects from ${ledger.occasions.length} occasions at ${ledger.commit.slice(0, 10)}`;

/** Writes `ledger` and the raw reports its occasions name into `to`, replacing whatever an earlier landing left. */
const writeLanded = (cfg, id, ledger, to) => {
  rmSync(to, { recursive: true, force: true });
  mkdirSync(join(to, 'reviews'), { recursive: true });
  writeFileSync(join(to, 'ledger.json'), `${JSON.stringify(ledger, null, 1)}\n`);
  for (const { file } of ledger.occasions) if (file) cpSync(join(ledgerDirOf(cfg, id), file), join(to, file));
};

/**
 * Commits `id`'s ledger (an area, or a set-aside `<area>.<commit>`) on a `<prefix>-saturation-<area>` branch from
 * `main` and fast-forwards `main` to it, holding the ledger and the merge lock. The branch is deleted once `main`
 * holds it and kept, named in the answer, when it does not. Answers what happened, a sentence.
 */
export const landLedger = async (cfg, root, id, say = () => {}) => withLedgerHeld(cfg, id, {}, async () => {
  const ledger = ledgerOf(cfg, id);
  if (!ledger) throw new Error(`${id} has no saturation ledger`);
  if (ledger.occasions.length === 0) throw new Error(`${id}'s saturation ledger has no occasions to land`);
  const release = await waitForLease(mergeLock(cfg.state), { saturate: id }, { onWait: () => say(`land ${id}: waiting for the merge lock`) });
  const branch = `${cfg.naming.prefix}-saturation-${ledger.area}`;
  const tree = addWorktree(root, branch, cfg.git.main, branch);
  let keep = false;
  try {
    const dir = landedDirOf(cfg, ledger);
    writeLanded(cfg, id, ledger, join(tree, dir));
    const git = gitIn(tree);
    git('add', '-A', '--', dir);
    if (!git('status', '--porcelain', '--', dir)) return `${dir} already holds this ledger; nothing to land`;
    const trailer = cfg.record.trailer ? `\n\n${cfg.record.trailer}` : '';
    git('commit', '-q', '-m', `${landSubjectOf(ledger)}${trailer}`);
    const tip = git('rev-parse', 'HEAD');
    let result = fastForwardMain(root, tip, cfg.git.main);
    if (result.startsWith('not')) {
      keep = true;
      return `landed ${dir} on ${branch}, ${result}`;
    }
    if (cfg.git.push) result += ` and ${pushMain(root, cfg.git.main, cfg.git.remote)}`;
    return `landed ${dir}; ${result}`;
  } finally {
    removeWorktree(root, tree);
    if (!keep) {
      try {
        gitIn(root)('branch', '-D', branch);
      } catch { /* never made */ }
    }
    release();
  }
});
