import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fleetProgressOf, gateFailuresOf, gateOutcomesOf } from './gate.mjs';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const gate = { name: 'test', logSuffix: '.test.log', progress: { tests: '' }, outcome: { tests: 'batch' }, failPrefix: 'fleet-fail:' };

/** A night whose two gate passes failed and whose capstone pass, written last, is under way and passing so far. */
const night = () => {
  const dir = mkdtempSync(join(tmpdir(), 'skulkr-gate-'));
  dirs.push(dir);
  const put = (name: string, text: string, at: number) => {
    writeFileSync(join(dir, name), text);
    utimesSync(join(dir, name), at, at);
  };
  const red = 'onto: progress 9/9\nfleet-fail: core src/a.test.ts :: a > works\nbatch failed\n';
  put('batch-audit5.test.log', red, 1_000);
  // Second by time but first by name, so a pick by name reads this stale pass.
  put('batch-audit5.2.test.log', red, 2_000);
  put('batch-audit5.capstone.test.log', 'onto: progress 3/9\n', 3_000);
  return dir;
};

describe('the gate log', () => {
  it("is read from the newest pass's log, not the first one listed", () => {
    const dir = night();
    expect(fleetProgressOf(dir, gate)).toEqual({ tests: { done: 3, total: 9 } });
    expect(gateOutcomesOf(dir, gate)).toEqual({ tests: null });
    expect(gateFailuresOf(dir, gate)).toEqual({ tests: null });
  });

  it('is absent before the gate writes one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'skulkr-gate-'));
    dirs.push(dir);
    expect(fleetProgressOf(dir, gate)).toBeNull();
    expect(fleetProgressOf(undefined, gate)).toBeNull();
  });
});
