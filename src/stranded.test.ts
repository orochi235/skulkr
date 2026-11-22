import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { gitIn } from './batch.mjs';
import { resolveConfig } from './config.mjs';
import { strandedHoldFor, strandedRoundsFor } from './stranded.mjs';

const dirs: string[] = [];
const temp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('strandedRoundsFor', () => {
  it('lists unmerged batches, less a live run\'s and an abandoned round\'s', () => {
    const root = temp('skulkr-stranded-');
    const git = gitIn(root);
    git('init', '-q', '-b', 'main');
    git('-c', 'user.email=s@example.invalid', '-c', 'user.name=s', 'commit', '-q', '--allow-empty', '-m', 'base');
    for (const round of [5, 6, 7, 8]) {
      git('checkout', '-q', '-b', `batch/2026-11-2${round - 4}-audit${round}`, 'main');
      git('-c', 'user.email=s@example.invalid', '-c', 'user.name=s', 'commit', '-q', '--allow-empty', '-m', `round ${round}`);
    }
    git('branch', 'batch/2026-11-20-audit4', 'main'); // merged: main holds it
    git('checkout', '-q', 'main');
    const state = temp('skulkr-state-');
    // Round 7 is live (this process holds it), round 8 was abandoned.
    mkdirSync(join(state, 'runs', '7'), { recursive: true });
    writeFileSync(join(state, 'runs', '7', 'status.json'), JSON.stringify({ pid: process.pid, step: 'review', started: new Date().toISOString() }));
    const night = join(state, 'nights', '2026-11-24T00-00-00-000Z-round8');
    mkdirSync(night, { recursive: true });
    writeFileSync(join(night, 'abandoned'), 'given up');
    const cfg = resolveConfig({ state, root });
    expect(strandedRoundsFor(cfg, git)).toEqual([
      { round: 5, branch: 'batch/2026-11-21-audit5' },
      { round: 6, branch: 'batch/2026-11-22-audit6' },
    ]);
  });
});

describe('strandedHoldFor', () => {
  const one = [{ round: 67, branch: 'batch/2026-11-22-audit67' }];
  it('holds once more rounds are stranded than allowed', () => {
    expect(strandedHoldFor([], 0)).toBeNull();
    expect(strandedHoldFor(one, 1)).toBeNull();
    expect(strandedHoldFor(one, 0)).toBe("round 67's batch is unmerged (batch/2026-11-22-audit67); land, delete, or abandon it first");
    expect(strandedHoldFor([{ round: 66, branch: 'b66' }, ...one], 0)).toMatch(/^rounds 66 and 67's batches are unmerged/);
  });
});

describe('naming.batch', () => {
  it('names, reads back, and finds the gate jobs of a batch by its pattern', () => {
    const { names } = resolveConfig({ naming: { batch: 'rounds/r{round}-{date}' } });
    expect(names.batch('2026-11-22', 9)).toBe('rounds/r9-2026-11-22');
    expect(names.batchTree('2026-11-22', 9)).toBe('rounds-r9-2026-11-22');
    expect(names.batchRoundOf('rounds/r9-2026-11-22')).toBe(9);
    expect(names.batchRoundOf('batch/2026-11-22-audit9')).toBeUndefined();
    expect(names.batchJobOf(9).test('rounds-r9-2026-11-22-gate')).toBe(true);
    expect(() => resolveConfig({ naming: { batch: 'rounds/{date}' } })).toThrow('must hold {round}');
  });

  it('keeps the default names', () => {
    const { names } = resolveConfig({});
    expect(names.batch('2026-11-22', 67)).toBe('batch/2026-11-22-audit67');
    expect(names.batchRoundOf('batch/2026-11-22')).toBeUndefined();
    expect(names.batchJobOf(67).test('batch-2026-11-22-skulkr67-gate')).toBe(true);
  });
});
