import { describe, expect, it } from 'vitest';
import { bucketOf, calibrationFactors, calibrationOf, calibrationPairs, calibrationSeries, correctedLeftOf, factorFor } from './calibration.mjs';

const pass = (round: number, shared: number, left: number, distinct: number, extra: Record<string, unknown> = {}) =>
  ({ round, a: shared + 1, b: shared + 1, shared, distinct, est: distinct + left, left, ...extra });

describe('calibrationPairs', () => {
  it('pairs each pass with the next on its area, skipping provisional passes, and gives a one-pass area none', () => {
    const histories = new Map([
      ['a', [pass(1, 1, 2, 4), pass(2, 0, 0, 6, { provisional: true }), pass(3, 2, 1, 5)]],
      ['b', [pass(1, 3, 4, 9)]],
    ]);
    const pairs = calibrationPairs(histories, new Map([['a\n1', 120]]));
    expect(pairs).toEqual([{ area: 'a', round: 1, next: 3, a: 2, b: 2, shared: 1, est: 6, left: 2, found: 5, lines: 120 }]);
  });

  it("scales what the next pass found by that pass's share, as its left is", () => {
    const [pair] = calibrationPairs(new Map([['a', [pass(1, 1, 2, 4), pass(2, 1, 1, 8, { share: 0.25 })]]]));
    expect(pair!.found).toBe(2);
    expect(pair).not.toHaveProperty('lines');
  });
});

describe('calibrationFactors', () => {
  it('pools found over predicted, overall and by shared bucket, with each bucket\'s pair count', () => {
    const pairs = [
      { shared: 0, left: 2, found: 2 },
      { shared: 1, left: 1, found: 4 },
      { shared: 2, left: 1, found: 2 },
      { shared: 5, left: 0, found: 3 },
    ];
    const f = calibrationFactors(pairs);
    expect(f.overall).toEqual({ pairs: 4, predicted: 4, found: 11, factor: 2.75 });
    expect(f.byShared['0']).toMatchObject({ pairs: 1, factor: 1 });
    expect(f.byShared['1–2']).toMatchObject({ pairs: 2, factor: 3 });
    expect(f.byShared['3+']).toEqual({ pairs: 1, predicted: 0, found: 3, factor: null });
  });

  it('buckets shared counts as 0, 1–2, and 3 or more', () => {
    expect([0, 1, 2, 3, 9].map(bucketOf)).toEqual(['0', '1–2', '1–2', '3+', '3+']);
  });
});

describe('factorFor', () => {
  const calWith = (bucketPairs: number) => ({
    factors: {
      overall: { pairs: 20, predicted: 10, found: 40, factor: 4 },
      byShared: { '0': { pairs: 0, factor: null }, '1–2': { pairs: bucketPairs, factor: 6 }, '3+': { pairs: 9, factor: 0.5 } },
    },
  });

  it("uses a bucket's own factor from 5 pairs, and the overall one below that", () => {
    expect(factorFor(calWith(5), 2)).toBe(6);
    expect(factorFor(calWith(4), 2)).toBe(4);
    expect(factorFor(calWith(5), 0)).toBe(4);
  });

  it('never goes under 1, and is 1 with nothing to go on', () => {
    expect(factorFor(calWith(5), 3)).toBe(1);
    const none = calibrationOf(new Map());
    expect(factorFor(none, 1)).toBe(1);
    expect(correctedLeftOf({ left: 2.5, shared: 1 }, none)).toBe(2.5);
  });

  it('corrects a pass\'s left by its bucket', () => {
    expect(correctedLeftOf({ left: 2.1, shared: 1 }, calWith(5))).toBe(12.6);
  });
});

describe('calibrationSeries', () => {
  it('sums each round\'s predicted and found, with the factor pooled over that round and every earlier one', () => {
    const pairs = [
      { round: 3, left: 2, found: 6 },
      { round: 1, left: 1, found: 2 },
      { round: 3, left: 1, found: 0 },
      { round: 4, left: 0, found: 1 },
    ];
    expect(calibrationSeries(pairs)).toEqual([
      { round: 1, pairs: 1, predicted: 1, found: 2, factor: 2 },
      { round: 3, pairs: 2, predicted: 3, found: 6, factor: 2 },
      { round: 4, pairs: 1, predicted: 0, found: 1, factor: 2.25 },
    ]);
  });

  it('has no factor while nothing has been predicted', () => {
    expect(calibrationSeries([{ round: 1, left: 0, found: 2 }])[0]!.factor).toBeNull();
  });
});
