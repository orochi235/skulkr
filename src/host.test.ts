import { describe, expect, it } from 'vitest';
import { nextContinuous } from './continuous.mjs';
import { createHost, tenantFor } from './host.mjs';

const at = (hhmm: string, day = 16) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2026, 10, day, h!, m!);
};

/** A tenant whose runs are `live` rounds; each start is recorded in `starts` and makes it run. */
const tenant = (name: string, { startAt = '23:00', readOnly = false, stopAt = undefined as string | undefined } = {}) => {
  const t = {
    name, readOnly, startAt, stopAt,
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

  it('skips a scheduled start held behind another tenant until past its stopAt', () => {
    const clock = { now: at('22:00') };
    const [a, b] = [tenant('a', { startAt: '23:00' }), tenant('b', { startAt: '01:00', stopAt: '07:00' })];
    const h = host([a, b], clock);
    h.tick();
    clock.now = at('23:00');
    h.tick();
    clock.now = at('01:00', 17);
    h.tick();
    expect(h.queue).toMatchObject([{ tenant: 'b', auto: true }]);
    a.live = [];
    clock.now = at('08:00', 17);
    h.tick();
    expect(b.starts).toEqual([]);
    expect(h.queue).toEqual([]);
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
    expect(await h.request('{"id":2,"status":true,"tenant":"ro"}')).not.toHaveProperty('nextStart');
    expect(await h.request('{"id":3,"status":true,"tenant":"a"}')).toHaveProperty('nextStart');
  });
});

describe('continuous rounds', () => {
  /** A tenant in continuous mode whose rounds move through `steps`; each decision is `nextContinuous`'s on them. */
  const continuous = (name: string, { readOnly = false, nightUsd = 200, spent = 0, estimate = 50 } = {}) => {
    const t = tenant(name, { readOnly });
    const runs: { round: number; step: string }[] = [];
    let on = false;
    const decide = (now: Date) => {
      const mode = on ? { on: true, by: 'request', until: at('07:00', 17).toISOString() } : { on: false, by: 'off' };
      return {
        mode,
        next: nextContinuous({ now, mode, readOnly, runs, spentUsd: spent, estimateUsd: estimate, nightUsd, capUsd: 160 }),
        budget: { nightUsd, spentUsd: spent, leftUsd: nightUsd - spent, estimateUsd: estimate },
        queues: { model: null, fleet: { holder: null, waiting: [] } },
      };
    };
    return Object.assign(t, {
      runs,
      running: () => runs.some((r) => r.step !== 'done'),
      modelBusy: () => runs.some((r) => r.step === 'review'),
      scheduledContinuous: false,
      continuous: decide,
      setContinuous: (value: boolean) => { on = value; },
      setSpent: (usd: number) => { spent = usd; },
      deps: {
        ...t.deps,
        start: (args: string[]) => {
          t.starts.push(args);
          runs.push({ round: 50 + runs.length, step: 'review' });
          return args;
        },
      },
    });
  };
  const host = (list: ReturnType<typeof tenant>[]) => createHost({ tenants: () => list, now: () => at('23:30'), build: 'host' });

  it('starts a round on request, the next when that one reaches its batch, until the budget runs out', async () => {
    const a = continuous('a');
    const h = host([a]);
    expect(await h.request('{"id":1,"start":true,"continuous":true}')).toMatchObject({ tenant: 'a', continuous: true, started: true });
    expect(a.starts).toEqual([['--cap-usd', '160']]);
    h.tick();
    expect(a.starts).toHaveLength(1);
    expect(await h.request('{"id":2,"status":true}')).toMatchObject({
      continuous: { on: true, next: 'round 50 is in its model steps', nightUsd: 200 },
    });
    a.runs[0]!.step = 'batch';
    a.setSpent(120);
    h.tick();
    expect(a.starts).toEqual([['--cap-usd', '160'], ['--cap-usd', '80']]);
    a.runs[1]!.step = 'fleet-wait';
    a.setSpent(160);
    h.tick();
    expect(a.starts).toHaveLength(2);
    expect(await h.request('{"id":3,"status":true}')).toMatchObject({ continuous: { next: expect.stringContaining('the night\'s budget') } });
  });

  it('ends with a bare stop, and refuses a read-only tenant or one with no nightly budget', async () => {
    const a = continuous('a');
    const h = host([a]);
    await h.request('{"id":1,"start":true,"continuous":true}');
    expect(await h.request('{"id":2,"stop":true}')).toMatchObject({ continuous: false });
    a.runs[0]!.step = 'batch';
    h.tick();
    expect(a.starts).toHaveLength(1);
    const ro = continuous('ro', { readOnly: true });
    expect(await host([ro]).request('{"id":3,"start":true,"continuous":true}')).toMatchObject({ error: expect.stringContaining('read-only') });
    expect(ro.starts).toEqual([]);
    const poor = continuous('poor', { nightUsd: 0 });
    expect(await host([poor]).request('{"id":4,"start":true,"continuous":true}')).toMatchObject({ error: expect.stringContaining('budget.nightUsd') });
    expect(await host([a]).request('{"id":5,"start":true,"continuous":true,"areas":2}')).toMatchObject({ error: expect.stringContaining('takes no areas') });
  });

  it('holds another tenant\'s start only while a round is in its model steps', async () => {
    const [a, b] = [continuous('a'), tenant('b')];
    const h = host([a, b]);
    await h.request('{"id":1,"start":true,"continuous":true,"tenant":"a"}');
    expect(await h.request('{"id":2,"start":true,"tenant":"b"}')).toMatchObject({ started: false, behind: 'a' });
    a.runs[0]!.step = 'fleet';
    h.tick();
    expect(b.starts).toEqual([[]]);
    // b's round is now in its model steps, so a's next continuous round waits for it.
    b.live = [7];
    const busyB = Object.assign(b, { modelBusy: () => b.live.length > 0 });
    h.tick();
    expect(a.starts).toHaveLength(1);
    busyB.live = [];
    h.tick();
    expect(a.starts).toHaveLength(2);
  });
});
