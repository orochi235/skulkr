import { describe, expect, it } from 'vitest';
import { writeLedger } from './ledger.mjs';
import { limitText } from './saturation.mjs';
import { goingRateOf, limitSpecOf, nextPriceOf, scourRuleOf } from './scourPrice.mjs';
import { project } from './scourTestKit.ts';

/** A ledger of `area` whose occasions saw the defects in `seen`, each pass costing $1. */
const ledgerOf = (area: string, seen: string[][]) => {
  const occasions = seen.map((_, i) => ({ n: i + 1, source: 'claude', costUsd: 1 }));
  const defects = [...new Set(seen.flat())].map((id) => {
    const sightings = seen.flatMap((s, i) => (s.includes(id) ? [i + 1] : []));
    return { id, claim: id, where: '', firstOccasion: sightings[0], sightings, sources: { claude: sightings } };
  });
  return { area, commit: 'c', files: [`${area}/x.ts`], occasions, defects };
};
const SEEN = [['A', 'B', 'C', 'D'], ['D', 'B', 'E', 'F', 'G', 'H', 'I'], ['J', 'A', 'K', 'H'], ['A', 'D'], ['H', 'L', 'A', 'C', 'M']];

describe('limitSpecOf', () => {
  it('reads dollars or a multiple of the going rate, and refuses anything else', () => {
    expect(limitSpecOf(2.5)).toEqual({ usd: 2.5 });
    expect(limitSpecOf('$2.5')).toEqual({ usd: 2.5 });
    expect(limitSpecOf('4x')).toEqual({ times: 4 });
    expect(limitSpecOf('1.5×')).toEqual({ times: 1.5 });
    expect(limitSpecOf({ times: 3 })).toEqual({ times: 3 });
    expect(() => limitSpecOf('cheap')).toThrow(/dollars \(2\.5\) or a multiple/);
    expect(() => limitSpecOf({ times: 0 })).toThrow(/over 0/);
  });
});

describe('goingRateOf', () => {
  it('is the opening price while an area of the partition has fewer than two passes, then the cheapest next defect', () => {
    const { root, cfg } = project(['lib', 'src']);
    const pricing = { factor: 1, openingUsd: 0.25 };
    writeLedger(cfg, ledgerOf('src', SEEN));
    expect(goingRateOf(cfg, root, pricing)).toBe(0.25);
    // Three passes are too few for a price: lib still counts as fresh.
    writeLedger(cfg, ledgerOf('lib', SEEN.slice(0, 3)));
    expect(goingRateOf(cfg, root, pricing)).toBe(0.25);
    const four = [...SEEN.slice(0, 4), ['A', 'N', 'O']];
    writeLedger(cfg, ledgerOf('lib', four));
    const cheapest = Math.min(nextPriceOf(ledgerOf('src', SEEN)).usd!, nextPriceOf(ledgerOf('lib', four)).usd!);
    expect(goingRateOf(cfg, root, pricing)).toBeCloseTo(cheapest, 10);
  });
});

describe('scourRuleOf', () => {
  it('sets the per-defect limit to a multiple of the going rate, or to the dollars given', () => {
    const { root, cfg } = project(['lib', 'src']);
    const going = scourRuleOf(cfg, root, { perDefect: '4x' });
    expect(going.limit).toEqual({ usd: 4 * cfg.saturate.openingUsdPerDefect, times: 4, goingUsd: cfg.saturate.openingUsdPerDefect });
    expect(going.stopUsdPerDefect).toBeCloseTo(1.6, 10);
    expect(limitText(going)).toBe('$1.60 (4× the $0.40 going rate)');
    const fixed = scourRuleOf(cfg, root, { perDefect: '2.5' });
    expect(fixed.stopUsdPerDefect).toBe(2.5);
    expect(limitText(fixed)).toBe('$2.50');
  });

  it('defaults to four times the going rate', () => {
    const { root, cfg } = project();
    expect(scourRuleOf(cfg, root).limit.times).toBe(4);
  });
});
