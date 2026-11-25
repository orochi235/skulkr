/**
 * `skulkr saturate land <area>… | --all`: commits saturation ledgers to the project's `main`, each under
 * `<record.dir>/saturation/<area>/<commit>/`, so their defects outlive the state directory. README "Saturation",
 * "Landing a ledger", is its documentation.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { addWorktree, fastForwardMain, gitIn, pushMain, removeWorktree } from './batch.mjs';
import { ledgerDirOf, ledgerOf, withLedgerHeld } from './ledger.mjs';
import { waitForLease } from './lease.mjs';
import { mergeLock } from './runs.mjs';
import { stopRuleOf } from './saturation.mjs';
import { reportText } from './saturationReport.mjs';
import { writeRegistry } from './registry.mjs';

/** Where `ledger` lands, relative to the project's root: one directory per area and frozen commit. */
export const landedDirOf = (cfg, ledger) => `${cfg.record.dir}/saturation/${ledger.area}/${ledger.commit.slice(0, 10)}`;

/** The landing commit's subject, for the ledgers it lands. */
export const landSubjectOf = (ledgers) => {
  if (ledgers.length > 1) {
    const defects = ledgers.reduce((n, l) => n + l.defects.length, 0);
    return `record ${ledgers.length} areas' saturation ledgers: ${defects} defects`;
  }
  const [ledger] = ledgers;
  return `record ${ledger.area}'s saturation ledger: ${ledger.defects.length} defects from ${ledger.occasions.length} occasions at ${ledger.commit.slice(0, 10)}`;
};

/** Every ledger id in the state directory with occasions to land, set-aside ones included. */
export const landableIdsOf = (cfg) => {
  const dir = join(cfg.state, 'saturation');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((id) => ledgerOf(cfg, id)?.occasions.length > 0).sort();
};

/** Writes `ledger`, its report, and the raw reports its occasions name into `to`, replacing an earlier landing. */
const writeLanded = (cfg, id, ledger, to) => {
  rmSync(to, { recursive: true, force: true });
  mkdirSync(join(to, 'reviews'), { recursive: true });
  writeFileSync(join(to, 'ledger.json'), `${JSON.stringify(ledger, null, 1)}\n`);
  writeFileSync(join(to, 'report.md'), reportText(ledger, stopRuleOf(cfg, cfg.saturate.max)));
  for (const { file } of ledger.occasions) if (file) cpSync(join(ledgerDirOf(cfg, id), file), join(to, file));
};

/** Runs `work` holding every ledger in `ids`. */
const withLedgersHeld = (cfg, ids, work) =>
  ids.length === 0 ? work() : withLedgerHeld(cfg, ids[0], {}, () => withLedgersHeld(cfg, ids.slice(1), work));

/**
 * Commits the ledgers `ids` (areas, or set-aside `<area>.<commit>`s) in one commit on a `<prefix>-saturation-<area>`
 * branch (`<prefix>-saturation` for several) from `main` and fast-forwards `main` to it, holding the ledgers and the
 * merge lock. The branch is deleted once `main` holds it and kept, named in the answer, when it does not. Answers what
 * happened, a sentence.
 */
export const landLedgers = async (cfg, root, ids, say = () => {}) => {
  if (ids.length === 0) throw new Error('no saturation ledger to land');
  // Before any hold, which would make a directory for an id that names no ledger.
  for (const id of ids) if (!ledgerOf(cfg, id)) throw new Error(`${id} has no saturation ledger`);
  return withLedgersHeld(cfg, ids, async () => {
    const ledgers = ids.map((id) => {
      const ledger = ledgerOf(cfg, id);
      if (!ledger) throw new Error(`${id} has no saturation ledger`);
      if (ledger.occasions.length === 0) throw new Error(`${id}'s saturation ledger has no occasions to land`);
      return ledger;
    });
    const what = ids.length === 1 ? ids[0] : `${ids.length} ledgers`;
    const release = await waitForLease(mergeLock(cfg.state), { saturate: what }, { onWait: () => say(`land ${what}: waiting for the merge lock`) });
    const branch = `${cfg.naming.prefix}-saturation${ids.length === 1 ? `-${ledgers[0].area}` : ''}`;
    const tree = addWorktree(root, branch, cfg.git.main, branch);
    let keep = false;
    try {
      const dirs = ledgers.map((ledger, i) => {
        const dir = landedDirOf(cfg, ledger);
        writeLanded(cfg, ids[i], ledger, join(tree, dir));
        return dir;
      });
      const git = gitIn(tree);
      git('add', '-A', '--', ...dirs);
      const changed = ledgers.filter((_, i) => git('status', '--porcelain', '--', dirs[i]));
      if (changed.length) git('add', '-A', '--', writeRegistry(cfg, git, tree));
      const where = dirs.length === 1 ? dirs[0] : `${dirs.length} ledgers under ${cfg.record.dir}/saturation`;
      if (changed.length === 0) return `${where} already ${dirs.length === 1 ? 'holds this ledger' : 'hold these ledgers'}; nothing to land`;
      const trailer = cfg.record.trailer ? `\n\n${cfg.record.trailer}` : '';
      const body = changed.length > 1 ? `\n\n${changed.map((l) => `- ${landSubjectOf([l]).replace(/^record /, '')}`).join('\n')}` : '';
      git('commit', '-q', '-m', `${landSubjectOf(changed)}${body}${trailer}`);
      const tip = git('rev-parse', 'HEAD');
      let result = fastForwardMain(root, tip, cfg.git.main);
      if (result.startsWith('not')) {
        keep = true;
        return `landed ${where} on ${branch}, ${result}`;
      }
      if (cfg.git.push) result += ` and ${pushMain(root, cfg.git.main, cfg.git.remote)}`;
      return `landed ${where}; ${result}`;
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
};
