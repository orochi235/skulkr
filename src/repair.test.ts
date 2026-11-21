import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveConfig } from './config.mjs';
import { verifyAndRepair } from './repair.mjs';

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
    const h = harness({ command: 'run {files}' }, { repair: [{ ...PASSING, 'fix.mbox': mbox(3) }] });
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
    const h = harness({ command: 'run {files}' }, { repair: [{ ...FAILING, 'fix.mbox': mbox(2) }, { ...FAILING, 'fix.mbox': mbox(2) }] });
    write(h.fixDir, { ...FAILING, 'fix.mbox': mbox(2) });
    const got = await verifyAndRepair(h.ctx, h.area, { mbox: join(h.fixDir, 'fix.mbox') }, h.fixDir);
    expect(got.ok).toBe(false);
    expect(got.repairs).toHaveLength(2);
    expect(got.verify).toMatchObject({ ok: false, failedFiles: ['a/store.pbt.test.ts'] });
    expect(h.said.at(-1)).toBe('verify a: still failing after 2 repairs; left out of the batch');
  });

  it('runs the GUI part on a GUI node where the probe lists a browser test, and repairs what fails there', async () => {
    const verify = { command: 'run {files}', gui: { probe: 'list {related}', command: 'run-gui {files}' } };
    const h = harness(verify, {
      verify: [FAILING, PASSING],
      repair: [{ ...PASSING, 'fix.mbox': mbox(2), 'gui.exit': '0', 'gui.txt': '[browser] a/Bar.browser.test.tsx' }],
    });
    write(h.fixDir, { ...PASSING, 'fix.mbox': mbox(1), 'gui.exit': '0', 'gui.txt': '[browser] a/Bar.browser.test.tsx' });
    const got = await verifyAndRepair(h.ctx, h.area, { mbox: join(h.fixDir, 'fix.mbox') }, h.fixDir);
    expect(h.jobs.map((j) => [j.task, j.kind, Boolean(j.gui)])).toEqual([
      ['audit7-a-verify', 'test', true], ['audit7-a-repair', 'fix', false], ['audit7-a-verify', 'test', true],
    ]);
    expect(got).toMatchObject({ ok: true, verify: { ok: true, gui: true } });
  });

  it('verifies in a job of its own where the fixer left no verdict, and lets a timed-out run land unrepaired', async () => {
    const h = harness({ command: 'run {files}' }, { verify: [{ 'verify.exit': '142', 'verify.log': '', 'verify.files': 'a/x.ts' }] });
    write(h.fixDir, { 'fix.mbox': mbox(1) });
    const got = await verifyAndRepair(h.ctx, h.area, { mbox: join(h.fixDir, 'fix.mbox') }, h.fixDir);
    expect(h.jobs.map((j) => j.task)).toEqual(['audit7-a-verify']);
    expect(got).toMatchObject({ ok: false, repairs: [], verify: { ok: false, timedOut: true } });
  });
});
