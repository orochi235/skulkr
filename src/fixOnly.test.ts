import { describe, expect, it } from 'vitest';
import { fixOnlyArg, planFixOnly } from './fixOnly.mjs';
import { parseArgs } from './night.mjs';
import { startArgs } from './serviceCore.mjs';
import { weaselConfig } from '../test/weaselConfig';

const areas = ['a', 'b', 'c', 'd'].map((id) => ({ id, files: [`${id}.ts`] }));
const open = new Map([['b', [{ id: 'r1-1' }]], ['c', [{ id: 'r1-2' }]], ['d', [{ id: 'r2-1' }]]]);

describe('planFixOnly', () => {
  it('takes every area with open findings, in partition order, less those a run holds or a branch has', () => {
    expect(planFixOnly({ areas, open, held: new Set(['c']), inFlight: new Set() })).toEqual({
      picked: ['b', 'd'], skipped: [{ id: 'c', why: 'held by a live run' }],
    });
    expect(planFixOnly({ areas, open, inFlight: new Set(['d']) }).picked).toEqual(['b', 'c']);
  });

  it('limits itself to the areas named, saying why each other one named is not taken', () => {
    expect(planFixOnly({ areas, open, want: ['d', 'a', 'zz'] })).toEqual({
      picked: ['d'], skipped: [{ id: 'zz', why: 'no such area' }, { id: 'a', why: 'no open findings' }],
    });
  });
});

describe('asking for a fix-only round', () => {
  it('reads --fix-only alone or before another flag as every area, and with a list as those', () => {
    const cfg = weaselConfig('/tmp/skulkr-fixonly-test');
    expect(parseArgs(cfg, []).fixOnly).toBeUndefined();
    expect(parseArgs(cfg, ['--fix-only']).fixOnly).toBe(true);
    expect(parseArgs(cfg, ['--fix-only', '--no-merge']).fixOnly).toBe(true);
    expect(parseArgs(cfg, ['--fix-only', 'b,c']).fixOnly).toEqual(['b', 'c']);
    expect(fixOnlyArg('all')).toBe(true);
  });

  it('takes fixOnly on a service start request', () => {
    expect(startArgs({ start: true, fixOnly: true })).toEqual(['--fix-only', 'all']);
    expect(startArgs({ start: true, fixOnly: ['b', 'c'] })).toEqual(['--fix-only', 'b,c']);
    expect(startArgs({ start: true, fixOnly: false })).toEqual([]);
  });
});
