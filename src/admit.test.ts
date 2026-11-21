import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { areasAtOnce, startAreas } from './admit.mjs';
import { resolveConfig } from './config.mjs';
import { fixOnlyAreas } from './fixOnly.mjs';

const later = new Date(Date.now() + 3_600_000);
const harness = ({ stopAfter = Infinity, costUsd = 0 } = {}) => {
  const said: string[] = [];
  let started = 0;
  const ctx = { cfg: resolveConfig({ budget: { areaGuessUsd: 10 } }), stopped: () => started >= stopAfter, say: (l: string) => said.push(l) };
  const start = async (area: { id: string }) => {
    started += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { id: area.id, jobs: { costUsd: 10 } };
  };
  return { ctx, said, start, status: { costUsd }, args: { capUsd: 100 } };
};
const picked = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

describe('startAreas', () => {
  it('checks for a stop request before each area, not only before the first', async () => {
    const h = harness({ stopAfter: 1 });
    const results: { id: string }[] = [];
    await startAreas({ ...h, picked, deadline: later, results, maxAreas: () => 1 });
    expect(results.map((r) => r.id)).toEqual(['a']);
    expect(h.said).toEqual(['not starting b: stop requested', 'not starting c: stop requested']);
  });

  it('starts no area past the deadline or the dollar cap', async () => {
    const past = harness();
    await startAreas({ ...past, picked, deadline: new Date(0), results: [], maxAreas: () => 3 });
    expect(past.said[0]).toMatch(/^not starting a: past /);
    const broke = harness({ costUsd: 95 });
    await startAreas({ ...broke, picked, deadline: later, results: [], maxAreas: () => 3 });
    expect(broke.said[0]).toBe('not starting a: the next area would cross the $100.00 cap ($95.00 used)');
  });
});

describe('startAreas, against the cap', () => {
  it("counts a running area's spend so far once, not again in what it is expected to cost", async () => {
    const h = harness({ costUsd: 85 });
    const results: { id: string }[] = [];
    // Each running area has spent its whole expected $10, which the $85 used already holds.
    await startAreas({ ...h, ctx: { ...h.ctx, spentOn: () => 10 }, picked, deadline: later, results, maxAreas: () => 3 });
    expect(h.said).toEqual([]);
    expect(results.map((r) => r.id).sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('startAreas, beside a fixer outside any area', () => {
  it("counts what the sweep's fixer may still spend against the cap", async () => {
    const h = harness({ costUsd: 80 });
    await startAreas({ ...h, ctx: { ...h.ctx, reservedUsd: () => 15 }, picked: [{ id: 'a' }], deadline: later, results: [], maxAreas: () => 1 });
    expect(h.said).toEqual(['not starting a: the next area would cross the $100.00 cap ($80.00 used)']);
  });
});

describe('areas at once', () => {
  it('follow limits.json, read again on every ask, pinned or placed', () => {
    const state = mkdtempSync(join(tmpdir(), 'skulkr-admit-'));
    try {
      const cfg = resolveConfig({ state, nodes: { reviewSlots: 4, fixSlots: 2 }, concurrency: { review: 12, fix: 6 } });
      const pinned = { nodes: ['a', 'b'] };
      const placed = { places: true };
      expect(areasAtOnce(cfg, pinned, 'review', 2)).toBe(4);
      expect(areasAtOnce(cfg, placed, 'review', 2)).toBe(6);
      writeFileSync(join(state, 'limits.json'), JSON.stringify({ review: 1, fix: 3 }));
      expect(areasAtOnce(cfg, pinned, 'review', 2)).toBe(1);
      expect(areasAtOnce(cfg, pinned, 'fix', 1)).toBe(6);
      expect(areasAtOnce(cfg, placed, 'fix', 1)).toBe(3);
    } finally {
      rmSync(state, { recursive: true, force: true });
    }
  });

  it('are asked again before each area, so a raised limit lets more start at once', async () => {
    const h = harness();
    let limit = 1;
    let running = 0;
    let most = 0;
    const start = async (area: { id: string }) => {
      running += 1;
      most = Math.max(most, running);
      limit = 3;
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return { id: area.id, jobs: { costUsd: 0 } };
    };
    await startAreas({ ...h, start, picked, deadline: later, results: [], maxAreas: () => limit });
    expect(most).toBe(3);
  });
});

describe('fixOnlyAreas', () => {
  it('holds a fix-only round to the dollar cap', async () => {
    const h = harness({ costUsd: 95 });
    const results: unknown[] = [];
    await fixOnlyAreas({ ctx: h.ctx, picked, open: new Map(), args: { ...h.args, nodes: ['studio'] }, status: h.status, deadline: later, results });
    expect(results).toEqual([]);
    expect(h.said).toHaveLength(3);
    expect(h.said.every((l) => l.includes('would cross the $100.00 cap'))).toBe(true);
  });
});
