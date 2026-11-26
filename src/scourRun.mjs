/**
 * `skulkr scour run`: delves over several areas, each pass sent where a strategy says, within a budget. README "Scour",
 * "Choosing the next pass".
 */
import { ledgerOf } from './ledger.mjs';
import { partitionAt } from './partition.mjs';
import { saturateArea } from './saturate.mjs';
import { pricingOf, scourRuleOf } from './scourPrice.mjs';
import { candidatePricesOf, scourQueueOf } from './scourQueue.mjs';

export const STRATEGIES = ['finish', 'cheapest', 'spread'];
const SPREAD_PASSES = 10;

const spentOn = (ledger) => (ledger?.occasions ?? []).reduce((sum, o) => sum + (o.costUsd ?? 0), 0);

/** `skulkr scour run [areas…] --by finish|cheapest|spread [--usd N] [--passes N]`, each line to `say`. */
export const scourRun = async (cfg, runner, root, args, say) => {
  const by = args.by ?? 'finish';
  if (!STRATEGIES.includes(by)) throw new Error(`--by wants one of ${STRATEGIES.join(', ')}, not ${by}`);
  if (args.words.length === 0 && args.usd === undefined) throw new Error('scour run over every area wants --usd <budget>');
  const ids = args.words.length ? args.words : partitionAt(cfg, root, cfg.git.main).map((a) => a.id);
  const budget = args.usd ?? Infinity;
  let spent = 0;
  const left = () => budget - spent;
  const delve = async (id, passes) => {
    const before = spentOn(ledgerOf(cfg, id));
    try {
      await saturateArea(cfg, runner, root, id, { ...args, passes, usd: Number.isFinite(left()) ? left() : undefined }, say);
    } catch (error) {
      // Another run (a second lane, a session) holding an area is no reason to drop the rest of this run's areas.
      if (!/another skulkr scour is working on/.test(error.message)) throw error;
      say(`scour run: ${id} skipped, ${error.message}`);
    }
    spent += spentOn(ledgerOf(cfg, id)) - before;
  };
  const byPrice = () => {
    const rule = scourRuleOf(cfg, root, args);
    return scourQueueOf(candidatePricesOf(cfg, root, ids, rule, pricingOf(cfg)));
  };
  say(`scour run by ${by}: ${ids.length} ${ids.length === 1 ? 'area' : 'areas'}, ${Number.isFinite(budget) ? `$${budget.toFixed(2)} to spend` : 'no budget'}`);
  if (by === 'cheapest') {
    for (;;) {
      if (left() <= 0) break;
      const [best] = byPrice();
      if (!best) {
        say('scour run: every area has stopped');
        break;
      }
      say(`scour run: ${best.id} next, its next defect ≈ $${best.usd.toFixed(2)}`);
      const before = spent;
      await delve(best.id, 1);
      if (spent === before) break;
    }
  } else {
    const order = args.words.length ? ids : byPrice().map((c) => c.id);
    for (const id of order) {
      if (left() <= 0) break;
      const passes = by === 'spread' ? (args.passes ?? SPREAD_PASSES) - (ledgerOf(cfg, id)?.occasions.length ?? 0) : undefined;
      if (passes !== undefined && passes <= 0) continue;
      await delve(id, passes);
    }
  }
  say(`scour run: spent $${spent.toFixed(2)}${Number.isFinite(budget) ? ` of $${budget.toFixed(2)}` : ''}`);
  return { spent };
};
