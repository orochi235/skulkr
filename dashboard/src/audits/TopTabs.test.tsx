import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { WeaselProvider } from '@weasel-js/core';
import { renderWithIcons } from '@dash/test/icons';

const width = vi.hoisted(() => ({ px: 0 }));
vi.mock('@weasel-js/routing/react', async (load) => ({
  ...(await load<object>()),
  useElementSize: () => ({ width: width.px, height: 200 }),
}));

const { BOTH_FIT_PX, TopTabs } = await import('./TopTabs');

const render = () => renderWithIcons(
  <WeaselProvider><TopTabs rounds={[]} areas={[]} next={[]} onPick={() => {}} onLight={() => {}} /></WeaselProvider>,
);

afterEach(cleanup);

describe('TopTabs', () => {
  it('puts the charts, a tab each, beside the queue where the pane fits both, and a tab each of all three where it does not', () => {
    width.px = BOTH_FIT_PX;
    render();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Rounds', 'Calibration']);
    expect(screen.getByRole('heading', { name: 'Next up' })).toBeInTheDocument();
    cleanup();
    width.px = BOTH_FIT_PX - 1;
    render();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Rounds', 'Calibration', 'Next up']);
  });
});
