import { cleanup, screen } from '@testing-library/react';
import { WeaselProvider } from '@weasel-js/core';
import { renderWithIcons } from '@dash/test/icons';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AreaDefects } from './AreaDefects';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AreaDefects', () => {
  it('marks a carried defect with a clock turned back, and names its other sources as they are', async () => {
    const rounds = [{ round: 70, recorded: true, fixed: true, items: [
      { claim: 'old claim', from: 'carried', verdict: 'not a defect', note: '' },
      { claim: 'new claim', from: 'A+B', verdict: 'fixed', note: '' },
    ] }];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(rounds))));
    renderWithIcons(<WeaselProvider><AreaDefects urlOf={() => '/defects'} id="core.ops" version="1" /></WeaselProvider>);
    const carried = (await screen.findByText('carried')).closest('span')!;
    expect(carried.title).toMatch(/earlier round/);
    expect(carried.querySelector('svg')).toBeTruthy();
    expect(screen.getByText('A+B').querySelector('svg')).toBeNull();
  });

  it("lists each round's defects as rows, and makes only a claim with more to read a button", async () => {
    const rounds = [{ round: 71, recorded: true, fixed: true, items: [
      { claim: 'short claim', from: 'A', verdict: 'fixed', note: '' },
      { claim: 'noted claim', from: 'B', verdict: 'not fixed', note: 'the fixer says why' },
    ] }];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(rounds))));
    renderWithIcons(<WeaselProvider><AreaDefects urlOf={() => '/defects'} id="core.ops" version="1" /></WeaselProvider>);
    const table = await screen.findByRole('table', { name: "Round 71's defects" });
    expect(table.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(screen.getByText('short claim').closest('[role="button"]')).toBeNull();
    expect(screen.getByText('noted claim').closest('[role="button"]')).toHaveAttribute('aria-haspopup', 'dialog');
  });
});
