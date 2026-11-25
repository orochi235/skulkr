import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { weaselConfig } from '../test/weaselConfig.ts';
import { pin, pinsOf } from './pins.mjs';
import { printPlan, unpinSettled } from './plan.mjs';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const args = { nodes: ['studio'], capUsd: 10, budget: { review: 1, match: 1, fix: 1 } };
const planOf = (extra = {}) => ({
  round: 7, commit: 'abcdef1234567', running: [], passes: new Map(), staleLines: new Map(), open: new Map(),
  picked: [{ id: 'core.a', files: ['a.ts'] }, { id: 'core.b', files: ['b.ts', 'c.ts'] }], ...extra,
});

describe('printPlan', () => {
  it('marks pinned picks and lists the pins a real round took off as settled', () => {
    const lines: string[] = [];
    printPlan(weaselConfig(), planOf({ pins: new Set(['core.b']), unpinned: ['core.z'] }), args, (l: string) => lines.push(l));
    expect(lines).toContain('unpinned core.z: settled');
    expect(lines).toContain('  core.a: 1 files, never audited');
    expect(lines).toContain('  core.b (pinned): 2 files, never audited');
  });
});

describe('unpinSettled', () => {
  it('unpins the settled pins and lists those it took off', () => {
    const state = mkdtempSync(join(tmpdir(), 'skulkr-plan-'));
    dirs.push(state);
    const cfg = weaselConfig(state);
    pin(cfg, 'core.z');
    pin(cfg, 'core.b');
    const p = unpinSettled(cfg, planOf({ settledPins: ['core.z', 'core.y'] }));
    expect(p.unpinned).toEqual(['core.z']);
    expect([...pinsOf(cfg)]).toEqual(['core.b']);
  });
});
