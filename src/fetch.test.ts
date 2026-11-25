import { describe, expect, it } from 'vitest';
import { fetchCommand } from './fetch.mjs';

describe('fetchCommand', () => {
  it('refreshes the listings until stopped, since the last day with no runs, and does nothing for a runner that keeps none', async () => {
    const asked: string[] = [];
    let stop = () => {};
    const stopped = new Promise<void>((r) => { stop = r; });
    const runner = { refresh: (since: string) => { asked.push(since); if (asked.length === 2) stop(); } };
    await fetchCommand({ state: '/nowhere' }, runner, ['--every', '0.01'], stopped);
    expect(asked).toHaveLength(2);
    expect(Date.now() - Date.parse(asked[0]!)).toBeGreaterThan(86_000_000);
    await fetchCommand({ state: '/nowhere' }, {}, [], new Promise(() => {}));
    await expect(fetchCommand({ state: '/nowhere' }, runner, ['--every', '0'])).rejects.toThrow('--every');
  });
});
