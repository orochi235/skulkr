import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gitIn } from './batch.mjs';
import { resolveConfig } from './config.mjs';
import { batchAndTest } from './land.mjs';
import { freshLog } from './gateRun.mjs';
import { leftOutIn } from './leftOut.mjs';

const dirs: string[] = [];
const temp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};
let fleetWas: string | undefined;
beforeEach(() => {
  fleetWas = process.env.SKULKR_FLEET;
  process.env.SKULKR_FLEET = temp('skulkr-fleet-');
});
afterEach(() => {
  if (fleetWas === undefined) delete process.env.SKULKR_FLEET;
  else process.env.SKULKR_FLEET = fleetWas;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const area = (id: string) => ({
  id, files: [`${id}.txt`], a: 1, b: 1, m: 1, distinct: 1, chapman: 1, unfound: 0, read: { A: 1, B: 1 }, patches: 1, questions: 0,
  jobs: { weightedTokens: 1e6, costUsd: 1 }, fixCommits: [],
});

/** A project on `main` whose `shared.txt` main has changed since `frozen`, with a state dir and a green gate. */
const project = (gate = ['true'], gateExtra: object = {}) => {
  const root = temp('skulkr-land-');
  const git = gitIn(root);
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'skulkr@example.invalid');
  git('config', 'user.name', 'skulkr');
  const remote = temp('skulkr-remote-');
  gitIn(remote)('init', '-q', '--bare', '-b', 'main');
  git('remote', 'add', 'origin', remote);
  const put = (file: string, text: string) => {
    writeFileSync(join(root, file), text);
    git('add', file);
    git('commit', '-q', '-m', `${file}: ${text}`);
  };
  put('shared.txt', 'base');
  put('.gitignore', '.worktrees/\n');
  const frozen = git('rev-parse', 'HEAD');
  put('shared.txt', 'main');
  const cfg = resolveConfig({ state: temp('skulkr-state-'), record: { dir: 'audit-log' }, gate: { command: gate, ...gateExtra } });
  /** `audit<round>-<id>` from `from`, writing `file`. */
  const branch = (round: number, id: string, file: string, from = frozen) => {
    const name = cfg.names.area(round, id);
    git('checkout', '-q', '-b', name, from);
    put(file, name);
    git('checkout', '-q', 'main');
    return name;
  };
  const night = async (round: number, branches: string[], early = false, more: object = {}) => {
    const said: string[] = [];
    const outcomes: Record<string, string> = {};
    const results = branches.map((b) => area(b.replace(cfg.names.area(round, ''), '')));
    const landed: { tip: string; areas: string[] }[] = [];
    const report = await batchAndTest({
      cfg, root, git, round, commit: frozen, date: '2026-11-21', nightDir: temp('skulkr-night-'), branches, results,
      sweep: undefined, outcomes, merge: true, say: (l: string) => said.push(l), setStep: () => {}, repair: undefined, baseline: undefined, early, ...more,
      onLanded: (l: { tip: string; areas: string[] }) => landed.push(l),
    });
    return { report, outcomes, said, landed };
  };
  return { cfg, root, git, remote, frozen, branch, night };
};

describe('batchAndTest', () => {
  it('names a conflict\'s paths, records the branch, and merges it in a later round once it merges cleanly', async () => {
    const { cfg, git, remote, branch, night } = project();
    const clean = branch(3, 'a', 'a.txt');
    const clash = branch(3, 'b', 'shared.txt');
    const three = await night(3, [clean, clash]);
    expect(three.report).toMatch(/^main fast-forwarded to \w+ and pushed to origin$/);
    expect(gitIn(remote)('rev-parse', 'main')).toBe(git('rev-parse', 'main'));
    expect(three.outcomes.b).toBe(`\`${clash}\`, left out: merge conflict in shared.txt`);
    expect(three.said).toContain(`batch: ${clash} left out: merge conflict in shared.txt`);
    expect(three.report).toMatch(/^main fast-forwarded/);
    expect(leftOutIn(cfg.state)).toEqual([{ branch: clash, round: 3, why: 'merge conflict in shared.txt' }]);

    // Round 4 tries it again; it still conflicts, so it stays recorded and the round's own area is unaffected.
    const c = branch(4, 'c', 'c.txt', git('rev-parse', 'main'));
    const four = await night(4, [c]);
    expect(four.outcomes).toEqual({ c: `\`${c}\`` });
    expect(four.report).toContain('retried 1 branches left out of earlier rounds, 0 merged and 1 still left out');
    expect(leftOutIn(cfg.state).map((e: { branch: string }) => e.branch)).toEqual([clash]);

    // Someone rebases it onto main; round 5 merges it and the record lets it go.
    git('checkout', '-q', clash);
    git('reset', '-q', '--hard', 'main');
    writeFileSync(join(git('rev-parse', '--show-toplevel'), 'shared.txt'), 'rebased');
    git('commit', '-q', '-am', 'rebased');
    git('checkout', '-q', 'main');
    const d = branch(5, 'd', 'd.txt', git('rev-parse', 'main'));
    const five = await night(5, [d]);
    expect(five.said).toContain(`batch: ${clash}, left out of round 3, merged`);
    expect(five.report).toContain('1 merged and 0 still left out');
    expect(readFileSync(join(git('rev-parse', '--show-toplevel'), 'shared.txt'), 'utf8')).toBe('rebased');
    expect(leftOutIn(cfg.state)).toEqual([]);
  }, 15_000);

  it("tells the run which of its areas landed and at what tip, though landing deletes their branches", async () => {
    const { git, branch, night } = project();
    const a = branch(3, 'a', 'a.txt');
    const clash = branch(3, 'b', 'shared.txt');
    const three = await night(3, [a, clash]);
    expect(three.landed).toEqual([{ tip: git('rev-parse', 'main'), areas: ['a'] }]);
    expect(git('branch', '--list', a)).toBe('');
  });

  it('reports a merge that failed without conflicting as failed, with git\'s message', async () => {
    const { cfg, night } = project();
    const gone = cfg.names.area(3, 'gone');
    const three = await night(3, [gone]);
    expect(three.outcomes.gone).toMatch(new RegExp(`^\`${gone}\`, left out: merge failed: .*${gone}`));
    expect(three.outcomes.gone).not.toMatch(/conflict/);
  });
});

describe('batchAndTest with checks', () => {
  /** A gate that appends its arguments to the file `runs` and fails `a.test.ts`'s test `t` when `fail`. */
  let runs = '';
  beforeEach(() => {
    runs = join(temp('skulkr-runs-'), 'runs');
  });
  const gate = (fail: boolean) => ['sh', '-c', `echo "$*" >> ${runs}; ${fail ? 'echo "fleet-fail: core a.test.ts :: t"; exit 1' : 'exit 0'}`, 'gate'];
  const runsIn = () => {
    try {
      return readFileSync(runs, 'utf8').replace(/\n$/, '').split('\n');
    } catch {
      return [];
    }
  };
  const checks = (preflight: object, shared: string[] | null) => ({
    preflight: async () => preflight,
    onMain: async () => (shared ? { tip: 'main', keys: shared, where: shared.map((k) => k.split(' ')[1]) } : null),
    gateArgs: ['--no-checks'],
  });

  it("tells the gate the checks ran, and lands over a red gate whose every failure main's tip has too", async () => {
    const { branch, night } = project(gate(true), { failPrefix: 'fleet-fail:' });
    const a = branch(3, 'a', 'a.txt');
    const three = await night(3, [a], false, { checks: checks({ ok: true }, ['core a.test.ts :: t']) });
    expect(runsIn()).toEqual(['--no-checks']);
    expect(three.report).toMatch(/^main fast-forwarded/);
    expect(three.report).toMatch(/main red at main: 1 failures it has too \(a\.test\.ts\)/);
    expect(three.said).toContain("gate: every failure left (1) fails on main's tip too; landing over them");
  });

  it('stops at a preflight that fails for the batch, never running the gate', async () => {
    const { git, branch, night } = project(gate(false), { failPrefix: 'fleet-fail:' });
    const log = join(temp('skulkr-pre-'), 'pre.log');
    writeFileSync(log, 'fleet-fail: gate scripts/ci-checks.gate.ts :: npm run lint\n');
    const before = git('rev-parse', 'main');
    const a = branch(3, 'a', 'a.txt');
    const three = await night(3, [a], false, { checks: checks({ ok: false, unrun: false, log }, null) });
    expect(runsIn()).toEqual([]);
    expect(three.report).toMatch(/^red: the preflight failed on batch\//);
    expect(git('rev-parse', 'main')).toBe(before);
  });

  it('runs the checks in the gate where the preflight gave no verdict', async () => {
    const { branch, night } = project(gate(false), { failPrefix: 'fleet-fail:' });
    const a = branch(3, 'a', 'a.txt');
    const three = await night(3, [a], false, { checks: checks({ ok: false, unrun: true }, null) });
    expect(runsIn()).toEqual(['']);
    expect(three.report).toMatch(/^main fast-forwarded/);
  });

  it('tests no tree twice when every repair passed without a commit and main has not moved', async () => {
    const { branch, night } = project(gate(true), { failPrefix: 'fleet-fail:' });
    const a = branch(3, 'a', 'a.test.ts');
    const repaired: string[] = [];
    const three = await night(3, [a], false, { repair: async (id: string) => (repaired.push(id), { ok: true, added: 0 }) });
    expect(repaired).toEqual(['a']);
    expect(runsIn()).toHaveLength(1);
    expect(three.said).toContain('capstone: 1 repairs passed with no commit and main has not moved; not testing the same tree again');
    expect(three.report).toMatch(/^red: /);
  });
});

describe('an early landing', () => {
  it('lands what merges without a record, and leaves a branch that would not merge for the round', async () => {
    const { cfg, root, git, branch, night } = project();
    const a = branch(3, 'a', 'a.txt');
    const clash = branch(3, 'b', 'shared.txt');
    const three = await night(3, [a, clash], true);
    expect(three.report).toMatch(/^main fast-forwarded/);
    expect(three.landed).toEqual([{ tip: git('rev-parse', 'main'), areas: ['a'] }]);
    expect(three.said).toContain(`batch: ${clash} would not merge early (merge conflict in shared.txt); it waits for the round's batch`);
    expect(leftOutIn(cfg.state)).toEqual([]);
    expect(git('ls-tree', '--name-only', 'main')).not.toContain('audit-log');
    expect(git('branch', '--list', a, clash, 'batch/*').split('\n').map((b) => b.trim().replace(/^\* /, ''))).toEqual([clash]);
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe(a);
  });

  it('red, leaves main, keeps its branches for the round, and deletes its own batch', async () => {
    const { git, branch, night } = project(['false']);
    const before = git('rev-parse', 'main');
    const a = branch(3, 'a', 'a.txt');
    const three = await night(3, [a], true);
    expect(three.report).toBe("red; its branches wait for the round's batch");
    expect(git('rev-parse', 'main')).toBe(before);
    expect(three.landed).toEqual([]);
    expect(git('branch', '--list', a)).not.toBe('');
    expect(git('branch', '--list', 'batch/*')).toBe('');
    expect(git('worktree', 'list')).not.toMatch(/-early/);
  });
});

describe('freshLog', () => {
  it("names a log no earlier run of the round left, so a resumed gate's progress is its own", () => {
    const dir = temp('skulkr-logs-');
    expect(freshLog(dir, 'batch-x', '.test.log')).toBe(join(dir, 'batch-x.test.log'));
    writeFileSync(join(dir, 'batch-x.test.log'), 'onto: progress 36960/36960 tests\n');
    expect(freshLog(dir, 'batch-x', '.test.log')).toBe(join(dir, 'batch-x.r2.test.log'));
    writeFileSync(join(dir, 'batch-x.r2.test.log'), '');
    expect(freshLog(dir, 'batch-x', '.test.log')).toBe(join(dir, 'batch-x.r3.test.log'));
  });
});
