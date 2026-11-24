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
  it("shows who listed each defect only in a round not yet recorded, both reviewers as ∩, the fixer's own as ★, and a carried one with a clock", async () => {
    const items = [
      { claim: 'old claim', from: 'carried', verdict: 'not a defect', note: '' },
      { claim: 'new claim', from: 'A+B', verdict: 'fixed', note: '' },
      { claim: 'found by the fixer', from: 'extra', verdict: 'fixed', note: '' },
    ];
    const rounds = [{ round: 71, recorded: false, fixed: true, items }, { round: 70, recorded: true, fixed: true, items }];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(rounds))));
    renderWithIcons(<WeaselProvider><AreaDefects urlOf={() => '/defects'} id="core.ops" version="1" /></WeaselProvider>);
    const heads = (name: string) => [...screen.getByRole('table', { name }).querySelectorAll('th')].map((th) => th.textContent);
    await screen.findByRole('table', { name: "Round 71's defects" });
    expect(heads("Round 71's defects")).toEqual(['verdict', 'from', 'claim']);
    expect(heads("Round 70's defects")).toEqual(['verdict', 'claim']);
    const carried = screen.getByText('carried').closest('span')!;
    expect(carried.title).toMatch(/earlier round/);
    expect(carried.querySelector('svg')).toBeTruthy();
    expect(screen.getAllByText('∩')).toHaveLength(1);
    expect(screen.getByText('★').title).toMatch(/fixer found itself/);
    expect(screen.queryByText('extra')).toBeNull();
    expect(screen.getAllByText("won't fix")).toHaveLength(2);
    expect(screen.queryByText('not a defect')).toBeNull();
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
