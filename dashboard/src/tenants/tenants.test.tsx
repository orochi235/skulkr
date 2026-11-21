import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { TenantTitle } from './TenantTitle';
import { useTenantChoice, useTenants } from './useTenants';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = '';
  localStorage.clear();
});

describe('useTenants', () => {
  it('lists the tenants the dev server reads, and reads an HTML fallback as no server', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[{"name":"weasel"},{"name":"demo"}]', { status: 200, headers: { 'content-type': 'application/json' } })));
    const { result } = renderHook(() => useTenants({ url: '/api/tenants', dev: true, everyMs: 60_000 }));
    await waitFor(() => expect(result.current).toEqual({ status: 'ready', names: ['weasel', 'demo'] }));

    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } })));
    const bare = renderHook(() => useTenants({ url: '/api/tenants', dev: true, everyMs: 60_000 }));
    await waitFor(() => expect(bare.result.current.status).toBe('no-server'));
    expect(renderHook(() => useTenants({ url: '/api/tenants', dev: false })).result.current.status).toBe('no-server');
  });
});

describe('useTenantChoice', () => {
  it('takes the tenant the hash names, else the one chosen last, else the first', () => {
    const names = ['weasel', 'demo'];
    expect(renderHook(() => useTenantChoice(names)).result.current[0]).toBe('weasel');
    localStorage.setItem('skulkr.dashboard.tenant', 'demo');
    expect(renderHook(() => useTenantChoice(names)).result.current[0]).toBe('demo');
    window.location.hash = '#weasel';
    expect(renderHook(() => useTenantChoice(names)).result.current[0]).toBe('weasel');
    window.location.hash = '#gone';
    expect(renderHook(() => useTenantChoice(names)).result.current[0]).toBe('demo');
    expect(renderHook(() => useTenantChoice([])).result.current[0]).toBeNull();
  });

  it('puts a choice in the hash and remembers it, and follows the hash when it changes', () => {
    const { result } = renderHook(() => useTenantChoice(['weasel', 'demo']));
    act(() => result.current[1]('demo'));
    expect(result.current[0]).toBe('demo');
    expect(window.location.hash).toBe('#demo');
    expect(localStorage.getItem('skulkr.dashboard.tenant')).toBe('demo');
    act(() => {
      window.location.hash = '#weasel';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(result.current[0]).toBe('weasel');
  });
});

describe('TenantTitle', () => {
  it('names the tenant in a menu of every tenant, even when there is one', () => {
    const onChoose = vi.fn();
    const { rerender } = render(<h1><TenantTitle names={['weasel']} current="weasel" onChoose={onChoose} /></h1>);
    const menu = screen.getByRole('combobox', { name: 'Project' });
    expect(menu).toHaveValue('weasel');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['weasel']);
    rerender(<h1><TenantTitle names={['weasel', 'demo']} current="weasel" onChoose={onChoose} /></h1>);
    fireEvent.change(screen.getByRole('combobox', { name: 'Project' }), { target: { value: 'demo' } });
    expect(onChoose).toHaveBeenCalledWith('demo');
    expect(screen.getByRole('heading')).toHaveTextContent(/^skulkr⨯/);
  });
});
