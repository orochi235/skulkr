import { afterEach, describe, expect, it, vi } from 'vitest';
import { jobStateOf, startHeartbeat } from './heartbeat.mjs';

afterEach(() => {
  vi.useRealTimers();
});

const START = Date.parse('2026-11-24T17:00:00Z');
const fix = (progress: object) => ({ task: 'audit82-geom-fix', node: 'local', state: 'running', started: new Date(START).toISOString(), progress });

describe('jobStateOf', () => {
  it("says a fixer's commits, checks, tests and latest note, each in its own words", () => {
    expect(jobStateOf(fix({
      done: 10, total: 10, checks: { done: 6, total: 7, failed: 2 }, tests: { done: 84, total: 84, failed: 3 },
      now: { text: 'running: npx vitest run a.test.ts', at: '' },
    }), 'geom-fix')).toBe('commits 10/10 · checks 6/7, 2 failing · tests 84, 3 failing · now: running: npx vitest run a.test.ts');
    expect(jobStateOf({ progress: { done: 3, total: 27 } }, 'geom-A')).toBe('files 3/27');
    expect(jobStateOf({}, 'geom-match')).toBe('');
  });
});

describe('startHeartbeat', () => {
  it("prints this round's running jobs when they move, and once they have sat unchanged past the quiet time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const said: string[] = [];
    let progress: object = { done: 1, total: 10 };
    const jobs = () => [fix(progress), { ...fix({}), task: 'audit81-geom-fix' }, { ...fix({}), task: 'audit82-x-A', state: 'done' }];
    const stop = startHeartbeat({ jobs, prefix: 'audit82-', say: (l: string) => said.push(l), everyMs: 60_000, quietMs: 180_000 });
    vi.advanceTimersByTime(60_000);
    vi.advanceTimersByTime(60_000);
    progress = { done: 2, total: 10 };
    vi.advanceTimersByTime(60_000);
    vi.advanceTimersByTime(180_000);
    stop();
    vi.advanceTimersByTime(600_000);
    expect(said).toEqual([
      'job geom-fix on local · 1 min · commits 1/10',
      'job geom-fix on local · 3 min · commits 2/10',
      'job geom-fix on local · 6 min · commits 2/10',
    ]);
  });

  it("takes a job's progress from the runner where its record carries none", () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const said: string[] = [];
    const stop = startHeartbeat({
      jobs: () => [{ ...fix({}), progress: undefined }], progress: () => new Map([['audit82-geom-fix', { done: 4, total: 9 }]]),
      prefix: 'audit82-', say: (l: string) => said.push(l), everyMs: 60_000,
    });
    vi.advanceTimersByTime(60_000);
    stop();
    expect(said).toEqual(['job geom-fix on local · 1 min · commits 4/9']);
  });
});
