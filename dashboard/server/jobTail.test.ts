import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { jobTailOf } from './jobTail.ts';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

/** A round's directory with area `core`'s job logs, each written at its own second. */
function night(logs: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'skulkr-tail-'));
  dirs.push(dir);
  Object.entries(logs).forEach(([path, text], i) => {
    const file = join(dir, 'jobs', 'core', path);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, text);
    utimesSync(file, 1_000 + i, 1_000 + i);
  });
  return dir;
}

const noFleet = async () => { throw new Error('asked the fleet'); };

describe('jobTailOf', () => {
  it('reads the newest written log, counters and colors left out', async () => {
    const dir = night({ 'A.log': 'old\n', 'fix.log': 'onto: progress 1/3\nskulkr: running: npm test\n\x1b[31mred\x1b[0m\n', 'match.log': '' });
    expect(await jobTailOf(dir, 'core', 40, noFleet)).toMatchObject({ file: 'fix.log', lines: ['skulkr: running: npm test', 'red'] });
  });

  it('follows a log that hands its job to the fleet with that task\'s own lines', async () => {
    const dir = night({ 'fix.log': 'skulkr: verifying the fixer\'s commits\nskulkr: on the fleet as proj-verify-1a2b\n' });
    const tail = await jobTailOf(dir, 'core', 40, async (task, n) => [`${task} ${n}`, 'PASS a.test.ts']);
    expect(tail).toMatchObject({ fleet: 'proj-verify-1a2b', lines: ["skulkr: verifying the fixer's commits", 'skulkr: on the fleet as proj-verify-1a2b', 'proj-verify-1a2b 40', 'PASS a.test.ts'] });
  });

  it('answers null for an area with nothing written', async () => {
    expect(await jobTailOf(night({ 'A.log': '' }), 'core', 40, noFleet)).toBeNull();
    expect(await jobTailOf(night({}), 'missing', 40, noFleet)).toBeNull();
  });
});
