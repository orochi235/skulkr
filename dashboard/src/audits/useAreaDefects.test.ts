import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useAreaDefects } from './useAreaDefects';

const ROUNDS = [{ round: 41, recorded: true, fixed: true, items: [] }];
const urlOf = (id: string) => `/test/api/t/example/area?id=${id}`;

function serve(...answers: (() => Response)[]) {
  let i = 0;
  vi.stubGlobal('fetch', vi.fn(async () => answers[Math.min(i++, answers.length - 1)]!()));
}

afterEach(() => vi.unstubAllGlobals());

describe('useAreaDefects', () => {
  it("keeps the area's last list when a later ask fails, and says why beside it", async () => {
    serve(() => new Response(JSON.stringify(ROUNDS), { status: 200 }), () => new Response('defects.mjs blew up', { status: 500 }));
    const { result, rerender } = renderHook(({ version }) => useAreaDefects(urlOf, 'core.ops', version), { initialProps: { version: 'a' } });
    await waitFor(() => expect(result.current).toEqual({ status: 'ready', rounds: ROUNDS }));
    rerender({ version: 'b' });
    await waitFor(() => expect(result.current).toEqual({ status: 'ready', rounds: ROUNDS, error: '500 defects.mjs blew up' }));
  });

  it('fails outright where it has no list of that area to keep', async () => {
    serve(() => new Response(JSON.stringify(ROUNDS), { status: 200 }), () => new Response('nope', { status: 500 }));
    const { result, rerender } = renderHook(({ id }) => useAreaDefects(urlOf, id, 'a'), { initialProps: { id: 'core.ops' } });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    rerender({ id: 'core.debug' });
    await waitFor(() => expect(result.current).toEqual({ status: 'failed', error: '500 nope' }));
  });
});
