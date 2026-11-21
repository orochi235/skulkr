import { cleanup, screen } from '@testing-library/react';
import { WeaselProvider } from '@weasel-js/core';
import { renderWithIcons } from '@dash/test/icons';
import { afterEach, describe, expect, it } from 'vitest';
import { AreaDetail } from './AreaDetail';
import type { AuditArea } from './skulkrMap.types';

const pass = { round: 40, date: '2026-11-19', a: 4, b: 3, shared: 2, distinct: 5, est: 6.7, left: 1.7 };
const area = (extra = {}): AuditArea => ({ id: 'core.ops', group: 'core', files: 24, status: 'due', queue: 1, passes: [{ ...pass, ...extra }], stage: null });
const show = (a: AuditArea) => renderWithIcons(<WeaselProvider><AreaDetail area={a} holder={undefined} /></WeaselProvider>);

afterEach(cleanup);

describe('AreaDetail', () => {
  it('gives the corrected left and estimate beside the raw ones', () => {
    show(area({ leftCorrected: 8.5 }));
    expect(screen.getByText(/^1\.7 \(≈9 corrected\)$/)).toBeTruthy();
    const cells = [...document.querySelectorAll('tbody td')].map((td) => td.textContent);
    expect(cells.slice(-2)).toEqual(['6.7 ≈14', '1.7 ≈9']);
  });

  it('shows the raw figures alone where the map has no calibration', () => {
    show(area());
    expect([...document.querySelectorAll('tbody td')].map((td) => td.textContent).slice(-2)).toEqual(['6.7', '1.7']);
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
