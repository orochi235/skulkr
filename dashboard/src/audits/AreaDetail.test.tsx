import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { WeaselProvider } from '@weasel-js/core';
import { renderWithIcons } from '@dash/test/icons';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AreaDetail } from './AreaDetail';
import type { AuditArea } from './skulkrMap.types';

const pass = { round: 40, date: '2026-11-19', a: 4, b: 3, shared: 2, distinct: 5, est: 6.7, left: 1.7 };
const area = (extra = {}): AuditArea => ({ id: 'core.ops', group: 'core', files: 24, status: 'due', queue: 1, passes: [{ ...pass, ...extra }], stage: null });
const show = (a: AuditArea) => renderWithIcons(<WeaselProvider><AreaDetail area={a} holder={undefined} /></WeaselProvider>);

afterEach(cleanup);

describe('AreaDetail', () => {
  it('gives the corrected left and estimate each in its own column beside the raw ones', () => {
    show(area({ leftCorrected: 8.5 }));
    expect(screen.getByText(/^1\.7 \(≈9 corrected\)$/)).toBeTruthy();
    const cells = [...document.querySelectorAll('tbody td')].map((td) => td.textContent);
    expect(cells.slice(-4)).toEqual(['6.7', '≈14', '1.7', '≈9']);
  });

  it('shows the raw figures alone where the map has no calibration', () => {
    show(area());
    expect([...document.querySelectorAll('thead th')]).toHaveLength(5);
    expect([...document.querySelectorAll('tbody td')].map((td) => td.textContent).slice(-2)).toEqual(['6.7', '1.7']);
  });

  it("gives a pass's share its own column, blank for a pass that holds all its files", () => {
    const a = area();
    show({ ...a, passes: [a.passes[0]!, { ...pass, round: 41, share: 0.5 }] });
    const rows = [...document.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].slice(0, 2).map((td) => td.textContent));
    expect(rows).toEqual([['40', ''], ['41', '50%']]);
  });
});

const withOpen: AuditArea = {
  id: 'theme.engine', group: 'theme', files: 29, status: 'due', queue: null, passes: [], stage: null,
  openFindings: 2,
  open: [
    { round: 56, claim: 'An offset rule with a fractional offset throws', where: 'packages/theme/src/engine/ramps.ts:40' },
    { round: 57, claim: 'A gray anchor drags its hue', where: 'packages/theme/src/engine/color/generate.ts:88' },
  ],
};

describe('AreaDetail open findings', () => {
  it('counts the open findings and lists each with the round that reported it', () => {
    show(withOpen);
    const items = screen.getByRole('list', { name: 'open findings' }).querySelectorAll('li');
    expect([...items].map((li) => li.textContent)).toEqual(['r56 An offset rule with a fractional offset throws', 'r57 A gray anchor drags its hue']);
    expect(items[0]!.getAttribute('title')).toBe('packages/theme/src/engine/ramps.ts:40');
  });

  it('shows no list for an area with none open', () => {
    const { openFindings: _count, open: _list, ...bare } = withOpen;
    show(bare);
    expect(screen.queryByRole('list', { name: 'open findings' })).toBeNull();
  });
});

describe('AreaDetail pin', () => {
  const pinIn = (a: AuditArea, onPin: (id: string, on: boolean) => Promise<void>, asOf: number | null = null) =>
    renderWithIcons(<WeaselProvider><AreaDetail area={a} holder={undefined} asOf={asOf} onPin={onPin} /></WeaselProvider>);

  it('pins an unpinned area and unpins a pinned one', async () => {
    const onPin = vi.fn(async () => {});
    pinIn(area(), onPin);
    const pin = screen.getByRole('button', { name: 'Pin' });
    expect(pin.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(pin);
    expect(onPin).toHaveBeenCalledWith('core.ops', true);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pin' }).hasAttribute('disabled')).toBe(false));
    cleanup();
    pinIn({ ...area(), pinned: true }, onPin);
    const pinned = screen.getByRole('button', { name: 'Pinned' });
    expect(pinned.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(pinned);
    expect(onPin).toHaveBeenLastCalledWith('core.ops', false);
  });

  it("says why the server refused, and offers no pin on a past round's map", async () => {
    pinIn(area(), async () => { throw new Error('no area "core.ops" in weasel'); });
    fireEvent.click(screen.getByRole('button', { name: 'Pin' }));
    expect((await screen.findByRole('alert')).textContent).toBe('no area "core.ops" in weasel');
    cleanup();
    pinIn(area(), vi.fn(), 40);
    expect(screen.queryByRole('button', { name: /^Pin/ })).toBeNull();
  });
});
