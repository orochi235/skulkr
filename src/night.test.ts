import { describe, expect, it } from 'vitest';
import { resolveConfig } from './config.mjs';
import { deadlineOf } from './night.mjs';

describe('deadlineOf', () => {
  const cfg = resolveConfig({ schedule: { stopAt: '07:00' } });

  it('stops a run at the first stopAt after it started', () => {
    const started = new Date(2026, 10, 20, 22, 0).toISOString();
    expect(deadlineOf(cfg, { started })).toEqual(new Date(2026, 10, 21, 7, 0));
  });

  it("counts a resumed run's stopAt from the resume, not from the original start", () => {
    const started = new Date(2026, 10, 20, 22, 0).toISOString();
    const resumed = new Date(2026, 10, 21, 9, 0).toISOString();
    expect(deadlineOf(cfg, { started, resumed })).toEqual(new Date(2026, 10, 22, 7, 0));
  });
});
