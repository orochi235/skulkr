import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { WeaselProvider } from '@weasel-js/core';
import { renderWithIcons } from '@dash/test/icons';
import { AuditsPage } from './AuditsPage';
import fixture from './fixture.map.json';

const URL = '/test/api/t/example/map';

const DEFECTS = [{ round: 41, recorded: true, fixed: true, items: [{ claim: 'A scene write is lost on undo', from: 'A', verdict: 'fixed', note: 'Undo now keeps it.' }] }];

/** Answers the tenants route with one tenant, the map's route with `body`, and an area's defects route with {@link DEFECTS}. */
function serve(status: number, body: unknown) {
  const fetch = vi.fn(async (url: string) => (String(url).endsWith('api/tenants')
    ? new Response('[{"name":"example"}]', { status: 200 })
    : String(url).includes('/area')
      ? new Response(JSON.stringify(DEFECTS), { status: 200 })
      : new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const renderPage = (dev = true) =>
  renderWithIcons(<WeaselProvider><AuditsPage source={{ base: '/test/', everyMs: 60_000, dev }} /></WeaselProvider>);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  // The page keeps the last map it drew; each test starts with none kept.
  localStorage.clear();
});

describe('AuditsPage', () => {
  it('says in the lanes header when rounds run continuously, and what the night has left', async () => {
    serve(200, { ...fixture, continuous: { until: '2026-11-17T12:00:00.000Z', next: 'round 41 is in its model steps', nightUsd: 200, spentUsd: 62, leftUsd: 138 } });
    renderPage();
    expect(await screen.findByText('continuous · $138 of $200 left tonight')).toHaveAttribute('title', 'round 41 is in its model steps');
  });

  it('shows every run, the stats, the queue and the jobs from the map', async () => {
    const fetch = serve(200, fixture);
    renderPage();
    expect(await screen.findByText('Round 41 running · fix · 2 areas')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(URL, { cache: 'no-store' });
    expect(screen.queryByText('Round 40 finished · 8 areas merged')).toBeNull();
    expect(screen.getByText('$12.50 of $80')).toBeInTheDocument();
    expect(screen.getByText('main 6b331e4', { exact: false })).toBeInTheDocument();

    const lanes = screen.getByRole('list', { name: 'Round 41 lanes' });
    expect(within(lanes).getByRole('meter', { name: 'core.ops' })).toHaveAttribute('aria-valuetext', 'fix, 12 min in');
    expect(within(lanes).getAllByTitle(/studio · 12 min/).some((el) => el.textContent === 'studio · 12 min')).toBe(true);
    expect(within(lanes).getAllByText('studio')).not.toHaveLength(0);
    expect(screen.getByText('conflict')).toBeInTheDocument();
    expect(screen.queryByRole('meter', { name: 'all areas, fleet tests' })).not.toBeInTheDocument();

    const stats = screen.getByRole('region', { name: 'Headline stats' });
    expect(within(stats).getByText('4 / 6')).toBeInTheDocument();
    expect(within(stats).getByText('≈13')).toBeInTheDocument();

    expect(screen.getByRole('img', { name: /Treemap of every audit area/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Defects found and estimated per area, by round' })).toBeInTheDocument();
    expect(screen.getByText('1 finding, read 9 of 12 files')).toBeInTheDocument();
  });

  it("lists in the run's strip every branch its batch left out, one an earlier round left out among them", async () => {
    const leftOut = [{ area: 'ui.badge', round: 39, why: 'merge failed: lock' }, { area: 'core.ops', round: 41, why: 'conflicts in a.ts' }];
    serve(200, { ...fixture, runs: [{ ...fixture.runs[0], leftOut }, fixture.runs[1]] });
    renderPage();
    const table = await screen.findByRole('table', { name: 'Round 41, left out of the batch' });
    const rows = within(table).getAllByRole('row').slice(1).map((r) => [...r.querySelectorAll('td')].map((td) => td.textContent));
    expect(rows).toEqual([['ui.badge', '39', 'merge failed: lock'], ['core.ops', '41', 'conflicts in a.ts']]);
  });

  it('opens an area picked from the queue, through the map selection, with its defects', async () => {
    serve(200, fixture);
    renderPage();
    expect(await screen.findByText('Hover or click an area for its passes.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Next up' }));
    fireEvent.click(await screen.findByRole('button', { name: /core\.scene/ }));
    const detail = screen.getAllByText('core.scene', { selector: 'div' })[0]!.parentElement!;
    expect(within(detail).getByText('due again')).toBeInTheDocument();
    expect(within(detail).getByRole('table')).toHaveTextContent('33');
    expect(await screen.findByText('A scene write is lost on undo')).toBeInTheDocument();
    // The fixer's note is behind the tile, which a note makes a button.
    expect(screen.queryByText('Undo now keeps it.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'fixed: details' }));
    expect(await screen.findByText('Undo now keeps it.')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Defect details' }), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText('Undo now keeps it.')).toBeNull());

    fireEvent.click(within(screen.getByRole('list', { name: 'Round 41 lanes' })).getByRole('button', { name: 'core.ops' }));
    expect(screen.getByText('in round 41')).toBeInTheDocument();
  });

  it('says it needs the dev server where there is none', async () => {
    renderPage(false);
    expect(screen.getByText(/reads the audit map from the dashboard's dev server/)).toBeInTheDocument();

    cleanup();
    serve(404, 'not found');
    renderPage();
    expect(await screen.findByText(/reads the audit map from the dashboard's dev server/)).toBeInTheDocument();
  });

  it('titles the page with its tenant, and stands on a map without a project', async () => {
    serve(200, fixture);
    renderPage();
    // The title comes with the tenant list, before the map that names the partition.
    expect(await screen.findByText('docs/audits/partition.json')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Project' })).toHaveValue('example');

    cleanup();
    const { project: _p, branch: _b, partition: _a, ...bare } = fixture;
    serve(200, bare);
    renderPage();
    expect(await screen.findByText('6b331e4', { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Project' })).toHaveValue('example');
    expect(screen.getByText(/Each area is a directory of source files\./)).toBeInTheDocument();
  });

  it('says why the map could not be read', async () => {
    serve(500, 'map.mjs blew up');
    renderPage();
    expect(await screen.findByText(/Couldn't read the audit map: 500 map\.mjs blew up/)).toBeInTheDocument();
  });
});
