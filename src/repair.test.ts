import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveConfig } from './config.mjs';
import { baselineKey, verifyAndRepair } from './repair.mjs';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const scratch = () => {
  const d = mkdtempSync(join(tmpdir(), 'skulkr-repair-'));
  dirs.push(d);
  return d;
};
const write = (dir: string, files: Record<string, string>) => {
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
};
const mbox = (n: number) => Array.from({ length: n }, (_, i) => `From ${String(i).repeat(40).slice(0, 40)} Mon Sep 17 00:00:00 2001\n`).join('');
const FAILING = { 'verify.exit': '1', 'verify.log': ' FAIL  a/store.pbt.test.ts > keeps order\n Test Files  1 failed | 2 passed (3)', 'verify.files': 'a/store.ts' };
const PASSING = { 'verify.exit': '0', 'verify.log': ' Test Files  3 passed (3)', 'verify.files': 'a/store.ts' };
/** The frozen tree's answer for a file that passes there, and for one that fails there too. */
const CLEAN = { 'verify.exit': '0', 'verify.log': ' Test Files  1 passed (1)' };
const BROKEN = { 'verify.exit': '1', 'verify.log': ' FAIL  a/store.pbt.test.ts > keeps order\n Test Files  1 failed (1)' };
const reply = JSON.stringify({ type: 'result', is_error: false, result: 'fixed abc (order)', total_cost_usd: 1 });

type Job = { task: string; to: string; gui?: boolean; env?: Record<string, string>; kind: string };
/** A round's context whose runner answers each job with the next files queued for its step (`repair`, `verify`). */
const harness = (verify: object, queued: Record<string, Record<string, string>[]>) => {
  const night = scratch();
  const jobs: Job[] = [];
  const said: string[] = [];
  const ctx = {
    cfg: resolveConfig({ checks: { verify } }), round: 7, frozen: scratch(), nightDir: night, base: 'b', frozenTree: 't', identity: {},
    budget: { fix: 15 }, say: (l: string) => said.push(l), usage: () => {}, refuse: () => {},
    acquire: async () => ({ node: 'studio', release: () => {} }),
    runner: {
      run: async (job: Job) => {
        jobs.push(job);
        const step = job.task.split('-').at(-1)!;
        const files = queued[step]!.shift()!;
        write(job.to, { ...files, ...(step === 'repair' ? { exit: '0', 'claude.json': reply } : {}) });
        return { status: 0 };
      },
    },
  };
  const fixDir = join(night, 'jobs', 'a', 'fix');
  return { ctx, jobs, said, fixDir, area: { id: 'a' } };
};

