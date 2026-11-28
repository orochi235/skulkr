/**
 * Which area `skulkr scour run` delves next: each candidate's next-defect price, and the order those put them in.
 * README "Scour", "Choosing the next pass".
 */
import { ledgerOf } from './ledger.mjs';
import { chao2, stopReason } from './saturation.mjs';
import { ledgerLinesOf } from './scourLines.mjs';
import { nextPriceOf } from './scourPrice.mjs';

/**
 * Each candidate's next defect: its ledger's price from two passes on, the pooled opening price before, in
 * `pricing.priceBy`'s unit; `stopped` where its own stop rule already holds; `known`, its defects found per thousand lines.
 */
export const candidatePricesOf = (cfg, root, ids, rule, pricing) => ids.map((id) => {
  const ledger = ledgerOf(cfg, id);
  if (!ledger) return { id, usd: pricing.openingUsd, stopped: null, known: 0 };
  const lines = ledgerLinesOf(cfg, root, ledger, id);
  const known = lines ? ledger.defects.length / (lines / 1000) : 0;
  if (ledger.occasions.length < 2) return { id, usd: pricing.openingUsd, stopped: null, known };
  const price = nextPriceOf({ ...ledger, lines }, pricing.factor, pricing.priceBy);
  return { id, usd: price.usd, stopped: stopReason(chao2(ledger.occasions, ledger.defects), rule, { price, lines }), known };
});

/**
 * The order `scour run` takes candidates in: cheapest next defect first, ties by `known` defects per thousand lines,
 * densest first (most areas sit at the opening price after one pass), then in the order given; those whose stop rule
 * holds or that `held` names (a live process has them) left out, and one with no price (its lines unknown, under
 * `kloc`) last.
 * @template {{ id: string, usd: number | undefined, stopped: string | null, known?: number }} C
 * @param {readonly C[]} candidates
 * @param {(id: string) => boolean} [held]
 * @returns {C[]}
 */
export const scourQueueOf = (candidates, held = () => false) =>
  candidates.filter((c) => !c.stopped && !held(c.id)).sort((a, b) => {
    const [x, y] = [a.usd ?? Infinity, b.usd ?? Infinity];
    return x === y ? (b.known ?? 0) - (a.known ?? 0) : x - y;
  });
