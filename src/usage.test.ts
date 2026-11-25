import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mayStartArea, spendIn } from './usage.mjs';

describe('spendIn', () => {
  it("sums each area's records, counting a reused job's record once, as the run that ran it did", () => {
    const night = mkdtempSync(join(tmpdir(), 'skulkr-usage-'));
    try {
      const lines = [
        { area: 'a', role: 'review-A', costUsd: 1.5 },
        { area: 'a', role: 'fix', costUsd: 2 },
        { area: 'b', role: 'review-A', costUsd: 1 },
        { area: 'a', role: 'review-A', costUsd: 1.5, reused: true },
      ];
      writeFileSync(join(night, 'usage.jsonl'), `${lines.map((l) => JSON.stringify(l)).join('\n')}\nnot json\n`);
      expect(spendIn(night)).toEqual(new Map([['a', 3.5], ['b', 1]]));
      expect(spendIn(join(night, 'none'))).toEqual(new Map());
    } finally {
      rmSync(night, { recursive: true, force: true });
    }
  });
});

describe('mayStartArea', () => {
  it('expects an area to cost only what it had not spent before a resume', () => {
    expect(mayStartArea({ used: 75, finished: [], running: [], cap: 80, guess: 10 })).toBe(false);
    expect(mayStartArea({ used: 75, finished: [], running: [], cap: 80, guess: 10, before: 6 })).toBe(true);
    expect(mayStartArea({ used: 75, finished: [], running: [], cap: 80, guess: 10, before: 20 })).toBe(true);
  });
});
