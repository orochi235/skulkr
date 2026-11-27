import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { WeaselProvider } from '@weasel-js/core';
import { renderWithIcons } from '@dash/test/icons';
import { SaturationPage } from './SaturationPage';
import type { SaturationLedger } from './saturation.types';
import { mapAreasFor, saturationByArea, scourPhasesOf } from './SaturationMap';
import type { AuditArea } from '@dash/audits/skulkrMap.types';
import fixture from '@dash/audits/fixture.map.json';

const ledger = (id: string, unseen: number, defects: SaturationLedger['defects']): SaturationLedger => ({
  id, area: id, commit: '9c4522d63555ec5f264441bcef4cd6a1917eac02', files: 26, occasions: 24, sources: { codex: 1, claude: 23 },
  costUsd: 23.28, distinct: defects.length, total: defects.length + unseen, unseen, nextNew: 0.147, nextUsd: 1.2, lines: null, defectsPerKloc: null, unseenPerKloc: null, limit: { usd: 1.5, times: null, goingUsd: null, text: '$1.50' }, usdPerKloc: null, passes: [],
  stopped: "the next occasion's chance of a new finding is under 15% (14.7%)", updated: '2026-11-25T07:50:00Z', defects, running: null,
});

const NO_KLOC = { unseenPerKloc: null, defectsPerKloc: null, usdPerKloc: null };
const PRICE = { goingUsd: null, limitUsd: 1.5, nextUsd: 1.2, stopped: "the next occasion's chance of a new finding is under 15% (14.7%)" };

const LEDGERS = [
  ledger('core.animation', 9.6, [
    { id: 'D1', claim: 'A rejected tween still records its pose', where: 'poseHelpers.ts:110', severity: 'medium', sightings: 7, seenAt: [1, 3, 5, 8, 12, 20, 24], firstOccasion: 1, sources: ['codex', 'claude'], onlyBy: null, registry: { id: 'd-0123456789', status: 'fixed', sha: '96c86df9c8aa' } },
    { id: 'D2', claim: 'A pose read during teardown throws', where: 'animator.ts:40', severity: 'low', sightings: 0, seenAt: [], firstOccasion: null, sources: [], onlyBy: 'codex', registry: null },
  ]),
  ledger('geom.booleans', 1.2, []),
];

function serve(ledgers: readonly SaturationLedger[] = LEDGERS, queue: readonly string[] = []) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).endsWith('api/tenants')
    ? new Response('[{"name":"weasel"}]', { status: 200 })
    : String(url).endsWith('/map')
      ? new Response(JSON.stringify(fixture), { status: 200 })
      : new Response(JSON.stringify({ ledgers, queue }), { status: 200 }))));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  window.location.hash = '';
});

