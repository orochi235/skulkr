import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PrefsButton, isPrefsShortcut } from './PrefsButton';

const key = (over: Partial<KeyboardEvent>) => ({ key: ',', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...over });

describe('PrefsButton', () => {
  it('takes Cmd+comma, or Ctrl+comma, and nothing else', () => {
    expect(isPrefsShortcut(key({ metaKey: true }))).toBe(true);
    expect(isPrefsShortcut(key({ ctrlKey: true }))).toBe(true);
    expect(isPrefsShortcut(key({}))).toBe(false);
    expect(isPrefsShortcut(key({ metaKey: true, shiftKey: true }))).toBe(false);
    expect(isPrefsShortcut(key({ metaKey: true, key: '.' }))).toBe(false);
  });

  it('opens the prefs dialog on Cmd+comma', async () => {
    render(<PrefsButton />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.keyDown(window, { key: ',', metaKey: true });
    expect(await screen.findByRole('dialog', { name: 'Dashboard prefs' })).toBeInTheDocument();
  });
});
