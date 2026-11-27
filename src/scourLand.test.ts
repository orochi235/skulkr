import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeLedger } from './ledger.mjs';
import { scourFix } from './scourFix.mjs';
import { scourCfgOf } from './scourLand.mjs';
import { fixingRunner, project, scratch } from './scourTestKit.ts';

let fleetWas: string | undefined;
beforeEach(() => {
  fleetWas = process.env.SKULKR_FLEET;
  process.env.SKULKR_FLEET = scratch();
});
afterEach(() => {
  if (fleetWas === undefined) delete process.env.SKULKR_FLEET;
  else process.env.SKULKR_FLEET = fleetWas;
});

/** A project whose `src` ledger holds nine defects on one file, so triage makes two batches, and a gate of `gate`. */
const fixable = (gate: string[]) => {
  const p = project();
  Object.assign(p.cfg.gate, { command: gate, cwd: 'root' });
  p.cfg.git.push = false;
  const defect = (k: number) => ({ id: `D${k}`, claim: `claim ${k}`, where: `src/f.ts:${k}`, sightings: [1] });
  writeLedger(p.cfg, { area: 'src', commit: p.git('rev-parse', 'main'), files: ['src/f.ts'], occasions: Array.from({ length: 10 }, () => ({})), defects: Array.from({ length: 9 }, (_, k) => defect(k + 1)) });
  return p;
};

describe('landing a scour fix run', () => {
  it('names its branches and batches for scour, leaving the rounds\' names as they were', () => {
    const { cfg } = project();
    const scour = scourCfgOf(cfg);
    expect(scour.names.batch('2026-11-27', 12)).toBe('batch/2026-11-27-scour12');
    expect(scour.names.idOf('scour12-src-b2')).toBe('src-b2');
    expect(scour.names.area(12, 'src-b2')).toBe('scour12-src-b2');
    expect(cfg.names.area(12, 'src')).toBe('audit12-src');
  });

  it('lands the area\'s newest branch on main with its record, and deletes the branches main now holds', async () => {
    const { root, cfg, git } = fixable(['true']);
    const said: string[] = [];
    const record = await scourFix(cfg, fixingRunner().runner, root, 'src', {}, (l: string) => said.push(l));
    expect(record.landing).toMatch(/^main fast-forwarded/);
    expect(git('show', 'main:src/b1.ts')).toContain('b1');
    expect(git('show', 'main:src/b2.ts')).toContain('b2');
    expect(git('show', 'main:.skulkr/scour/fix-1/record.json')).toContain('"area": "src"');
    expect(git('branch', '--list', 'scour1-*')).toBe('');
    expect(said.some((l) => l.startsWith('land: scour1-src-b2, 2 commits from fix runs 1'))).toBe(true);
    expect(existsSync(join(cfg.state, 'left-out.json'))).toBe(false);
  });

  it('leaves main and the branch alone when the gate is red, and with --ready', async () => {
    const red = fixable(['false']);
    const before = red.git('rev-parse', 'main');
    const record = await scourFix(red.cfg, fixingRunner().runner, red.root, 'src', {}, () => {});
    expect(record.landing).not.toMatch(/fast-forwarded/);
    expect(red.git('rev-parse', 'main')).toBe(before);
    expect(red.git('branch', '--list', 'scour1-src-b2')).toContain('scour1-src-b2');

    const ready = fixable(['true']);
    const was = ready.git('rev-parse', 'main');
    const kept = await scourFix(ready.cfg, fixingRunner().runner, ready.root, 'src', { ready: true }, () => {});
    expect(kept.ready).toBe('scour1-src-b2');
    expect(ready.git('rev-parse', 'main')).toBe(was);
  });
});
