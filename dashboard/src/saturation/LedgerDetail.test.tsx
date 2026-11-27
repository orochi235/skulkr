import { describe, expect, it } from 'vitest';
import { defectGroupsOf } from './LedgerDetail';
import { heroCountsOf, limitStatOf, nextDefectStatOf } from './LedgerHero';
import type { SaturationLedger } from './saturation.types';

const defect = (id: string, registry: { id: string; status: string; sha: null } | null = null) => ({
  id, claim: `claim ${id}`, where: 'x.ts:1', severity: '', sightings: 1, seenAt: [1], firstOccasion: 1, sources: ['claude'], onlyBy: null, registry,
});

const ledgerWith = (defects: ReturnType<typeof defect>[], statuses = {}) => ({
  defects, fix: { batches: [], ask: [], statuses },
}) as unknown as SaturationLedger;

describe("the defects table's groups", () => {
  it('puts the unresolved first and the resolved after, by fix verdict or registry status', () => {
    const groups = defectGroupsOf(ledgerWith(
      [defect('D1'), defect('D2'), defect('D3', { id: 'R9', status: 'fixed', sha: null }), defect('D4')],
      { D2: { status: 'fixed', run: 1, branch: 'b', verified: true }, D4: { status: 'fixed', run: 1, branch: 'b', verified: false } },
    ));
    expect(groups.map((g) => [g.label, g.rows.map((d) => d.id)])).toEqual([['Unresolved', ['D1', 'D4']], ['Resolved', ['D2', 'D3']]]);
  });

  it('counts found, fixed, fixing, open and ignored so they add up', () => {
    const ledger = {
      ...ledgerWith([defect('D1'), defect('D2'), defect('D3'), defect('D4')], {
        D1: { status: 'fixed', run: 1, branch: 'b', verified: true }, D2: { status: 'fixing', run: 2, branch: null, stage: 'writing' },
        D3: { status: 'not a defect', run: 1, branch: 'b', verified: true },
      }),
      distinct: 4, unseen: 2.5,
    } as unknown as SaturationLedger;
    expect(heroCountsOf(ledger)).toEqual({ found: 4, fixed: 1, fixing: 1, open: 1, ignored: 1, unseen: 2.5 });
  });

  it('shows one group while nothing is resolved', () => {
    expect(defectGroupsOf(ledgerWith([defect('D1')])).map((g) => g.label)).toEqual(['Unresolved']);
  });
});

describe("the hero's price figures", () => {
  const priced = (priceBy?: 'defect' | 'kloc') => ({ nextUsd: 3, limit: { usd: 2.5 }, priceBy }) as unknown as SaturationLedger;

  it('read the next defect and the limit in one unit, naming kloc where it is the unit', () => {
    expect(nextDefectStatOf(priced(), 'x')[0]).toBe('next defect');
    expect(limitStatOf(priced('defect'))[0]).toBe('limit');
    const [word, , tone, tip] = nextDefectStatOf(priced('kloc'), 'x');
    expect([word, tip]).toEqual(['next defect/kloc', expect.stringMatching(/per thousand lines/)]);
    expect(tone).toMatch(/^x \S/);
    expect(limitStatOf(priced('kloc'))[0]).toBe('limit/kloc');
  });

  it('show the opening price, with a note saying so, until the area has two passes', () => {
    const fresh = (occasions: number) => ({ nextUsd: null, openingUsd: 0.4, occasions, limit: { usd: 0.1 } }) as unknown as SaturationLedger;
    const [, value, tone, tip] = nextDefectStatOf(fresh(1), 'x');
    expect([value, tip]).toEqual(['$0.40', expect.stringMatching(/opening price/)]);
    expect(tone).toMatch(/^x \S/);
    expect(nextDefectStatOf(fresh(2), 'x').slice(1, 4)).toEqual(['–', 'x', undefined]);
  });
});
