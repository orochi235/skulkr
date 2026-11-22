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
});
