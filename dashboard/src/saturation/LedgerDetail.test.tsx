import { describe, expect, it } from 'vitest';
import { defectGroupsOf } from './LedgerDetail';
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

  it('shows one group while nothing is resolved', () => {
    expect(defectGroupsOf(ledgerWith([defect('D1')])).map((g) => g.label)).toEqual(['Unresolved']);
  });
});
