import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fixBatchLines, fixBatchRowsIn, fixBatchSizesOf } from './fixBatchStats.mjs';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const stateWith = (records: Record<string, unknown>[]) => {
  const dir = mkdtempSync(join(tmpdir(), 'fix-batches-'));
  dirs.push(dir);
  records.forEach((r) => {
    mkdirSync(join(dir, `fix-${r.run}`));
    writeFileSync(join(dir, `fix-${r.run}`, 'record.json'), JSON.stringify(r));
  });
  mkdirSync(join(dir, 'fix-9'));
  return dir;
};

const batch = (n: number, ids: string[], fixed: number, usd: number | undefined, minutes: number, repairs: unknown = 0) => ({
  n, defects: ids.map((id) => ({ id, files: [`${id}.ts`] })),
  verdicts: ids.map((id, i) => ({ id, verdict: i < fixed ? 'fixed' : 'not fixed' })), costUsd: usd, minutes, repairs,
});

describe('scour batches', () => {
  it('reads every run\'s batches in order, its cap the record\'s size or eight, skipping a run with no record', () => {
    const dir = stateWith([
      { run: 2, area: 'b', size: 1, batches: [batch(1, ['D1'], 1, 0.5, 6)] },
      { run: 1, area: 'a', batches: [batch(2, ['D3', 'D4'], 1, 1.0, 8, 1), batch(1, ['D1', 'D2'], 2, 0.8, 6)] },
    ]);
    const rows = fixBatchRowsIn(dir);
    expect(rows.map((r) => [r.run, r.batch, r.cap, r.defects, r.fixed, r.repairs])).toEqual([[1, 1, 8, 2, 2, 0], [1, 2, 8, 2, 1, 1], [2, 1, 1, 1, 1, 0]]);
    expect(fixBatchRowsIn(join(dir, 'none'))).toEqual([]);
  });

  it('prices a defect per batch size over the batches with a cost, and right-aligns the table', () => {
    const dir = stateWith([{ run: 1, area: 'a', batches: [batch(1, ['D1', 'D2'], 2, 0.8, 6), batch(2, ['D3', 'D4'], 1, 1.2, 10), batch(3, ['D5'], 0, undefined, 4)] }]);
    const sizes = fixBatchSizesOf(fixBatchRowsIn(dir));
    expect(sizes).toHaveLength(1);
    expect(sizes[0]).toMatchObject({ size: 2, batches: 2, usdPerDefect: 0.5, minutesPerDefect: 4, fixedShare: 0.75 });
    const lines = fixBatchLines(fixBatchRowsIn(dir), sizes);
    expect(lines.find((l) => l.startsWith('  1 a        3'))).toContain('     –');
    expect(lines.at(-1)).toBe('   2       2      0.50         4.0    75%');
  });
});
