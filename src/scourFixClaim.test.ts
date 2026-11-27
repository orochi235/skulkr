import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { claimFixRunIn } from './scourFix.mjs';

describe('claimFixRunIn', () => {
  const dirs: string[] = [];
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
  const cfgIn = () => {
    const state = mkdtempSync(join(tmpdir(), 'skulkr-claim-'));
    dirs.push(state);
    return { state };
  };

  it('takes one past the highest run and makes its directory', () => {
    const cfg = cfgIn();
    mkdirSync(join(cfg.state, 'scour', 'fix-7'), { recursive: true });
    const { n, runDir } = claimFixRunIn(cfg);
    expect(n).toBe(8);
    expect(existsSync(runDir)).toBe(true);
  });

  it('gives two claims made back to back their own runs', () => {
    const cfg = cfgIn();
    expect([claimFixRunIn(cfg).n, claimFixRunIn(cfg).n]).toEqual([1, 2]);
  });
});
