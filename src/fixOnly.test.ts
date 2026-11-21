import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveConfig } from './config.mjs';
import { fixCarried, fixOnlyArg, planFixOnly } from './fixOnly.mjs';
import { parseArgs } from './args.mjs';
import { startArgs } from './serviceCore.mjs';
import { weaselConfig } from '../test/weaselConfig.ts';

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

describe('fixCarried', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const scratch = () => {
    const d = mkdtempSync(join(tmpdir(), 'skulkr-fixonly-'));
    dirs.push(d);
    return d;
  };

  it("readies the frozen tree as a reviewed area's fixer does, and records the summary a fix-only area has always had", async () => {
    const reply = JSON.stringify({ type: 'result', is_error: false, result: 'fixed [r1-1]; one question', total_cost_usd: 2 });
    const ctx = {
      cfg: resolveConfig({}), round: 7, commit: 'c0ffee', date: '2026-11-21', frozen: scratch(), nightDir: scratch(),
      frozenTree: 't', identity: {}, budget: { fix: 15 }, total: { fix: 1 }, say: () => {}, progress: () => {}, usage: () => {}, refuse: () => {},
      acquire: async () => ({ node: 'studio', release: () => {} }),
      runner: { run: async (job: { to: string }) => {
        mkdirSync(job.to, { recursive: true });
        writeFileSync(join(job.to, 'exit'), '0');
        writeFileSync(join(job.to, 'claude.json'), reply);
        return { status: 0 };
      } },
    };
    const carried = [{ id: 'r1-1', claim: 'drops the last row', where: 'a/x.ts', from: 'A', round: 1 }];
    const got = await fixCarried(ctx, { id: 'a', files: ['a/x.ts'] }, carried);
    expect(Object.keys(got)).toEqual(['id', 'commit', 'date', 'files', 'fixOnly', 'carried', 'a', 'b', 'm', 'distinct', 'read', 'patches', 'questions', 'budgetHit', 'jobs', 'fixCommits']);
    expect(got).toMatchObject({ fixOnly: true, carried: 1, patches: 0, questions: 1, budgetHit: [], jobs: { nodes: { fix: 'studio' }, costUsd: 2 } });
    expect(Object.keys(got.jobs.minutes)).toEqual(['fix']);
    expect(JSON.parse(readFileSync(join(ctx.frozen, '.skulkr/in/checks.json'), 'utf8'))).toEqual(ctx.cfg.checks.tally);
    expect(existsSync(join(ctx.frozen, '.skulkr/in/progress.mjs'))).toBe(true);
    expect(readFileSync(join(ctx.nightDir, 'areas/a/files.txt'), 'utf8')).toBe('a/x.ts\n');
    expect(readFileSync(join(ctx.nightDir, 'areas/a/fix.md'), 'utf8')).toBe('fixed [r1-1]; one question');
  });
});
