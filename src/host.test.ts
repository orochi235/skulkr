import { describe, expect, it } from 'vitest';
import { createHost, tenantFor } from './host.mjs';

const at = (hhmm: string, day = 16) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2026, 10, day, h!, m!);
};

/** A tenant whose runs are `live` rounds; each start is recorded in `starts` and makes it run. */
const tenant = (name: string, { startAt = '23:00', readOnly = false } = {}) => {
  const t = {
    name, readOnly, startAt,
    live: [] as number[],
    starts: [] as string[][],
    running: () => t.live.length > 0,
    lastStarted: () => undefined,
    deps: {
      build: `${name}-sha`,
      live: () => t.live,
      status: () => ({ running: t.live.length > 0, runs: t.live.map((round) => ({ round })) }),
      plan: async () => [`${name} plan`],
      start: (args: string[]) => {
        t.starts.push(args);
        t.live.push(t.live.length + 1);
        return args;
      },
      stop: () => {},
    },
  };
  return t;
};

describe('tenantFor', () => {
  const list = [tenant('a'), tenant('b')];
  it('takes the tenant a request names, or the only one, and refuses to guess among several', () => {
    expect(tenantFor({ tenant: 'b' }, list).name).toBe('b');
    expect(tenantFor({}, [list[0]]).name).toBe('a');
    expect(() => tenantFor({}, list)).toThrow('several tenants (a, b)');
    expect(() => tenantFor({ tenant: 'c' }, list)).toThrow('no tenant c');
  });
});

describe('createHost', () => {
  const host = (list: ReturnType<typeof tenant>[], clock: { now: Date }) =>
    createHost({ tenants: () => list, now: () => clock.now, build: 'host' });

  it('routes a request to its tenant, and refuses one naming none while several are hosted', async () => {
    const [a, b] = [tenant('a'), tenant('b')];
    const h = host([a, b], { now: at('12:00') });
    expect(await h.request('{"id":1,"ping":true}')).toEqual({ id: 1, pong: true, build: 'host', tenants: ['a', 'b'] });
    expect(await h.request('{"id":2,"plan":true,"tenant":"b"}')).toEqual({ tenant: 'b', id: 2, plan: ['b plan'] });
    expect(await h.request('{"id":3,"status":true}')).toMatchObject({ id: 3, error: expect.stringContaining('name one') });
    expect(await h.request('{"id":4,"status":true}'.replace('}', ',"tenant":"a"}'))).toMatchObject({ tenant: 'a', running: false });
  });

  it('means the only tenant when a request names none', async () => {
    const a = tenant('a');
    const h = host([a], { now: at('12:00') });
    expect(await h.request('{"id":1,"start":true,"areas":2}')).toEqual({ tenant: 'a', id: 1, started: true, args: ['--areas', '2'] });
    expect(a.starts).toEqual([['--areas', '2']]);
  });

  it('holds a start while another tenant\'s round runs, says so in its status, and starts it when that ends', async () => {
    const [a, b] = [tenant('a'), tenant('b')];
    a.live = [41];
    const h = host([a, b], { now: at('12:00') });
    expect(await h.request('{"id":1,"start":true,"tenant":"b"}')).toEqual({ tenant: 'b', id: 1, started: false, waiting: true, behind: 'a', args: [] });
    expect(await h.request('{"id":2,"status":true,"tenant":"b"}')).toMatchObject({ waiting: [{ behind: 'a', scheduled: false }] });
    // a's next start waits behind b's, which has waited longer.
    expect(await h.request('{"id":3,"start":true,"tenant":"a"}')).toMatchObject({ started: false, behind: 'b' });
    h.tick();
    expect(b.starts).toEqual([]);
    a.live = [];
    h.tick();
    expect(b.starts).toEqual([[]]);
    expect(a.starts).toEqual([]);
    b.live = [];
    h.tick();
    expect(a.starts).toEqual([[]]);
  });

  it('keeps each tenant\'s own schedule, armed at first sight so a restart starts nothing', () => {
    const clock = { now: at('23:30') };
    const [a, b] = [tenant('a', { startAt: '23:00' }), tenant('b', { startAt: '01:00' })];
    const h = host([a, b], clock);
    h.tick();
    expect(a.starts).toEqual([]);
    clock.now = at('23:00', 17);
    h.tick();
    expect(a.starts).toEqual([[]]);
    // b comes due while a's round runs, and waits for it.
    clock.now = at('01:00', 18);
    h.tick();
    expect(b.starts).toEqual([]);
    expect(h.queue).toMatchObject([{ tenant: 'b', auto: true }]);
    a.live = [];
    clock.now = at('02:10', 18);
    h.tick();
    expect(b.starts).toEqual([[]]);
  });

  it('picks up a tenant added while it runs, and never starts a read-only one', async () => {
    const list = [tenant('a')];
    const clock = { now: at('22:00') };
    const h = host(list, clock);
    h.tick();
    const ro = tenant('ro', { readOnly: true });
    list.push(ro);
    ro.live = [50];
    expect(await h.request('{"id":1,"start":true,"tenant":"ro"}')).toMatchObject({ error: expect.stringContaining('read-only') });
    clock.now = at('23:00');
    h.tick();
    // ro's live round holds the fleet.
    expect(list[0]!.starts).toEqual([]);
    ro.live = [];
    h.tick();
    expect(list[0]!.starts).toEqual([[]]);
    expect(ro.starts).toEqual([]);
  });
});
