import { describe, expect, it } from 'vitest';
import { armFigures, trialLines } from './trial.mjs';

const side = (findings: number, costUsd: number, cacheRead: number) => ({ findings, read: 10, usage: { costUsd, turns: 40, tokens: { cacheWrite5m: 100_000, cacheWrite1h: 0, cacheRead, output: 20_000 } } });

describe('trial digest', () => {
  it("sums a pair's sides and reads its overlap as shared over distinct", () => {
    const f = armFigures({ A: side(5, 1.5, 1e6), B: side(3, 1.25, 2e6), m: 2 });
    expect(f).toMatchObject({ usd: 2.75, turns: 80, write: 200_000, read: 3e6, a: 5, b: 3, m: 2, distinct: 6 });
  });

  it('lists each area under each arm, then each arm over every area', () => {
    const arm = { A: side(4, 1, 1e6), B: side(4, 1, 1e6), m: 2 };
    const lines = trialLines([{ round: 72, area: 'geom', base: arm, preload: arm }]);
    expect(lines.filter((l) => l.startsWith('r72 geom'))).toHaveLength(2);
    expect(lines.at(-1)).toMatch(/^1 areas · preload +2\.00/);
  });
});
