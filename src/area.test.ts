import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runArea } from './area.mjs';
import { resolveConfig } from './config.mjs';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const scratch = () => {
  const d = mkdtempSync(join(tmpdir(), 'skulkr-area-'));
  dirs.push(d);
  return d;
};

const REPORT = '## drops the last row\n- where: a/x.ts\n\n## Files read\n- a/x.ts\n\n<!-- done: 1 finding -->\n';
const reply = (result: string) => JSON.stringify({ type: 'result', is_error: false, result, total_cost_usd: 0.5 });

/** A run context whose runner answers each job as its step would, holding the step `held` until `release` is called. */
const context = (trial: boolean, held = '', config: object = {}) => {
  const order: string[] = [];
  const prompts: Record<string, string> = {};
  let release = () => {};
  const gate = new Promise<void>((done) => { release = done; });
  const frozen = scratch();
  writeFileSync(join(frozen, 'x.ts'), 'x');
  const ctx = {
    cfg: resolveConfig(config), round: 7, commit: 'c0ffee', date: '2026-11-22', frozen, nightDir: scratch(), frozenTree: 't', identity: {},
    budget: { review: 8, match: 1, fix: 15 }, total: { review: 4, match: 2, fix: 1 }, trial: trial ? 'preload' : undefined, trialStaggerMs: 0,
    say: () => {}, progress: () => {}, usage: () => {}, refuse: () => {}, stopped: () => false, earlierNights: [],
    acquire: async () => ({ node: 'studio', release: () => {} }),
    runner: { run: async (job: { to: string; task: string; shell: string }) => {
      const step = job.task.replace('audit7-a-', '');
      prompts[step] = /review-preload\.md/.test(job.shell) ? 'preloaded' : 'plain';
      if (step === held) await gate;
      order.push(step);
      mkdirSync(job.to, { recursive: true });
      writeFileSync(join(job.to, 'exit'), '0');
      if (step.startsWith('match')) writeFileSync(join(job.to, 'claude.json'), reply('{"pairs": [[0, 0]]}'));
      else if (step === 'fix') writeFileSync(join(job.to, 'claude.json'), reply('nothing to fix'));
      else {
        writeFileSync(join(job.to, 'findings.md'), REPORT);
        writeFileSync(join(job.to, 'claude.json'), reply(REPORT));
      }
      return { status: 0 };
    } },
  };
  return { ctx, order, prompts, release: () => release() };
};

const area = { id: 'a', files: ['a/x.ts'] };

describe('runArea', () => {
  it('matches and fixes from its own pair without waiting for a preload trial pair, then records the trial', async () => {
    const { ctx, order, release } = context(true, 'TB');
    const running = runArea(ctx, area, { previous: undefined, changedSince: [] });
    for (let i = 0; i < 100 && !order.includes('fix'); i++) await new Promise((r) => setTimeout(r, 10));
    expect(order).toContain('match');
    expect(order).toContain('fix');
    expect(order).not.toContain('TB');
    release();
    const summary = await running;
    expect(summary).toMatchObject({ id: 'a', a: 1, b: 1, m: 1 });
    expect(order.indexOf('match-T')).toBeGreaterThan(order.indexOf('TB'));
    expect(readFileSync(join(ctx.nightDir, 'areas/a/A.md'), 'utf8')).toBe(REPORT);
    expect(existsSync(join(ctx.nightDir, 'trial/a.json'))).toBe(true);
  });

  it("preloads its own pair's files by default, and runs a trial pair of the other kind", async () => {
    const { ctx, prompts } = context(true);
    await runArea(ctx, area, { previous: undefined, changedSince: [] });
    expect(prompts).toMatchObject({ A: 'preloaded', B: 'preloaded', TA: 'plain', TB: 'plain' });
    const trial = JSON.parse(readFileSync(join(ctx.nightDir, 'trial/a.json'), 'utf8'));
    expect(Object.keys(trial)).toEqual(['round', 'area', 'files', 'base', 'preload']);
  });

  it("reads its files itself where the config turns preloading off", async () => {
    const { ctx, prompts } = context(false, '', { review: { preload: false } });
    await runArea(ctx, area, { previous: undefined, changedSince: [] });
    expect(prompts).toMatchObject({ A: 'plain', B: 'plain' });
  });

  it('runs one pair, matched, then its fix, without a trial', async () => {
    const { ctx, order } = context(false);
    const summary = await runArea(ctx, area, { previous: undefined, changedSince: [] });
    expect(summary).toMatchObject({ id: 'a', a: 1, b: 1, m: 1 });
    expect([...order].sort()).toEqual(['A', 'B', 'fix', 'match']);
    expect(readFileSync(join(ctx.nightDir, 'areas/a/fix.md'), 'utf8')).toBe('nothing to fix');
    expect(existsSync(join(ctx.nightDir, 'trial'))).toBe(false);
  });
});
