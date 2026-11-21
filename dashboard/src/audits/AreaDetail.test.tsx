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
