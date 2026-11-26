import { describe, expect, it } from 'vitest';
import { chao2 } from './saturation.mjs';
import { calibrationOf, nextPriceOf, openingPriceOf } from './scourPrice.mjs';

/** A ledger whose occasion i (from 1) cost `costs[i-1]` and saw the defects in `seen[i-1]`. */
const ledgerOf = (seen: string[][], costs = seen.map(() => 1)) => {
  const occasions = seen.map((_, i) => ({ n: i + 1, source: 'claude', costUsd: costs[i] }));
  const ids = [...new Set(seen.flat())];
  const defects = ids.map((id) => {
    const sightings = seen.flatMap((s, i) => (s.includes(id) ? [i + 1] : []));
    return { id, claim: id, where: '', firstOccasion: sightings[0], sightings, sources: { claude: sightings } };
  });
  return { area: 'a', commit: 'c', files: [], occasions, defects };
};

/** The worked example of saturation.test.ts: Chao2 says 32.3% of the next findings are new, 4.4 sightings a pass. */
const SEEN = [['A', 'B', 'C', 'D'], ['D', 'B', 'E', 'F', 'G', 'H', 'I'], ['J', 'A', 'K', 'H'], ['A', 'D'], ['H', 'L', 'A', 'C', 'M']];

describe('nextPriceOf', () => {
  it('divides the last five passes\' average cost by the new defects Chao2 expects next', () => {
    const p = nextPriceOf(ledgerOf(SEEN, [1, 1, 1, 0.5, 0.5]));
    expect(p.passUsd).toBeCloseTo(0.8, 10);
    expect(p.expectedNew).toBeCloseTo(0.3232 * 22 / 5, 3);
    expect(p.usd).toBeCloseTo(0.8 / (0.3232 * 22 / 5), 2);
  });

  it('scales the expectation by the calibration factor, and has no price under two passes', () => {
    expect(nextPriceOf(ledgerOf(SEEN), 0.5).usd).toBeCloseTo(2 * nextPriceOf(ledgerOf(SEEN)).usd!, 10);
    expect(nextPriceOf(ledgerOf([['A']])).usd).toBeUndefined();
  });

  it('prices a ledger that expects nothing new at Infinity', () => {
    expect(nextPriceOf(ledgerOf([['A', 'B'], ['A', 'B'], ['A', 'B']])).usd).toBe(Infinity);
  });
});

describe('calibrationOf', () => {
  it('stays at 1 until twenty passes measure it', () => {
    expect(calibrationOf([ledgerOf(SEEN)])).toEqual({ factor: 1, passes: 2 });
  });

  it('is what passes found over what Chao2 expected of them', () => {
    // Each copy measures passes 4 and 5, which found 0 and 2 new defects.
    const l = ledgerOf(SEEN);
    const expected = (k: number) => {
      const s = chao2(l.occasions.slice(0, k), l.defects);
      return (s.nextNew! * s.U) / s.m;
    };
    const { factor, passes } = calibrationOf(Array.from({ length: 10 }, () => l));
    expect(passes).toBe(20);
    expect(factor).toBeCloseTo(2 / (expected(3) + expected(4)), 10);
  });
});

describe('openingPriceOf', () => {
  it('pools the first five passes of each ledger that has had them, and falls back without one', () => {
    // The worked example finds 13 defects in its first five passes; a ledger with four passes is left out.
    expect(openingPriceOf([ledgerOf(SEEN, [2, 2, 2, 2, 5]), ledgerOf(SEEN.slice(0, 4))], 0.4)).toBeCloseTo(13 / 13, 10);
    expect(openingPriceOf([ledgerOf(SEEN.slice(0, 4))], 0.4)).toBe(0.4);
  });
});
