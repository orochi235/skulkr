// @vitest-environment node
import type { ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { areaOfChange, createFeed, watchedOf } from './feed';

const mapWith = (n: number, nightDir = '/s/nights/n88') => JSON.stringify({ n, runs: [{ running: true, nightDir }] });

/** A response that keeps what is written to it. */
const response = () => {
  const frames: string[] = [];
  const res = { writeHead: vi.fn(), write: (f: string) => (frames.push(f), true) } as unknown as ServerResponse;
  const events = () => frames.filter((f) => f.startsWith('event:')).map((f) => {
    const [, event, data] = /^event: (\w+)\ndata: (.*)\n\n$/s.exec(f)!;
    return [event, data];
  });
  return { res, events };
};

const setup = () => {
  const watched = new Map<string, (file: string) => void>();
  let built = 0;
  let text = mapWith(0);
  const rebuild = vi.fn(async () => (text = mapWith(++built)));
  const feed = createFeed({
    current: async () => text, rebuild, debounceMs: 10, gapMs: 50, everyMs: 60_000,
    watch: (dir, onChange) => (watched.set(dir, onChange), { close: () => watched.delete(dir) }),
  });
  let close = () => {};
  const subscribe = () => {
    const r = response();
    feed.subscribe(r.res, (fn) => { close = fn; });
    return { ...r, close: () => close() };
  };
  return { feed, watched, rebuild, subscribe };
};

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('createFeed', () => {
  it('sends the kept map on connecting, then each changed build, and touched areas as their files change', async () => {
    const { watched, rebuild, subscribe } = setup();
    const a = subscribe();
    await vi.advanceTimersByTimeAsync(20);
    expect(a.events()).toEqual([['map', mapWith(0)], ['map', mapWith(1)]]);
    expect([...watched.keys()]).toEqual(['/s/nights/n88', '/s/runs']);
    watched.get('/s/nights/n88')!('jobs/core.ops/A.log');
    watched.get('/s/nights/n88')!('jobs/core.ops/A.log');
    watched.get('/s/nights/n88')!('night.log');
    // No sooner than the gap after the last build, and one build and one areas event for the burst.
    await vi.advanceTimersByTimeAsync(60);
    expect(rebuild).toHaveBeenCalledTimes(2);
    expect(a.events().slice(2)).toEqual([['map', mapWith(2)], ['areas', '["core.ops"]']]);
  });

  it('stops watching once the last page leaves', async () => {
    const { watched, rebuild, subscribe } = setup();
    const a = subscribe();
    await vi.advanceTimersByTimeAsync(20);
    a.close();
    expect(watched.size).toBe(0);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(rebuild).toHaveBeenCalledTimes(1);
  });

  it('pushes a map built for another reason, only when it changed', async () => {
    const { feed, subscribe } = setup();
    const a = subscribe();
    await vi.advanceTimersByTimeAsync(20);
    feed.built(mapWith(1));
    feed.built(mapWith(7));
    expect(a.events().map(([, d]) => JSON.parse(d!).n)).toEqual([0, 1, 7]);
  });
});

describe('watchedOf and areaOfChange', () => {
  it("watches each running round's night and the state's runs, and reads an area from a night's path", () => {
    expect(watchedOf(JSON.stringify({ runs: [{ running: false, nightDir: '/s/nights/a' }, { running: true, nightDir: '/s/nights/b' }] })))
      .toEqual(['/s/nights/b', '/s/runs']);
    expect(watchedOf('not json')).toEqual([]);
    expect(['jobs/x/A.log', 'areas/y/match.json', 'night.log', 'jobs/x'].map(areaOfChange)).toEqual(['x', 'y', null, null]);
  });
});

describe('filesUnder', () => {
  it('lists files four levels down with their size and change time', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { filesUnder } = await import('./feed');
    const dir = mkdtempSync(join(tmpdir(), 'skulkr-feed-'));
    mkdirSync(join(dir, 'jobs/x/A/deeper'), { recursive: true });
    for (const f of ['night.log', 'jobs/x/A.log', 'jobs/x/A/findings.md', 'jobs/x/A/deeper/skip.txt']) writeFileSync(join(dir, f), 'x');
    expect([...filesUnder(dir).keys()].sort()).toEqual(['jobs/x/A.log', 'jobs/x/A/findings.md', 'night.log']);
    rmSync(dir, { recursive: true, force: true });
  });
});
