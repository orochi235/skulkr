import { describe, expect, it } from 'vitest';
import { writeLedger } from './ledger.mjs';
import { fixWorkOf } from './scourFixQueue.mjs';
import { fixShelfOf, registryFixedIn, registryLinesIn, withRegistryFixes } from './scourFixStatus.mjs';
import { project } from './scourTestKit.ts';

describe('withRegistryFixes', () => {
  it('shows a defect the registry records fixed as fixed, leaving a fix run\'s own entries alone', () => {
    const shelf = { batches: [], ask: [], lastRun: null, statuses: { D2: { status: 'fixed', run: 3, branch: 'b', verified: true } } };
    const defects = [{ id: 'D1', registry: { status: 'fixed', sha: 'abc' } }, { id: 'D2', registry: { status: 'fixed', sha: 'def' } }, { id: 'D3', registry: { status: 'open' } }];
    const out = withRegistryFixes(shelf, defects);
    expect(out.statuses.D1).toMatchObject({ status: 'fixed', registry: true, sha: 'abc', run: null });
    expect(out.statuses.D2).toBe(shelf.statuses.D2);
    expect(out.statuses.D3).toBeUndefined();
  });
});

describe('a fix plan beside the registry', () => {
  it('leaves out the defects the registry records fixed, on the shelf and in the queue alike', () => {
    const { cfg, git } = project();
    const defect = (k: number) => ({ id: `D${k}`, claim: `claim ${k}`, where: `src/f.ts:${k}`, sightings: [1] });
    const ledger = { area: 'src', commit: git('rev-parse', 'main'), files: ['src/f.ts'], occasions: Array.from({ length: 10 }, () => ({})), defects: Array.from({ length: 9 }, (_, k) => defect(k + 1)) };
    writeLedger(cfg, ledger);
    const defects = ledger.defects.map((d, k) => ({ id: d.id, registry: { status: k < 5 ? 'fixed' : 'open' } }));
    const elsewhere = registryFixedIn(registryLinesIn(defects));
    expect([...elsewhere]).toEqual(['D1', 'D2', 'D3', 'D4', 'D5']);
    const ids = (shelf: { batches: { defects: { id: string }[] }[] } | null) => (shelf?.batches ?? []).flatMap((b) => b.defects.map((d) => d.id)).sort();
    expect(ids(fixShelfOf(cfg, ledger, [], {}, elsewhere))).toEqual(['D6', 'D7', 'D8', 'D9']);
    expect(ids(fixShelfOf(cfg, ledger, [], {}))).toHaveLength(9);
    expect(fixWorkOf(cfg, 'src', [], elsewhere)?.open).toBe(4);
  });
});
