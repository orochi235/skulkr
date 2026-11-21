import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gitIn } from './batch.mjs';
import { excerptFor, repairRefusal } from './capstone.mjs';
import { resolveConfig } from './config.mjs';
import { batchAndTest } from './land.mjs';
import { leftOutIn } from './leftOut.mjs';

const dirs: string[] = [];
const scratch = () => {
  const d = mkdtempSync(join(tmpdir(), 'skulkr-capstone-'));
  dirs.push(d);
  return d;
};
const fleetWas = process.env.SKULKR_FLEET;
beforeEach(() => {
  process.env.SKULKR_FLEET = scratch();
});
afterEach(() => {
  if (fleetWas === undefined) delete process.env.SKULKR_FLEET;
  else process.env.SKULKR_FLEET = fleetWas;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A checkout on `main` at the round's frozen commit, with an area branch per entry of `areas` changing its files. */
const round = (areas: Record<string, Record<string, string>>) => {
  const root = scratch();
  const git = gitIn(root);
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'skulkr@example.invalid');
  git('config', 'user.name', 'skulkr');
  const put = (files: Record<string, string>, message: string) => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(root, path, '..'), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    git('add', '-A');
    git('commit', '-q', '-m', message);
  };
  put({ 'src/a.ts': 'ok', 'src/a.test.ts': "import './a';", 'docs/d.md': 'd' }, 'base');
  const commit = git('rev-parse', 'HEAD');
  for (const [id, files] of Object.entries(areas)) {
    git('checkout', '-q', '-b', `audit5-${id}`);
    put(files, `fix ${id}`);
    git('checkout', '-q', 'main');
  }
  return { root, git, commit, branches: Object.keys(areas).map((id) => `audit5-${id}`) };
};

/** A gate failing `src/a.test.ts` while `src/a.ts` says broken. */
const GATE = 'if grep -q broken src/a.ts; then echo "fleet-fail: core src/a.test.ts :: a > works"; echo " FAIL  src/a.test.ts > a > works"; echo "AssertionError: broken"; exit 1; fi';

const summary = (id: string) => ({
  id, files: ['src/a.ts'], read: { A: 1, B: 1 }, a: 1, b: 1, m: 1, distinct: 1, patches: 1, questions: 0, fixCommits: [],
  jobs: { minutes: {}, weightedTokens: 0, costUsd: 0 },
});

const land = async (r: ReturnType<typeof round>, repair?: (id: string, files: string[], log: string) => Promise<{ ok: boolean }>, gate: object = {}, baseline?: (files: string[]) => Promise<string[]>, state = scratch(), mayRepair?: (started: number) => string) => {
  const said: string[] = [];
  const cfg = resolveConfig({ name: 't', state, gate: { name: 'test', command: ['bash', '-c', GATE], cwd: 'batch', failPrefix: 'fleet-fail:', ...gate } });
  const results = r.branches.map((b) => summary(b.replace('audit5-', '')));
  const outcomes: Record<string, string> = {};
  const report = await batchAndTest({
    cfg, root: r.root, git: r.git, round: 5, commit: r.commit, date: '2026-11-20', nightDir: scratch(), branches: r.branches, results,
    sweep: undefined, outcomes, merge: true, say: (l: string) => said.push(l), setStep: () => {}, repair, mayRepair, baseline,
  });
  return { report, said, results, outcomes };
};

