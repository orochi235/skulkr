import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { defineTheme } from '@weasel-js/theme';
import { ThemeProvider } from '@weasel-js/theme/react';
import { renderWithIcons } from '@dash/test/icons';
import { ColorModeProvider } from './colorMode';
import { Shell } from './Shell';

const KEY = 'skulkr.dashboard.colorMode';
const theme = defineTheme({ name: 'skulkr-dashboard' });

/** A system that asks for light or not, and can change its mind. */
function system(light: boolean) {
  const listeners = new Set<() => void>();
  const mq = {
    get matches() { return light; },
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  vi.stubGlobal('matchMedia', vi.fn((query: string) => (query === '(prefers-color-scheme: light)' ? mq : { matches: false, addEventListener() {}, removeEventListener() {} })));
  return {
    set(next: boolean) {
      light = next;
      act(() => { for (const fn of listeners) fn(); });
    },
  };
}

/** The app's frame as `main.tsx` mounts it, with the page swapped for a plain shell. */
function renderApp() {
  renderWithIcons(
    <ColorModeProvider>
      {(mode) => (
        <ThemeProvider theme={theme} selection={{ mode }} className="app-theme">
          <Shell title="Audits" header={<span>stamp</span>}><p>body</p></Shell>
        </ThemeProvider>
      )}
    </ColorModeProvider>,
  );
}

const modeOnPage = () => document.querySelector('.app-theme')?.getAttribute('data-wzl-mode');

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('the color mode', () => {
  it('offers auto, light, and dark at the far right of the header', () => {
    system(true);
    renderApp();
    const group = screen.getByRole('radiogroup', { name: 'Color mode' });
    expect(['Auto', 'Light', 'Dark'].map((name) => screen.getByRole('radio', { name }))).toHaveLength(3);
    expect(screen.getByRole('radio', { name: 'Auto' })).toBeChecked();
    const actions = screen.getByText('stamp').parentElement;
    expect(actions?.lastElementChild?.contains(group)).toBe(true);
    expect(actions?.firstElementChild).toHaveTextContent('stamp');
  });

  it('applies the choice to the theme and keeps it', () => {
    system(true);
    renderApp();
    expect(modeOnPage()).toBe('light');
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(modeOnPage()).toBe('dark');
    expect(localStorage.getItem(KEY)).toBe('dark');
  });

  it('starts from the kept choice, over what the system asks for', () => {
    system(false);
    localStorage.setItem(KEY, 'light');
    renderApp();
    expect(modeOnPage()).toBe('light');
    expect(screen.getByRole('radio', { name: 'Light' })).toBeChecked();
  });

  it('follows the system live on auto, and stops once a mode is chosen', () => {
    const os = system(true);
    renderApp();
    expect(modeOnPage()).toBe('light');
    os.set(false);
    expect(modeOnPage()).toBe('dark');
    os.set(true);
    expect(modeOnPage()).toBe('light');
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    os.set(true);
    expect(modeOnPage()).toBe('dark');
  });

  it('takes auto for a kept value that is no mode', () => {
    system(false);
    localStorage.setItem(KEY, 'sepia');
    renderApp();
    expect(screen.getByRole('radio', { name: 'Auto' })).toBeChecked();
    expect(modeOnPage()).toBe('dark');
  });
});
