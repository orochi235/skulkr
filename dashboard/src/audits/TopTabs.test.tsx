import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { WeaselProvider } from '@weasel-js/core';
import { renderWithIcons } from '@dash/test/icons';
import { TopTabs } from './TopTabs';
import { BottomTabs } from './BottomTabs';
import type { AuditArea } from './skulkrMap.types';

afterEach(cleanup);

const area = (id: string, pinned = false) => ({ id, group: 'core', files: 3, status: 'audited', queue: null, passes: [], stage: null, ...(pinned ? { pinned } : {}) }) as unknown as AuditArea;

describe('TopTabs', () => {
  it('holds the rounds and calibration charts, a tab each', () => {
    renderWithIcons(<WeaselProvider><TopTabs rounds={[]} areas={[]} /></WeaselProvider>);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Rounds', 'Calibration']);
  });
});

describe('BottomTabs', () => {
  it('lists the pinned areas under their own tab, each with its toggle', async () => {
    renderWithIcons(<WeaselProvider><BottomTabs areas={[area('core.a', true), area('core.b')]} next={[]} onPick={() => {}} onLight={() => {}} onPin={async () => {}} /></WeaselProvider>);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Next up', 'Pinned']);
    screen.getByRole('tab', { name: 'Pinned' }).click();
    expect(await screen.findByRole('button', { name: 'core.a' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'core.b' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Pinned' })).toBeInTheDocument();
  });
});
