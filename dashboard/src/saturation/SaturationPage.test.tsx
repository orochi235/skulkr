import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { WeaselProvider } from '@weasel-js/core';
import { renderWithIcons } from '@dash/test/icons';
import { SaturationPage } from './SaturationPage';
import type { SaturationLedger } from './saturation.types';
import { saturationByArea } from './SaturationMap';
import fixture from '@dash/audits/fixture.map.json';

const ledger = (id: string, unseen: number, defects: SaturationLedger['defects']): SaturationLedger => ({
  id, area: id, commit: '9c4522d63555ec5f264441bcef4cd6a1917eac02', files: 26, occasions: 24, sources: { codex: 1, claude: 23 },
  costUsd: 23.28, distinct: defects.length, total: defects.length + unseen, unseen, nextNew: 0.147,
  stopped: "the next occasion's chance of a new finding is under 15% (14.7%)", updated: '2026-11-25T07:50:00Z', defects,
});

const LEDGERS = [
  ledger('core.animation', 9.6, [
    { id: 'D1', claim: 'A rejected tween still records its pose', where: 'poseHelpers.ts:110', severity: 'medium', sightings: 7, firstOccasion: 1, sources: ['codex', 'claude'], onlyBy: null, registry: { id: 'd-0123456789', status: 'fixed', sha: '96c86df9c8aa' } },
    { id: 'D2', claim: 'A pose read during teardown throws', where: 'animator.ts:40', severity: 'low', sightings: 0, firstOccasion: null, sources: [], onlyBy: 'codex', registry: null },
  ]),
  ledger('geom.booleans', 1.2, []),
];

function serve() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).endsWith('api/tenants')
    ? new Response('[{"name":"weasel"}]', { status: 200 })
    : String(url).endsWith('/map')
      ? new Response(JSON.stringify(fixture), { status: 200 })
      : new Response(JSON.stringify(LEDGERS), { status: 200 }))));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  window.location.hash = '';
});

describe('SaturationPage', () => {
  it('lists every ledger, most unseen first, and shows the picked one’s defects with the area in the hash', async () => {
    serve();
    window.location.hash = '#weasel/saturation';
    renderWithIcons(<WeaselProvider><SaturationPage base="/test/" /></WeaselProvider>);
    expect(await screen.findByText('2 ledgers · 2 defects · $46.56')).toBeInTheDocument();
    const list = screen.getByRole('region', { name: 'Ledgers' });
    const rows = within(list).getAllByRole('treeitem');
    expect(rows.map((r) => r.getAttribute('aria-level'))).toEqual(['1', '1']);
    expect(rows[0]).toHaveTextContent('core.animation');
    expect(rows[1]).toHaveTextContent('geom.booleans');
    expect(screen.getByText('Pick an area for its defects.')).toBeInTheDocument();

    fireEvent.click(within(rows[0]!).getByText('core.animation'));
    const detail = screen.getByRole('region', { name: "core.animation's defects" });
    expect(within(detail).getByText('A rejected tween still records its pose')).toBeInTheDocument();
    expect(within(detail).getByText('codex only')).toBeInTheDocument();
    expect(within(detail).getByText('96c86df9c8')).toBeInTheDocument();
    expect(within(detail).getByText('not landed')).toBeInTheDocument();
    expect(window.location.hash).toBe('#weasel/scour/core.animation');
  });

  it('shades the map by each own ledger’s unresolved defects, by the registry where it has landed', () => {
    expect([...saturationByArea([...LEDGERS, { ...LEDGERS[1]!, id: 'geom.booleans.9c4522d635' }])]).toEqual([
      ['core.animation', { open: 1, unseen: 9.6 }], ['geom.booleans', { open: 0, unseen: 1.2 }],
    ]);
  });

  it('draws the map above the defects', async () => {
    serve();
    window.location.hash = '#weasel/saturation';
    renderWithIcons(<WeaselProvider><SaturationPage base="/test/" /></WeaselProvider>);
    expect(await screen.findByRole('img', { name: /Treemap of every audit area/ })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Color the map by' })).toHaveValue('saturationOpen');
  });

  it('opens on the area the hash names', async () => {
    serve();
    window.location.hash = '#weasel/saturation/geom.booleans';
    renderWithIcons(<WeaselProvider><SaturationPage base="/test/" /></WeaselProvider>);
    expect(await screen.findByRole('region', { name: "geom.booleans's defects" })).toBeInTheDocument();
  });
});
