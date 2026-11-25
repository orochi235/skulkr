import { describe, expect, it } from 'vitest';
import { depletionOf, depletionRunOf, pooledPOf, settlesBy } from './depletion.mjs';

const run = (...found: number[]) => found.map((n) => ({ found: n, removed: n }));

describe('depletionOf', () => {
  it('bounds what is left once the finds fall', () => {
    const fit = depletionOf(run(16, 8, 4, 2))!;
    expect(fit.n0).toBeGreaterThanOrEqual(30);
    expect(fit.n0).toBeLessThanOrEqual(33);
    expect(fit.p).toBeCloseTo(0.5, 1);
    expect(fit.leftUpper!).toBeGreaterThanOrEqual(fit.left!);
  });

  it('is unbounded when the finds do not fall, and needs two rounds without a pooled rate', () => {
    expect(depletionOf(run(5, 5))!.unbounded).toBe(true);
    expect(depletionOf(run(5))).toBeUndefined();
  });

  it('counts empty passes as evidence at a pooled rate', () => {
    expect(depletionOf(run(0), 0.3)!.leftUpper).toBeGreaterThan(1);
    const quiet = depletionOf(run(3, 0, 0, 0, 0, 0), 0.5)!;
    expect(quiet.left).toBe(0);
    expect(quiet.leftUpper).toBe(0);
    expect(settlesBy(quiet)).toBe(true);
  });

  it('does not settle on a still-productive area', () => {
    expect(settlesBy(depletionOf(run(9, 3), 0.27))).toBe(false);
    expect(settlesBy(undefined)).toBe(false);
  });
});

describe('pooledPOf', () => {
  it('fits one rate over every run of two or more rounds', () => {
    expect(pooledPOf([run(16, 8, 4), run(10, 5), run(7)])).toBeGreaterThan(0.45);
    expect(pooledPOf([run(16, 8, 4), run(10, 5), run(7)])).toBeLessThan(0.65);
    expect(pooledPOf([run(7)])).toBeNull();
  });
});

describe('depletionRunOf', () => {
  const round = (r: number, fixed?: number, files = ['a.ts']) => ({ round: r, commit: `c${r}`, fixCommits: [`f${r}`], distinct: 9, fixed, files });

  it('takes the latest rounds with no code changed between them, counting what each fixer fixed', () => {
    const lines = new Map([[1, 40], [2, 0]]);
    expect(depletionRunOf([round(1, 5), round(2, 4), round(3)], ['a.ts'], (r: number) => lines.get(r)))
      .toEqual([{ round: 2, commit: 'c2', fixCommits: ['f2'], found: 4, removed: 4 }, { round: 3, commit: 'c3', fixCommits: ['f3'], found: 9, removed: 9 }]);
  });

  it('stops at a round whose file list differs or whose next change is unknown', () => {
    expect(depletionRunOf([round(1, 5, ['a.ts', 'b.ts']), round(2, 4)], ['a.ts'], () => 0).map((r: any) => r.round)).toEqual([2]);
    expect(depletionRunOf([round(1, 5), round(2, 4)], ['a.ts'], () => undefined).map((r: any) => r.round)).toEqual([2]);
  });
});
