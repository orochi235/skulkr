import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JOBS_TTL_MS, fileStore, keptJobs } from './onto.mjs';

describe('keptJobs', () => {
  it('answers from its last call within the TTL, and from its last good answer when a call throws', () => {
    let t = 0;
    let calls = 0;
    let fail = false;
    const list = keptJobs((hours: number) => {
      calls++;
      if (fail) throw new Error('timed out');
      return [{ task: `t${hours}-${calls}` }];
    }, { now: () => t });
    expect(list(8)).toEqual([{ task: 't8-1' }]);
    t += JOBS_TTL_MS - 1;
    expect(list(8)).toEqual([{ task: 't8-1' }]);
    expect(calls).toBe(1);
    t += 1;
    fail = true;
    expect(list(8)).toEqual([{ task: 't8-1' }]);
    expect(calls).toBe(2);
  });

  it('asks again for a wider window than it last listed, and answers empty when it has never listed', () => {
    let calls = 0;
    const list = keptJobs((hours: number) => {
      calls++;
      return [{ task: String(hours) }];
    }, { now: () => 0 });
    list(2);
    expect(list(8)).toEqual([{ task: '8' }]);
    expect(calls).toBe(2);
    expect(keptJobs(() => { throw new Error('x'); })(1)).toEqual([]);
  });

  it('keeps its last listing in a file, so the next process answers from it when its own call fails', () => {
    const dir = mkdtempSync(join(tmpdir(), 'skulkr-jobs-'));
    try {
      const store = fileStore(join(dir, 'jobs.json'));
      keptJobs(() => [{ task: 'kept' }], { store, now: () => 0 })(8);
      expect(keptJobs(() => { throw new Error('timed out'); }, { store, now: () => JOBS_TTL_MS })(8)).toEqual([{ task: 'kept' }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
