import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cameHome, dispatch, earlierMinutes, earlierReview, limitResetOf } from './dispatch.mjs';

const dirs: string[] = [];
const job = (files: Record<string, string>) => {
  const to = mkdtempSync(join(tmpdir(), 'skulkr-job-'));
  dirs.push(to);
  mkdirSync(to, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(to, name), text);
  return { to };
};
const ok = JSON.stringify({ type: 'result', is_error: false, result: 'done', total_cost_usd: 1 });
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('cameHome', () => {
  it('reuses a fixer that exited with a reply and an mbox', () => {
    expect(cameHome(job({ exit: '0', 'claude.json': ok, 'fix.mbox': '' }), 'fix')).toBeDefined();
  });
  it('runs again a job with no exit, an error reply, or a fixer with no mbox', () => {
    expect(cameHome(job({ 'claude.json': ok, 'fix.mbox': '' }), 'fix')).toBeUndefined();
    expect(cameHome(job({ exit: '1', 'claude.json': ok.replace('"is_error":false', '"is_error":true') }), 'match')).toBeUndefined();
    expect(cameHome(job({ exit: '0', 'claude.json': ok }), 'fix')).toBeUndefined();
  });
  it('reuses a repair only with its mbox, and a verify job by its verdict alone', () => {
    expect(cameHome(job({ exit: '0', 'claude.json': ok }), 'repair')).toBeUndefined();
    expect(cameHome(job({ exit: '0', 'claude.json': ok, 'fix.mbox': '' }), 'repair')).toBeDefined();
    expect(cameHome(job({ 'verify.exit': '1\n' }), 'verify')).toEqual({ exit: '1', raw: '' });
    expect(cameHome(job({}), 'verify')).toBeUndefined();
  });
  it('runs again a review that never reached its done line', () => {
    expect(cameHome(job({ exit: '0', 'claude.json': ok, 'findings.md': '1. a finding\n' }), 'review-A')).toBeUndefined();
  });
});

describe('dispatch', () => {
  it("stops relaunching a job a placing runner keeps refusing once the run's stop is requested", async () => {
    const said: string[] = [];
    let stopped = false;
    const ctx = {
      cfg: {}, frozen: '/nowhere', base: 'b', say: (l: string) => said.push(l), usage: () => {}, refuse: () => {},
      stopped: () => stopped,
      acquire: async () => ({ node: 'placed', placed: true, release: () => {} }),
      runner: { run: async () => {
        stopped = true;
        return { status: 1, refused: true };
      } },
    };
    const spec = { ...job({}), logPath: join(job({}).to, 'v.log'), kind: 'test', shell: 'true', task: 't', timeoutMin: 5 };
    const got = await dispatch(ctx, { id: 'a' }, 'verify', spec);
    expect(got).toMatchObject({ launched: false });
    expect(said).toEqual(['verify a refused by placed; stop requested, so not launched']);
  });
});

describe('dispatch of a model job cut off mid-run', () => {
  it('counts a job that started and left no exit as run, and never launches it again', async () => {
    const spec = { ...job({}), kind: 'review', shell: 'true', task: 't', timeoutMin: 5 };
    let runs = 0;
    const usages: unknown[] = [];
    const ctx = {
      cfg: {}, frozen: '/nowhere', base: 'b', say: () => {}, usage: (u: unknown) => usages.push(u), refuse: () => {}, budget: { match: 1 },
      acquire: async () => ({ node: 'placed', placed: true, release: () => {} }),
      runner: { run: async () => {
        runs += 1;
        writeFileSync(join(spec.to, 'started'), '2026-11-21T00:00:00Z\n');
        return { status: 124 };
      } },
    };
    const got = await dispatch(ctx, { id: 'a' }, 'match', { ...spec, logPath: join(spec.to, 'j.log') });
    expect(runs).toBe(1);
    expect(got).toMatchObject({ status: 124, launched: true });
    expect(usages).toHaveLength(1);
  }, 10_000);

  it("never reads an earlier launch's exit and reply as the answer of a relaunch that did not run", async () => {
    const refusal = JSON.stringify({ type: 'result', is_error: true, result: 'usage limit', total_cost_usd: 2 });
    const spec = { ...job({ exit: '1', 'claude.json': refusal }), kind: 'review', shell: 'true', task: 't', timeoutMin: 5 };
    let stopped = false;
    const usages: unknown[] = [];
    const ctx = {
      cfg: {}, frozen: '/nowhere', base: 'b', say: () => {}, usage: (u: unknown) => usages.push(u), refuse: () => {}, budget: { match: 1 },
      stopped: () => stopped,
      acquire: async () => ({ node: 'placed', placed: true, release: () => {} }),
      runner: { run: async () => {
        stopped = true;
        return { status: 1, refused: true };
      } },
    };
    const got = await dispatch(ctx, { id: 'a' }, 'match', { ...spec, logPath: join(spec.to, 'j.log') });
    expect(got).toMatchObject({ launched: false, reply: '' });
    expect(usages).toMatchObject([{ costUsd: 0, terminalReason: 'no envelope' }]);
  });
});

