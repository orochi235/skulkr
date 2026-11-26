/**
 * Which area `skulkr scour run` delves next: each candidate's next-defect price, and the order those put them in.
 * README "Scour", "Choosing the next pass".
 */
import { ledgerOf } from './ledger.mjs';
import { chao2, stopReason } from './saturation.mjs';
import { ledgerLinesOf } from './scourLines.mjs';
import { nextPriceOf } from './scourPrice.mjs';

/**
 * Each candidate's next defect: its ledger's price from two passes on, the pooled opening price before; `stopped`
 * where its own stop rule already holds.
 */
export const candidatePricesOf = (cfg, root, ids, rule, pricing) => ids.map((id) => {
  const ledger = ledgerOf(cfg, id);
  if (!ledger || ledger.occasions.length < 2) return { id, usd: pricing.openingUsd, stopped: null };
  const price = nextPriceOf(ledger, pricing.factor);
  const lines = ledgerLinesOf(cfg, root, ledger, id);
  return { id, usd: price.usd, stopped: stopReason(chao2(ledger.occasions, ledger.defects), rule, { price, lines }) };
});

/**
 * The order `scour run` takes candidates in: cheapest next defect first, ties in the order given, those whose stop rule
 * holds or that `held` names (a live process has them) left out.
 */
export const scourQueueOf = (candidates, held = () => false) =>
  candidates.filter((c) => !c.stopped && !held(c.id)).sort((a, b) => a.usd - b.usd);
