import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JOBS_TTL_MS, fileStore, keptJobs, launchOf } from './onto.mjs';

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

describe('launchOf', () => {
  const at = (stderr: string, status = 1) => launchOf({ status, stderr, tail: stderr });
  it('reads a refusal or a busy tree from onto\'s own error line only', () => {
    expect(at('onto do: studio refuses kind:fix; `onto set studio --allow kind:fix` takes it back\n')).toMatchObject({ refused: true, busy: false });
    expect(at('onto do: working tree "w-r1" is busy: a job runs in it; wait for it to finish and retry\n')).toMatchObject({ busy: true, refused: false });
  });

  it('never reads the job\'s own output as onto refusing it', () => {
    const job = 'the API is unavailable; working tree "x" is busy\n';
    expect(at(`${job}onto do: job exited 1 on studio after 5000ms\n`)).toMatchObject({ refused: false, busy: false });
    expect(at(job, 0)).toMatchObject({ refused: false, busy: false });
    expect(at(`${job}fake onto do: x refuses y\n`)).toMatchObject({ refused: false });
  });
});