describe('dispatch of a model job the usage limit stopped', () => {
  it('waits for the reset and runs it again, whole, taking the second answer as its own', async () => {
    const limited = JSON.stringify({ type: 'result', is_error: true, result: 'You have hit your usage limit', total_cost_usd: 2 });
    const spec = { ...job({}), kind: 'review', shell: 'true', task: 't', timeoutMin: 5 };
    let runs = 0;
    const waits: number[] = [];
    const said: string[] = [];
    const ctx = {
      cfg: {}, frozen: '/nowhere', base: 'b', say: (l: string) => said.push(l), usage: () => {}, refuse: () => {}, budget: { match: 1 },
      sleep: async (ms: number) => { waits.push(ms); },
      acquire: async () => ({ node: 'placed', placed: true, release: () => {} }),
      runner: { run: async () => {
        runs += 1;
        writeFileSync(join(spec.to, 'started'), '2026-11-24T22:00:00Z\n');
        writeFileSync(join(spec.to, 'exit'), '0');
        writeFileSync(join(spec.to, 'claude.json'), runs === 1 ? limited : ok);
        return { status: 0 };
      } },
    };
    const got = await dispatch(ctx, { id: 'a' }, 'match', { ...spec, logPath: join(spec.to, 'j.log') });
    expect(runs).toBe(2);
    expect(got).toMatchObject({ status: 0, reply: 'done' });
    expect(waits).toHaveLength(1);
    expect(said[0]).toMatch(/^match a: stopped by the usage limit; running it again after /);
  });

  it('takes the stopped answer as it is once the run is stopped', async () => {
    const limited = JSON.stringify({ type: 'result', is_error: true, result: 'You have hit your usage limit', total_cost_usd: 2 });
    const spec = { ...job({}), kind: 'review', shell: 'true', task: 't', timeoutMin: 5 };
    let runs = 0;
    const ctx = {
      cfg: {}, frozen: '/nowhere', base: 'b', say: () => {}, usage: () => {}, refuse: () => {}, budget: { match: 1 }, stopped: () => true,
      sleep: async () => {},
      acquire: async () => ({ node: 'placed', placed: true, release: () => {} }),
      runner: { run: async () => { runs += 1; writeFileSync(join(spec.to, 'exit'), '0'); writeFileSync(join(spec.to, 'claude.json'), limited); return { status: 0 }; } },
    };
    await dispatch(ctx, { id: 'a' }, 'match', { ...spec, logPath: join(spec.to, 'j.log') });
    expect(runs).toBe(1);
  });
});

describe('dispatch of a refused job', () => {
  it('spends none of its launch retries on refusals', async () => {
    const spec = { ...job({}), kind: 'review', shell: 'true', task: 't', timeoutMin: 5 };
    const answers = ['refused', 'refused', 'failed', 'ran'];
    let runs = 0;
    const ctx = {
      cfg: {}, frozen: '/nowhere', base: 'b', say: () => {}, usage: () => {}, refuse: () => {}, budget: { match: 1 },
      acquire: async () => ({ node: 'studio', placed: false, release: () => {} }),
      runner: { run: async () => {
        const answer = answers[runs++];
        if (answer === 'refused') return { status: 1, refused: true };
        if (answer === 'failed') return { status: 1 };
        writeFileSync(join(spec.to, 'exit'), '0');
        writeFileSync(join(spec.to, 'claude.json'), ok);
        return { status: 0 };
      } },
    };
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      let settled = false;
      const done = dispatch(ctx, { id: 'a' }, 'match', { ...spec, logPath: join(spec.to, 'j.log') }).finally(() => (settled = true));
      // Each relaunch wait is set after file work the fake clock does not drive, so step it until dispatch answers.
      for (let i = 0; i < 20 && !settled; i++) {
        await new Promise((r) => setImmediate(r));
        await vi.advanceTimersByTimeAsync(60_000);
      }
      expect(await done).toMatchObject({ launched: true, reply: 'done' });
    } finally {
      vi.useRealTimers();
    }
    expect(runs).toBe(4);
  });
});

