import { describe, expect, it } from 'vitest';
import { yieldGridOf } from './LedgerFacts';
import type { SaturationLedger } from './saturation.types';

const ledger = {
  occasions: 4, distinct: 6, unseen: 3.4, costUsd: 8, lines: 2000, defectsPerKloc: 3, unseenPerKloc: 1.7, usdPerKloc: 4,
} as unknown as SaturationLedger;

describe('the yield grid', () => {
  it('gives found, left and spent for the area, per thousand lines and per pass, left having no per-pass figure', () => {
    const { cols, rows } = yieldGridOf(ledger);
    expect(cols).toEqual(['area', '/ kloc', '/ pass']);
    expect(rows.map((r) => [r.label, ...r.cells])).toEqual([
      ['found', '6', '3.0', '1.5'], ['left', '3', '1.7', '–'], ['spent', '$8.00', '$4.00', '$2.00'],
    ]);
  });

  it('drops the per-thousand-lines column where lines are unknown', () => {
    expect(yieldGridOf({ ...ledger, lines: null }).cols).toEqual(['area', '/ pass']);
  });
});