describe('verifyAndRepair', () => {
  it("repairs a failing fix and keeps the repair's mbox once its own verify passes", async () => {
    const h = harness({ command: 'run {files}' }, { verify: [CLEAN], repair: [{ ...PASSING, 'fix.mbox': mbox(3) }] });
    write(h.fixDir, { ...FAILING, 'fix.mbox': mbox(2) });
    const got = await verifyAndRepair(h.ctx, h.area, { mbox: join(h.fixDir, 'fix.mbox') }, h.fixDir);
    expect(got).toMatchObject({ ok: true, repairs: [{ node: 'studio', added: 1, ok: true }], verify: { ok: true, testFiles: { total: 3 } } });
    expect(got.mbox).toBe(join(h.ctx.nightDir, 'jobs', 'a', 'repair-1', 'fix.mbox'));
    const brief = readFileSync(join(h.ctx.frozen, '.skulkr/in/a/repair.md'), 'utf8');
    expect(brief).toContain('FAIL  a/store.pbt.test.ts > keeps order');
    expect(readFileSync(join(h.ctx.frozen, '.skulkr/in/a/area.mbox'), 'utf8')).toBe(mbox(2));
    expect(h.said).toEqual(['verify a: failed: 1 of 3 test files failed (a/store.pbt.test.ts)', expect.stringMatching(/^repair a 1\/2 on studio: 1 commits, [\d.]+ min; verify passed$/)]);
  });

  it('stops after two repairs and leaves the area out', async () => {
    const h = harness({ command: 'run {files}' }, { verify: [CLEAN], repair: [{ ...FAILING, 'fix.mbox': mbox(2) }, { ...FAILING, 'fix.mbox': mbox(2) }] });
    write(h.fixDir, { ...FAILING, 'fix.mbox': mbox(2) });
    const got = await verifyAndRepair(h.ctx, h.area, { mbox: join(h.fixDir, 'fix.mbox') }, h.fixDir);
    expect(got.ok).toBe(false);
    expect(got.repairs).toHaveLength(2);
    expect(got.verify).toMatchObject({ ok: false, failedFiles: ['a/store.pbt.test.ts'] });
    expect(h.said.at(-1)).toBe('verify a: still failing after 2 repairs; left out of the batch');
    // The file was checked on the frozen tree once, for the fixer's verdict; both repairs' verdicts reuse the answer.
    expect(h.jobs.filter((j) => j.task === 'project-audit7-a-verify')).toHaveLength(1);
  });

  it('pays for no repair when the verify step never ran', async () => {
    const h = harness({ command: 'run {files}' }, { verify: [{}], repair: [] });
    write(h.fixDir, { 'fix.mbox': mbox(2) });
    const got = await verifyAndRepair(h.ctx, h.area, { mbox: join(h.fixDir, 'fix.mbox') }, h.fixDir);
    expect(got).toMatchObject({ ok: false, repairs: [] });
    expect(h.jobs.filter((j) => j.task.endsWith('-repair'))).toHaveLength(0);
    expect(h.said.at(-1)).toBe('verify a: did not run (no verdict came home); left out of the batch, no repair tried');
  });

  it('runs the GUI part on a GUI node where the probe lists a browser test, and repairs what fails there', async () => {
    const verify = { command: 'run {files}', gui: { probe: 'list {related}', command: 'run-gui {files}' } };
    const h = harness(verify, {
      verify: [FAILING, CLEAN, PASSING],
      repair: [{ ...PASSING, 'fix.mbox': mbox(2), 'gui.exit': '0', 'gui.txt': '[browser] a/Bar.browser.test.tsx' }],
    });
    write(h.fixDir, { ...PASSING, 'fix.mbox': mbox(1), 'gui.exit': '0', 'gui.txt': '[browser] a/Bar.browser.test.tsx' });
    const got = await verifyAndRepair(h.ctx, h.area, { mbox: join(h.fixDir, 'fix.mbox') }, h.fixDir);
    expect(h.jobs.map((j) => [j.task, j.kind, Boolean(j.gui)])).toEqual([
      ['project-audit7-a-verify', 'test', true], ['project-audit7-a-verify', 'test', true], ['project-audit7-a-repair', 'fix', false], ['project-audit7-a-verify', 'test', true],
    ]);
    expect(got).toMatchObject({ ok: true, verify: { ok: true, gui: true } });
  });

  it('verifies in a job of its own where the fixer left no verdict, and lets a timed-out run land unrepaired', async () => {
    const h = harness({ command: 'run {files}' }, { verify: [{ 'verify.exit': '142', 'verify.log': '', 'verify.files': 'a/x.ts' }] });
    write(h.fixDir, { 'fix.mbox': mbox(1) });
    const got = await verifyAndRepair(h.ctx, h.area, { mbox: join(h.fixDir, 'fix.mbox') }, h.fixDir);
    expect(h.jobs.map((j) => j.task)).toEqual(['project-audit7-a-verify']);
    expect(got).toMatchObject({ ok: false, repairs: [], verify: { ok: false, timedOut: true } });
  });

  it('passes an area whose only failing file fails on the frozen tree too, and checks that file once a round', async () => {
    const h = harness({ command: 'run {files}' }, { verify: [BROKEN] });
    write(h.fixDir, { ...FAILING, 'fix.mbox': mbox(2) });
    const got = await verifyAndRepair(h.ctx, h.area, { mbox: join(h.fixDir, 'fix.mbox') }, h.fixDir);
    expect(got).toMatchObject({ ok: true, repairs: [], verify: { ok: true, baseline: ['a/store.pbt.test.ts'] } });
    expect(h.jobs.map((j) => [j.task, j.env?.VERIFY_EXTRA])).toEqual([['project-audit7-a-verify', 'a/store.pbt.test.ts']]);
    expect(h.jobs[0]!.to).toBe(join(h.ctx.nightDir, 'jobs', 'a', `verify-baseline-${baselineKey(['a/store.pbt.test.ts'], false)}`));
    expect(h.said).toEqual(['verify a: passed (3 test files); 1 failing on the frozen tree too, set aside (a/store.pbt.test.ts)']);
    const other = join(h.ctx.nightDir, 'jobs', 'b', 'fix');
    write(other, { ...FAILING, 'fix.mbox': mbox(1) });
    const again = await verifyAndRepair(h.ctx, { id: 'b' }, { mbox: join(other, 'fix.mbox') }, other);
    expect(again.ok).toBe(true);
    expect(h.jobs).toHaveLength(1);
  });

  it('sets a file of checks aside only for the checks the frozen tree fails too', async () => {
    const check = (name: string) => ` FAIL  gate  scripts/ci-checks.gate.ts > the checks > npm run ${name}`;
    const branch = (names: string[]) => ({
      'verify.exit': '1', 'verify.files': 'a/store.ts',
      'verify.log': `${names.map(check).join('\n')}\n Test Files  1 failed | 2 passed (3)`,
    });
    const frozen = { 'verify.exit': '1', 'verify.log': `${check('lint -w @weasel-js/labkit')}\n Test Files  1 failed (1)` };
    const h = harness({ command: 'run {files}' }, { verify: [frozen], repair: [{ ...PASSING, 'fix.mbox': mbox(3) }] });
    write(h.fixDir, { ...branch(['lint -w @weasel-js/labkit']), 'fix.mbox': mbox(2) });
    const same = await verifyAndRepair(h.ctx, h.area, { mbox: join(h.fixDir, 'fix.mbox') }, h.fixDir);
    expect(same).toMatchObject({ ok: true, repairs: [], verify: { baseline: ['scripts/ci-checks.gate.ts'] } });
    const other = join(h.ctx.nightDir, 'jobs', 'b', 'fix');
    write(other, { ...branch(['lint -w @weasel-js/labkit', 'typecheck']), 'fix.mbox': mbox(1) });
    const more = await verifyAndRepair(h.ctx, { id: 'b' }, { mbox: join(other, 'fix.mbox') }, other);
    expect(more.repairs).toHaveLength(1);
    expect(h.said[1]).toBe('verify b: failed: 1 of 3 test files failed (scripts/ci-checks.gate.ts)');
  });

  it("names a frozen-tree check by its files and GUI flag, whatever the order or which area asks", () => {
    expect(baselineKey(['b.test.ts', 'a.test.ts'], false)).toBe(baselineKey(['a.test.ts', 'b.test.ts'], false));
    expect(baselineKey(['a.test.ts'], false)).not.toBe(baselineKey(['b.test.ts'], false));
    expect(baselineKey(['a.test.ts'], false)).not.toBe(baselineKey(['a.test.ts'], true));
  });

  it("repairs only an area's own failures, and tells the repair which failing files are the tree's", async () => {
    const two = {
      'verify.exit': '1',
      'verify.log': ' FAIL  a/store.pbt.test.ts > keeps order\n FAIL  a/own.test.ts > adds\n Test Files  2 failed | 1 passed (3)',
      'verify.files': 'a/store.ts',
    };
    const h = harness({ command: 'run {files}' }, {
      verify: [{ 'verify.exit': '1', 'verify.log': ' FAIL  a/store.pbt.test.ts > keeps order\n Test Files  1 failed | 1 passed (2)' }],
      repair: [{ ...two, 'fix.mbox': mbox(3) }, { ...two, 'fix.mbox': mbox(3) }],
    });
    write(h.fixDir, { ...two, 'fix.mbox': mbox(2) });
    const got = await verifyAndRepair(h.ctx, h.area, { mbox: join(h.fixDir, 'fix.mbox') }, h.fixDir);
    expect(got.verify).toMatchObject({ ok: false, failedFiles: ['a/own.test.ts'], baseline: ['a/store.pbt.test.ts'] });
    const brief = readFileSync(join(h.ctx.frozen, '.skulkr/in/a/repair.md'), 'utf8');
    expect(brief).toContain("leave them: `a/store.pbt.test.ts`.");
  });

  it('keeps failing when the frozen tree has every failing file but the failure goes beyond them', async () => {
    const unhandled = { ...FAILING, 'verify.log': `${FAILING['verify.log']}\n Errors  1 error` };
    const extra = { ...FAILING, 'verify.log': ' FAIL  a/store.pbt.test.ts > keeps order\n Test Files  2 failed | 1 passed (3)' };
    for (const files of [unhandled, extra]) {
      const h = harness({ command: 'run {files}' }, { verify: [BROKEN], repair: [{ ...PASSING, 'fix.mbox': mbox(3) }] });
      write(h.fixDir, { ...files, 'fix.mbox': mbox(2) });
      const got = await verifyAndRepair(h.ctx, h.area, { mbox: join(h.fixDir, 'fix.mbox') }, h.fixDir);
      expect(got.repairs).toHaveLength(1);
      expect(h.said[0]).toMatch(/^verify a: failed: .*set aside \(a\/store\.pbt\.test\.ts\)$/);
    }
  });

  it('keeps every later area whose file the frozen-tree check could not launch for, as failing rather than dropped', async () => {
    const h = harness({ command: 'run {files}' }, { repair: [{ ...PASSING, 'fix.mbox': mbox(3) }, { ...PASSING, 'fix.mbox': mbox(2) }] });
    const run = h.ctx.runner.run;
    h.ctx.runner.run = async (job: Job) => {
      if (job.task.endsWith('-verify')) throw new Error('runner gone');
      return run(job);
    };
    for (const id of ['a', 'b']) {
      const dir = join(h.ctx.nightDir, 'jobs', id, 'fix');
      write(dir, { ...FAILING, 'fix.mbox': mbox(2) });
      const got = await verifyAndRepair(h.ctx, { id }, { mbox: join(dir, 'fix.mbox') }, dir);
      expect(got).toMatchObject({ ok: true, repairs: [{ ok: true }] });
    }
  });

  it('keeps a failure the area owns when the frozen-tree run gives no file-level answer', async () => {
    const h = harness({ command: 'run {files}' }, {
      verify: [{ 'verify.exit': '1', 'verify.log': 'Error: no install' }],
      repair: [{ ...PASSING, 'fix.mbox': mbox(3) }],
    });
    write(h.fixDir, { ...FAILING, 'fix.mbox': mbox(2) });
    const got = await verifyAndRepair(h.ctx, h.area, { mbox: join(h.fixDir, 'fix.mbox') }, h.fixDir);
    expect(got.repairs).toHaveLength(1);
    expect(got.verify.baseline).toBeUndefined();
  });
});
