import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PassTableButton } from './PassTable';
import type { SaturationLedger, SaturationPass } from './saturation.types';

const pass = (n: number, over: Partial<SaturationPass> = {}): SaturationPass => ({
  n, source: 'claude', findings: 3, new: 1, distinct: n, unseen: null, nextNew: null, costUsd: 1, spentUsd: n,
  usdPerDefect: 1, nextUsd: null, defectsPerKloc: null, unseenPerKloc: null, costPerKloc: null, at: null, ...over,
});

const ledger = (passes: SaturationPass[]): SaturationLedger => ({
  id: 'core', area: 'core', commit: 'c0ffee', files: 3, occasions: passes.length, sources: { claude: passes.length }, costUsd: 2,
  distinct: 2, total: null, unseen: null, nextNew: null, nextUsd: null, lines: 2000, defectsPerKloc: 1, unseenPerKloc: null, limit: { usd: 1.5, times: null, goingUsd: null, text: '$1.50' }, usdPerKloc: 1, passes, stopped: null, updated: null, running: null, defects: [],
});

describe('PassTableButton', () => {
  it('opens a table of the passes, with the estimates and next defect price after each', async () => {
    render(<PassTableButton ledger={ledger([pass(1), pass(2, { unseen: 4.25, nextNew: 0.5, nextUsd: 2.3, defectsPerKloc: 1, unseenPerKloc: 2.125, costPerKloc: 0.5 })])} />);
    fireEvent.click(screen.getByRole('button', { name: 'Passes' }));
    const dialog = screen.getByRole('dialog', { name: 'core: passes' });
    const rows = within(dialog).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(within(rows[2]!).getAllByRole('cell').map((c) => c.textContent)).toEqual(['2', 'claude', '3', '1', '2', '1.0', '4.3', '2.1', '50.0%', '$1.00', '$0.50', '$2.00', '$1.00', '$2.30']);
    expect(within(rows[1]!).getAllByRole('cell').at(-1)?.textContent).toBe('–');
  });

  it('shows nothing for a ledger with no passes', () => {
    const { container } = render(<PassTableButton ledger={ledger([])} />);
    expect(container).toBeEmptyDOMElement();
  });
});
