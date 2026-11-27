import { describe, expect, it } from 'vitest';
import { lastFlushText, yieldGridOf } from './LedgerFacts';
import type { SaturationLedger } from './saturation.types';

const ledger = {
  occasions: 4, distinct: 6, unseen: 3.4, costUsd: 8, lines: 2000, defectsPerKloc: 3, unseenPerKloc: 1.7, usdPerKloc: 4,
  defects: [{ id: 'D1', registry: null }, { id: 'D2', registry: { status: 'fixed' } }],
  fix: { batches: [], ask: [], statuses: { D1: { status: 'fixed', run: 1, branch: 'b', verified: true } } },
} as unknown as SaturationLedger;

describe('the yield grid', () => {
  it('gives found, left and spent for the area, per thousand lines and per pass, left having no per-pass figure', () => {
    const { cols, rows } = yieldGridOf(ledger);
    expect(cols).toEqual(['area', '/ kloc', '/ pass']);
    expect(rows.map((r) => [r.label, ...r.cells])).toEqual([
      ['found', '6', '3.0', '1.5'], ['fixed', '2', '1.0', '–'], ['left', '3', '1.7', '–'], ['spent', '$8.00', '$4.00', '$2.00'],
    ]);
  });

  it('drops the per-thousand-lines column where lines are unknown', () => {
    expect(yieldGridOf({ ...ledger, lines: null }).cols).toEqual(['area', '/ pass']);
  });
});

describe("a ledger's last flush", () => {
  it('reads never before any fix run, running while one is out, and its finish time after', () => {
    expect(lastFlushText(null, 0)).toBe('never');
    expect(lastFlushText({ finished: null }, 0)).toBe('running');
    const now = Date.parse('2026-11-26T22:00:00');
    expect(lastFlushText({ finished: '2026-11-26T21:17:45' }, now)).toMatch(/9:17/);
  });
});
