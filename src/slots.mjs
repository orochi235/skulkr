/**
 * Slots: how many jobs of a role run on a node at once, leased on disk so every run on this machine shares them.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { noFixers, nodesAt } from './config.mjs';
import { heldAlive, leaseAt, takeLease } from './lease.mjs';

/**
 * Slots per node for `role`, read again at every lease from `<state>/limits.json` (`{ "review": n, "fix": n }`)
 * when it names one, so a change reaches runs already going; else the config's.
 */
export const slotsPerNode = (cfg, role, totals) => {
  const fallback = totals ? totals[role === 'fix' ? 'fix' : 'review'] : role === 'fix' ? cfg.nodes.fixSlots : cfg.nodes.reviewSlots;
  try {
    const n = JSON.parse(readFileSync(join(cfg.state, 'limits.json'), 'utf8'))[role === 'fix' ? 'fix' : 'review'];
    return Number.isInteger(n) && n > 0 ? n : fallback;
  } catch {
    return fallback;
  }
};

/** The one node a placing runner's slots are leased under: the runner picks the real node as each job starts. */
export const PLACED = 'placed';

/**
 * Slots: how many jobs of a role run on a node at once, leased on disk under `<state>/slots/<node>/<name>` so
 * every run on this machine shares them. A slot's name is only its lease's; onto picks the job's tree. `pinned` replaces the time-of-day node list; `about` goes into
 * each lease (the run's round). With `places` (a runner that picks each job's node itself) and nothing pinned, every
 * slot is on {@link PLACED}, `cfg.concurrency` of them by role, and no job names a node.
 */
export const createSlots = (cfg, pinned, { about = {}, places = false } = {}) => {
  const placed = places && !pinned;
  const held = new Set();
  const refusedUntil = new Map();
  const state = cfg.state;
  const noFix = noFixers(cfg);
  const take = (role, { now = new Date(), exclude = new Set() } = {}) => {
    const perNode = placed ? slotsPerNode(cfg, role, cfg.concurrency) : slotsPerNode(cfg, role);
    const prefix = role === 'fix' ? cfg.names.trees.fix : cfg.names.trees.review;
    // Fewest live leases of this role first, so jobs spread across nodes instead of filling the first.
    const busy = (node) => {
      const dir = join(state, 'slots', node);
      return existsSync(dir) ? readdirSync(dir).filter((t) => t.startsWith(prefix) && heldAlive(leaseAt(join(dir, t)))).length : 0;
    };
    const nodes = (placed ? [PLACED] : pinned ?? nodesAt(cfg, now)).map((node, i) => ({ node, i, n: busy(node) })).sort((a, b) => a.n - b.n || a.i - b.i).map((e) => e.node);
    for (const node of nodes) {
      if (role === 'fix' && noFix.includes(node)) continue;
      if (exclude.has(node) || (refusedUntil.get(node) ?? 0) > now.getTime()) continue;
      for (let k = 1; k <= perNode; k++) {
        const tree = `${prefix}${k}`;
        const key = `${node}/${tree}`;
        const unlease = takeLease(join(state, 'slots', node, tree), { ...about, role });
        if (!unlease) continue;
        held.add(key);
        return {
          node, tree, placed, release: () => {
            held.delete(key);
            unlease();
          },
        };
      }
    }
    return undefined;
  };
  const refuse = (node, now = Date.now()) => {
    if (!placed) refusedUntil.set(node, now + cfg.nodes.refusedCooldownMin * 60_000);
  };
  return { take, refuse, inUse: () => held.size };
};
