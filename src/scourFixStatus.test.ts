import { describe, expect, it } from 'vitest';
import { withRegistryFixes } from './scourFixStatus.mjs';

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
