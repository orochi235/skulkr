import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveConfig } from './config.mjs';
import { deadlineOf, pruneNights } from './night.mjs';

describe('deadlineOf', () => {
  const cfg = resolveConfig({ schedule: { stopAt: '07:00' } });

  it('stops a scheduled run at the first stopAt after it started', () => {
    const started = new Date(2026, 10, 20, 22, 0).toISOString();
    expect(deadlineOf(cfg, { started }, { scheduled: true })).toEqual(new Date(2026, 10, 21, 7, 0));
  });

  it('gives a run started by hand no deadline', () => {
    expect(deadlineOf(cfg, { started: new Date(2026, 10, 20, 22, 0).toISOString() }, {})).toBeNull();
  });

  it("counts a resumed run's stopAt from the resume, not from the original start", () => {
    const started = new Date(2026, 10, 20, 22, 0).toISOString();
    const resumed = new Date(2026, 10, 21, 9, 0).toISOString();
    expect(deadlineOf(cfg, { started, resumed }, { scheduled: true })).toEqual(new Date(2026, 10, 22, 7, 0));
  });
});

describe('pruneNights', () => {
  it("keeps the newest nights, and an older one a run's status or summary still names", () => {
    const state = mkdtempSync(join(tmpdir(), 'skulkr-nights-'));
    try {
      const cfg = resolveConfig({ state, keepNights: 1 });
      const night = (name: string) => {
        mkdirSync(join(state, 'nights', name), { recursive: true });
        return join(state, 'nights', name);
      };
      const run = (round: number, file: string, nightDir: string) => {
        mkdirSync(join(state, 'runs', String(round)), { recursive: true });
        writeFileSync(join(state, 'runs', String(round), file), JSON.stringify({ round, nightDir }));
      };
      run(1, 'status.json', night('2026-11-01-round1'));
      run(2, 'summary.json', night('2026-11-02-round2'));
      night('2026-11-03-round3');
      night('2026-11-04-round4');
      pruneNights(cfg);
      expect(['1', '2', '3', '4'].map((n) => existsSync(join(state, 'nights', `2026-11-0${n}-round${n}`)))).toEqual([true, true, false, true]);
    } finally {
      rmSync(state, { recursive: true, force: true });
    }
  });
});
