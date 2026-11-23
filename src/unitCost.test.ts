import { describe, expect, it } from 'vitest';
import { unitCostOf } from './unitCost.mjs';

describe('unitCostOf', () => {
  it('divides the whole spend by the areas that spent and by their files', () => {
    const spent = new Map([['a', 6], ['b', 3], ['c', 0]]);
    expect(unitCostOf({ costUsd: 10, spent, files: { a: 30, b: 10, c: 50 } })).toEqual({ usdPerArea: 5, usdPerFile: 0.25 });
  });

  it('is null until an area has spent', () => {
    expect(unitCostOf({ costUsd: 0, spent: [], files: { a: 3 } })).toEqual({ usdPerArea: null, usdPerFile: null });
  });
});