describe('SaturationPage', () => {
  it('shows what each live scour process is doing, and picks its area when its name is clicked', async () => {
    serve([{ ...LEDGERS[0]!, running: {
      pid: 2804, since: new Date(Date.now() - 47 * 60_000).toISOString(), does: 'delve', max: 40,
      jobs: [{ key: '25-claude', step: 'review', at: null, line: 'skulkr: finding {"claim":"x"}', progress: { done: 5, of: 14 } }],
      log: ['2026-11-25T23:00:00Z 24/40 claude: 3 findings, 0 new'],
    } }, LEDGERS[1]!]);
    window.location.hash = '#weasel/scour';
    renderWithIcons(<WeaselProvider><SaturationPage base="/test/" /></WeaselProvider>);
    const now = await screen.findByRole('region', { name: 'Scouring now' });
    expect(within(now).getByText(/delve · pid 2804 · 47:0\d · 24\/40 occasions/)).toBeInTheDocument();
    expect(within(now).getByText('5/14')).toBeInTheDocument();
    expect(within(now).getByText(/ 24\/40 claude: 3 findings, 0 new$/)).toBeInTheDocument();
    fireEvent.click(within(now).getByText('core.animation'));
    expect(window.location.hash).toBe('#weasel/scour/core.animation');
  });

  it('lists every area on the map and every ledger as a tree, and shows the picked one’s defects with the area in the hash', async () => {
    serve();
    window.location.hash = '#weasel/saturation';
    renderWithIcons(<WeaselProvider><SaturationPage base="/test/" /></WeaselProvider>);
    expect(await screen.findByText('2 ledgers · 2 defects · $46.56')).toBeInTheDocument();
    const list = screen.getByRole('region', { name: 'Ledgers' });
    await within(list).findByText('ui');
    const top = within(list).getAllByRole('treeitem').filter((r) => r.getAttribute('aria-level') === '1');
    expect(top.map((r) => within(r).getAllByText(/./)[0]!.textContent)).toEqual(['core', 'geom', 'ui']);
    expect(screen.getByText('Pick an area for its defects.')).toBeInTheDocument();

    fireEvent.change(within(list).getByRole('searchbox'), { target: { value: 'core.animation' } });
    fireEvent.click(await within(list).findByText('animation'));
    const detail = screen.getByRole('region', { name: "core.animation's defects" });
    expect(within(detail).getByText('A rejected tween still records its pose')).toBeInTheDocument();
    expect(within(detail).getByText('codex only')).toBeInTheDocument();
    expect(within(detail).getByText('96c86df9c8')).toBeInTheDocument();
    expect(within(detail).getByText('not landed')).toBeInTheDocument();
    expect(window.location.hash).toBe('#weasel/scour/core.animation');
  });

  it('shades the map by each own ledger’s unresolved defects, by the registry where it has landed', () => {
    expect([...saturationByArea([...LEDGERS, { ...LEDGERS[1]!, id: 'geom.booleans.9c4522d635' }])]).toEqual([
      ['core.animation', { open: 1, unseen: 9.6, distinct: 2, occasions: 24, nextNew: 0.147, total: 11.6, costUsd: 23.28, ...NO_KLOC, ...PRICE }],
      ['geom.booleans', { open: 0, unseen: 1.2, distinct: 0, occasions: 24, nextNew: 0.147, total: 1.2, costUsd: 23.28, ...NO_KLOC, ...PRICE }],
    ]);
  });

  it('draws the map above the defects', async () => {
    serve();
    window.location.hash = '#weasel/saturation';
    renderWithIcons(<WeaselProvider><SaturationPage base="/test/" /></WeaselProvider>);
    expect(await screen.findByRole('img', { name: /Treemap of every audit area/ })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Color the map by' })).toHaveValue('saturation');
    expect(within(screen.getByRole('combobox', { name: 'Color the map by' })).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'saturation', 'chance next review finds a new defect', 'defects not found yet (est.)', 'defects not found yet per 1,000 lines (est.)', 'defects open', 'defects found',
      'defects found per 1,000 lines', 'defects it holds (est.)', 'reviews', 'spend', 'spend per 1,000 lines',
    ]);
  });

  it('opens on the area the hash names', async () => {
    serve();
    window.location.hash = '#weasel/saturation/geom.booleans';
    renderWithIcons(<WeaselProvider><SaturationPage base="/test/" /></WeaselProvider>);
    expect(await screen.findByRole('region', { name: "geom.booleans's defects" })).toBeInTheDocument();
  });

  it("lists scour's queue in its own pane, each with its lines and known defects, and picks an area from it", async () => {
    serve(LEDGERS, ['geom.booleans', 'ui.menu']);
    window.location.hash = '#weasel/scour';
    renderWithIcons(<WeaselProvider><SaturationPage base="/test/" /></WeaselProvider>);
    const pane = await screen.findByRole('region', { name: 'Scour queue' });
    expect(within(pane).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['1geom.booleans–0', '2ui.menu––']);
    expect(within(pane).getByText('geom.booleans').closest('button')).toHaveAttribute('title', 'geom.booleans: next defect ≈ $1.20');
    fireEvent.click(within(pane).getByText('geom.booleans'));
    expect(window.location.hash).toBe('#weasel/scour/geom.booleans');
  });

  it('traces a hovered defect on both the delve chart and the fix shelf', async () => {
    const fix = { batches: [{ n: 1, defects: [{ id: 'D1', size: 'line', recurrent: false }, { id: 'D2', size: 'line', recurrent: false }] }], ask: [], statuses: {} };
    serve([{ ...LEDGERS[0]!, fix }, LEDGERS[1]!]);
    window.location.hash = '#weasel/scour/core.animation';
    renderWithIcons(<WeaselProvider><SaturationPage base="/test/" /></WeaselProvider>);
    const detail = await screen.findByRole('region', { name: "core.animation's defects" });
    const shelf = await within(detail).findByRole('img', { name: /fix groups/ });
    const tileOn = (root: Element, start: string) => [...root.querySelectorAll('g')].find((g) => g.querySelector(':scope > title')?.textContent?.startsWith(start))!;
    const lit = (g: Element) => g.getAttribute('class')?.includes('traced');
    fireEvent.pointerEnter(tileOn(detail, 'pass 3 · D1'));
    expect(lit(tileOn(shelf, 'D1 · '))).toBe(true);
    expect(lit(tileOn(shelf, 'D2 · '))).toBe(false);
    fireEvent.pointerLeave(tileOn(detail, 'pass 3 · D1'));
    fireEvent.pointerEnter(tileOn(shelf, 'D1 · '));
    expect(lit(tileOn(detail, 'pass 3 · D1'))).toBe(true);
  });

  it("scrolls to a chart tile's defect when it is clicked, and marks its row", async () => {
    const scrolled: Element[] = [];
    Element.prototype.scrollIntoView = function scrollIntoView() { scrolled.push(this); };
    serve();
    window.location.hash = '#weasel/scour/core.animation';
    renderWithIcons(<WeaselProvider><SaturationPage base="/test/" /></WeaselProvider>);
    const detail = await screen.findByRole('region', { name: "core.animation's defects" });
    const tile = [...detail.querySelectorAll('g')].find((g) => g.querySelector('title')?.textContent?.startsWith('pass 3 · D1'))!;
    fireEvent.click(tile);
    const row = within(detail).getByText('A rejected tween still records its pose').closest('tr')!;
    expect(scrolled).toContain(row);
    expect(row.className).toMatch(/picked/);
  });
  it('lights each area a live scour holds on the map, in match while a matcher runs', () => {
    const live = (step: string) => ({ pid: 1, since: '2026-11-25T00:00:00Z', does: 'delve', max: 40, log: [], jobs: [{ key: '03-claude', step, at: null, line: null, progress: null }] });
    expect([...scourPhasesOf([
      { ...LEDGERS[0]!, running: live('review') },
      { ...LEDGERS[1]!, running: live('match1') },
      { ...LEDGERS[1]!, id: 'geom.booleans.9c4522d635', running: live('review') },
    ])]).toEqual([['core.animation', 'review'], ['geom.booleans', 'match']]);
  });

  it("numbers the map's areas by scour's queue, not the rounds'", () => {
    const areas = (fixture as unknown as { areas: AuditArea[] }).areas;
    const shown = mapAreasFor(areas, [], ['core.debug', 'core.ops'], new Map());
    expect(shown.filter((a) => a.queue !== null).map((a) => [a.id, a.queue])).toEqual([['core.ops', 2], ['core.debug', 1]]);
  });
});