describe('dispatch on pinned nodes that all refuse', () => {
  it('gives the job up after the two hours a placing runner would retry it', async () => {
    const spec = { ...job({}), kind: 'review', shell: 'true', task: 't', timeoutMin: 5 };
    vi.useFakeTimers({ toFake: ['Date'] });
    let runs = 0;
    const said: string[] = [];
    try {
      const ctx = {
        cfg: {}, frozen: '/nowhere', base: 'b', say: (l: string) => said.push(l), usage: () => {}, refuse: () => {}, budget: { match: 1 },
        acquire: async () => ({ node: 'studio', placed: false, release: () => {} }),
        runner: { run: async () => {
          runs += 1;
          vi.setSystemTime(Date.now() + 30 * 60_000);
          return { status: 1, refused: true };
        } },
      };
      const got = await dispatch(ctx, { id: 'a' }, 'match', { ...spec, logPath: join(spec.to, 'j.log') });
      expect(got).toMatchObject({ launched: false });
    } finally {
      vi.useRealTimers();
    }
    expect(runs).toBe(5);
    expect(said.at(-1)).toBe('match a refused by studio; refused 5 times over 120 min, so not launched');
  });
});

describe('limitResetOf', () => {
  it("reads when a usage limit resets, in its zone, and nothing from another reply", () => {
    const now = new Date('2026-11-24T22:05:30Z');
    expect(limitResetOf("You've hit your 5-hour limit · resets 6:30pm (America/New_York)", now)?.toISOString()).toBe('2026-11-24T23:30:00.000Z');
    // Past that time today, it is tomorrow's.
    expect(limitResetOf("You've hit your 5-hour limit · resets 4pm (America/New_York)", now)?.toISOString()).toBe('2026-11-25T21:00:00.000Z');
    expect(limitResetOf('You have hit your usage limit', now)?.toISOString()).toBe('2026-11-24T22:20:30.000Z');
    expect(limitResetOf('fixed 1a2b3c4d', now)).toBeNull();
  });
});

describe('earlierMinutes', () => {
  it('answers how long a job that came home took, from its started stamp to its exit, or 0 without them', () => {
    const { to } = job({ started: '2026-11-24T18:30:04Z\n', exit: '0' });
    utimesSync(join(to, 'exit'), new Date('2026-11-24T18:32:40Z'), new Date('2026-11-24T18:32:40Z'));
    expect(earlierMinutes(to)).toBeCloseTo(2.6);
    expect(earlierMinutes(job({ exit: '0' }).to)).toBe(0);
  });
});

describe('earlierReview', () => {
  /** A night directory with area `x`'s file list and, when `done`, its finished reviewer A. */
  const night = (files: string, done: boolean) => {
    const dir = mkdtempSync(join(tmpdir(), 'skulkr-night-'));
    dirs.push(dir);
    mkdirSync(join(dir, 'areas', 'x'), { recursive: true });
    writeFileSync(join(dir, 'areas', 'x', 'files.txt'), files);
    mkdirSync(join(dir, 'jobs', 'x', 'A'), { recursive: true });
    if (done) {
      writeFileSync(join(dir, 'jobs', 'x', 'A', 'exit'), '0');
      writeFileSync(join(dir, 'jobs', 'x', 'A', 'claude.json'), ok);
      writeFileSync(join(dir, 'jobs', 'x', 'A', 'findings.md'), '## one\n<!-- done: 1 finding -->\n');
    }
    return dir;
  };
  const area = { id: 'x', files: ['a.ts', 'b.ts'] };

  it("copies in an earlier run's finished review of the same files, and never a fixer's or one over other files", () => {
    const now = night('a.ts\nb.ts\n', false);
    const spec = { to: join(now, 'jobs', 'x', 'A') };
    const ctx = { nightDir: now, earlierNights: [night('a.ts\n', true), night('a.ts\nb.ts\n', false), night('a.ts\nb.ts\n', true)] };
    expect(earlierReview(ctx, area, 'fix', spec)).toBeUndefined();
    expect(earlierReview(ctx, area, 'review-A', spec)).toBeDefined();
    expect(cameHome(spec, 'review-A')).toBeDefined();
    expect(earlierReview({ ...ctx, earlierNights: ctx.earlierNights.slice(0, 2) }, area, 'review-A', { to: join(night('', false), 'jobs', 'x', 'B') })).toBeUndefined();
  });
});
