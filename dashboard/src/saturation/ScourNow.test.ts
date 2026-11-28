import { describe, expect, it } from 'vitest';
import { clockWordsOf, fixStatsOf, jobLinesOf, stepSinceOf, stepWordsOf, tallyText, timedLines } from './ScourNow';
import type { SaturationLedger, ScourJob, ScourLive } from './saturation.types';
import { passKeyParts } from './PassPill';

describe('jobLinesOf', () => {
  it("lists each job's recent lines newest first, led by its key", () => {
    const job = (key: string, recent?: string[]) => ({ key, step: 'fix', at: null, line: null, progress: null, recent }) as ScourJob;
    expect(jobLinesOf([job('b1', ['says: one', 'commit 1/8 for D4: two']), job('b2')])).toEqual([
      'b1        commit 1/8 for D4: two',
      'b1        says: one',
    ]);
  });
});

describe('the clock span', () => {
  const live = (jobs: Partial<ScourJob>[], log: string[] = []) => ({ since: '2026-11-26T09:00:00.000Z', jobs, log }) as unknown as ScourLive;

  it("counts a step from its newest job's start, else the last pass's log line, else the run's", () => {
    expect(stepSinceOf(live([{ started: '2026-11-26T10:00:00.000Z' }, { started: '2026-11-26T10:05:00.000Z' }, {}]))).toBe('2026-11-26T10:05:00.000Z');
    expect(stepSinceOf(live([], ['2026-11-26T09:30:00.000Z 1/40 claude: 2 findings']))).toBe('2026-11-26T09:30:00.000Z');
    expect(stepSinceOf(live([]))).toBe('2026-11-26T09:00:00.000Z');
  });

  it('names a fix run\'s step a batch and a delve\'s a pass', () => {
    expect(clockWordsOf('run', 'fix')[0]).toBe('elapsed');
    expect(clockWordsOf('step', 'fix')[0]).toBe('this batch');
    expect(clockWordsOf('step', 'delve')[0]).toBe('this pass');
  });
});

describe('timedLines', () => {
  it('leads each of the last lines, newest first, with the time since the line before, right-aligned', () => {
    const log = [
      '2026-11-26T10:00:00.000Z saturate a at c: 3 files',
      '2026-11-26T10:04:30.000Z 1/40 claude: 2 findings',
      '2026-11-26T10:09:00.000Z 2/40 claude: 3 findings',
      '2026-11-26T11:19:05.000Z 3/40 claude: 1 findings',
    ];
    expect(timedLines(log, '2026-11-26T09:59:00.000Z')).toEqual([
      '1:10:05  3/40 claude: 1 findings',
      '   4:30  2/40 claude: 3 findings',
      '   4:30  1/40 claude: 2 findings',
    ]);
  });

  it('times the first line from when the process took the ledger', () => {
    expect(timedLines(['2026-11-26T10:01:00.000Z started'], '2026-11-26T10:00:00.000Z')).toEqual(['1:00  started']);
  });
});

describe('passKeyParts', () => {
  it("splits a delve job's key into its pass number and source, and keeps any other key whole", () => {
    expect(passKeyParts('07-claude')).toEqual({ index: '07', name: 'claude' });
    expect(passKeyParts('12-codex')).toEqual({ index: '12', name: 'codex' });
    expect(passKeyParts('b3')).toEqual({ index: '3', name: 'batch', nameFirst: true });
    expect(passKeyParts('match')).toEqual({ index: null, name: 'match' });
  });
});

describe('stepWordsOf and tallyText', () => {
  const job = (step: string | null, fleet?: string) => ({ key: 'b1', step, at: null, line: null, progress: null, ...(fleet ? { fleet } : {}) });
  it('names a fix batch step in words, its verify on the fleet where it went there', () => {
    expect([job(null), job('fix'), job('verify'), job('verify-fix-gui', 'weasel-verify-gui-1'), job('repair-2'), job('review')].map(stepWordsOf))
      .toEqual(['starting', 'fixing', 'verifying', 'verifying on fleet', 'repairing 2', 'review']);
  });
  it('writes a tally with its failures, and nothing without one', () => {
    expect(tallyText('tests', { done: 24, total: 1812, failed: 1 })).toBe('tests 24/1,812, 1 failed');
    expect(tallyText('checks', { done: 2, total: 2 })).toBe('checks 2/2');
    expect(tallyText('tests', undefined)).toBe('');
  });
});

describe('fixStatsOf', () => {
  it('counts the defects out in a batch by stage, checking as verifying, leaving out a count at 0', () => {
    const statuses = {
      D1: { status: 'fixing', run: 3, branch: null, stage: 'analyzing' }, D2: { status: 'fixing', run: 3, branch: null, stage: 'writing' },
      D3: { status: 'fixing', run: 3, branch: null, stage: 'checking' }, D4: { status: 'fixing', run: 3, branch: null, stage: 'checking' },
      D5: { status: 'fixed', run: 3, branch: 'b', verified: true },
    };
    const l = { fix: { lastRun: { n: 3, started: null, finished: null }, batches: [], ask: [], statuses } } as unknown as SaturationLedger;
    expect(Object.fromEntries(fixStatsOf(l, 4).map(([word, value]) => [word, value]))).toEqual({
      batch: '1/4', analyzing: '1', writing: '1', verifying: '2', fixed: '1',
    });
  });

  it('numbers the batch under way, and stays on the last once every batch is back', () => {
    const batches = [{ defects: [{ id: 'D1' }] }, { defects: [{ id: 'D2' }] }];
    const ledger = (d2: string) => ({ fix: { lastRun: { n: 3, started: null, finished: null }, batches, ask: [], statuses: {
      D1: { status: 'fixed', run: 3, branch: 'b', verified: true }, D2: { status: d2, run: 3, branch: null, stage: 'writing' },
    } } }) as unknown as SaturationLedger;
    const batch = (l: SaturationLedger) => fixStatsOf(l, 2).find(([word]) => word === 'batch')?.[1];
    expect(batch(ledger('fixing'))).toBe('2/2');
    expect(batch(ledger('fixed'))).toBe('2/2');
  });
});