describe('a red capstone', () => {
  it('repairs the branch whose commit broke a failing file, rebuilds the batch, and lands it green', async () => {
    const r = round({ src: { 'src/a.ts': 'broken' }, docs: { 'docs/d.md': 'e' } });
    const asked: [string, string[], string][] = [];
    const { report, said } = await land(r, async (id, files, log) => {
      asked.push([id, files, log]);
      r.git('checkout', '-q', 'audit5-src');
      writeFileSync(join(r.root, 'src/a.ts'), 'fixed');
      r.git('commit', '-qam', 'repair');
      r.git('checkout', '-q', 'main');
      return { ok: true };
    });
    expect(asked).toEqual([['src', ['src/a.test.ts'], expect.stringContaining('AssertionError: broken')]]);
    expect(said).toContain('capstone: 1 failures; src 1');
    expect(report).toMatch(/^main fast-forwarded to \w+; capstone repair: repaired src; the capstone ran again green$/);
  });

  it('leaves out a branch whose repair still fails, and names what no branch caused', async () => {
    const r = round({ src: { 'src/a.ts': 'broken' } });
    const { report, results } = await land(r, async () => ({ ok: false }));
    expect(report).toContain('capstone repair: left out src, whose repair still failed; the capstone ran again green');
    expect(results[0]!.fixCommits).toEqual([]);
    // Kept, the branch would hold the area out of every later round's plan.
    expect(r.git('branch', '--list', 'audit5-src')).toBe('');
  });

  it("lays a failed step at the branches that changed what the config's blame reads from its output", async () => {
    const r = round({ src: { 'src/a.ts': 'broken' }, docs: { 'docs/d.md': 'e' } });
    const step = 'if grep -q broken src/a.ts; then echo "fleet-fail: post npm run check:x"; echo "  [x] src: names a type it does not export"; exit 1; fi';
    const asked: [string, string[], string][] = [];
    const { said } = await land(r, async (id, files, log) => {
      asked.push([id, files, log]);
      return { ok: false };
    }, { command: ['bash', '-c', step], blame: (text: string, s: string) => (s === 'npm run check:x' && text.includes('[x] src:') ? ['src'] : []) });
    expect(asked).toEqual([['src', ['npm run check:x'], expect.stringContaining('[x] src: names a type')]]);
    expect(said).toContain('capstone: 1 failures; src 1');
  });

  it('lands over failures the frozen commit has too, and stays red over one it does not', async () => {
    const old = await land(round({ src: { 'src/a.ts': 'broken' } }), undefined, {}, async (files) => files);
    expect(old.report).toMatch(/^main fast-forwarded to \w+; landed over 1 failures main already has \(src\/a\.test\.ts\)$/);
    const fresh = await land(round({ src: { 'src/a.ts': 'broken' } }), undefined, {}, async () => []);
    expect(fresh.report).toMatch(/^red: /);
  });

  it("leaves out an earlier round's branch the failures are laid at, without a repair, and lands the rest", async () => {
    const r = round({ docs: { 'docs/d.md': 'e' } });
    r.git('checkout', '-q', '-b', 'audit4-src', r.commit);
    writeFileSync(join(r.root, 'src/a.ts'), 'broken');
    r.git('commit', '-qam', 'fix src in round 4');
    r.git('checkout', '-q', 'main');
    const state = scratch();
    writeFileSync(join(state, 'left-out.json'), JSON.stringify({ branches: [{ branch: 'audit4-src', round: 4, why: 'merge conflict in x' }] }));
    const asked: string[] = [];
    const { report, said } = await land(r, async (id) => {
      asked.push(id);
      return { ok: false };
    }, {}, undefined, state);
    expect(asked).toEqual([]);
    expect(said).toContain('repair audit4-src capstone: left out, not repairable this round');
    expect(report).toMatch(/^main fast-forwarded to \w+; .*capstone repair: left out audit4-src, not repairable this round; the capstone ran again green$/);
    expect(report).not.toContain('still failed');
    // Kept and recorded, every later round would merge it, go red, and run a capstone and a second gate over it.
    expect(r.git('branch', '--list', 'audit4-src')).toBe('');
    expect(leftOutIn(state)).toEqual([]);
  });

  it("keeps an earlier round's blamed branch for a retry when the batch lands only over failures main already has", async () => {
    const r = round({ docs: { 'docs/d.md': 'e' } });
    r.git('checkout', '-q', '-b', 'audit4-src', r.commit);
    writeFileSync(join(r.root, 'src/a.ts'), 'changed');
    r.git('commit', '-qam', 'fix src in round 4');
    r.git('checkout', '-q', 'main');
    const state = scratch();
    writeFileSync(join(state, 'left-out.json'), JSON.stringify({ branches: [{ branch: 'audit4-src', round: 4, why: 'merge conflict in x' }] }));
    const alwaysRed = 'echo "fleet-fail: core src/a.test.ts :: a > works"; echo " FAIL  src/a.test.ts > a > works"; exit 1';
    const { report } = await land(r, async () => ({ ok: false }), { command: ['bash', '-c', alwaysRed] }, async (files) => files, state);
    expect(report).toMatch(/^main fast-forwarded to \w+; .*landed over 1 failures main already has/);
    expect(r.git('branch', '--list', 'audit4-src')).not.toBe('');
    expect(leftOutIn(state).map((e: { branch: string }) => e.branch)).toEqual(['audit4-src']);
  });

  it('starts a repair only while the dollar cap and stop requests allow, leaving out the branches it does not repair', async () => {
    const r = round({ src: { 'src/a.ts': 'broken' }, docs: { 'docs/d.md': 'e' } });
    const asked: string[] = [];
    const { report, said, outcomes } = await land(r, async (id) => {
      asked.push(id);
      return { ok: true };
    }, {}, undefined, scratch(), () => 'stop requested');
    expect(asked).toEqual([]);
    expect(said).toContain('repair src capstone: not started, stop requested');
    expect(outcomes.src).toBe('`audit5-src`, left out: its capstone repair never started, for the dollar cap or a stop request');
    expect(report).toMatch(/^main fast-forwarded to \w+; capstone repair: left out src, whose repair the dollar cap or a stop request kept from starting; the capstone ran again green$/);
    expect(r.git('branch', '--list', 'audit5-src')).toBe('');
  });

  it('stays red with no repair given, as before', async () => {
    const r = round({ src: { 'src/a.ts': 'broken' } });
    const { report } = await land(r);
    expect(report).toMatch(/^red: batch\/2026-11-20-audit5 and its branches kept/);
    expect(report).not.toContain('capstone repair');
  });
});

describe('repairRefusal', () => {
  it('refuses on a stop request, and once the fixer ceiling of this repair and those started before it would pass the cap', () => {
    expect(repairRefusal({ stopped: true, used: 0, started: 0, fix: 15, cap: 160 })).toBe('stop requested');
    expect(repairRefusal({ stopped: false, used: 130, started: 1, fix: 15, cap: 160 })).toBe('');
    expect(repairRefusal({ stopped: false, used: 131, started: 1, fix: 15, cap: 160 })).toBe('a repair at its $15.00 ceiling would cross the $160.00 cap ($131.00 used, 1 repairs started)');
    expect(repairRefusal({ stopped: false, used: 150, started: 0, fix: 15, cap: 160 })).toBe('a repair at its $15.00 ceiling would cross the $160.00 cap ($150.00 used)');
  });
});

describe('excerptFor', () => {
  it("keeps each line naming a file and what follows it, up to another file's failure", () => {
    const log = ['noise', ' FAIL  a.test.ts > one', 'Error: x', ' FAIL  b.test.ts > two', 'Error: y'].join('\n');
    expect(excerptFor(log, ['a.test.ts'])).toBe(' FAIL  a.test.ts > one\nError: x');
  });
});
