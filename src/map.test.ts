import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { pin } from './pins.mjs';
import { buildMap, fleetOf,fleetProgressOf, gateFailuresOf, gateNodesOf, gateOutcomesOf, gateRunsOf, mergedIn, nightRoundOf, nightsOf, readRuns, rerunOf, withPasses } from './map.mjs';
import { gitIn } from './batch.mjs';
import { progressOfTop } from './runner/onto.mjs';
import { resolveConfig } from './config.mjs';
import { weaselConfig } from '../test/weaselConfig.ts';
import { claimRound, writeStatus, writeSummary } from './runs.mjs';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('withPasses', () => {
  it('gives a matched lane the pass its round made of the area, and an unmatched one none', () => {
    const W = { state: 'waiting' };
    const matched = { id: 'a', steps: { A: W, B: W, match: { state: 'done', a: 7, b: 4, shared: 1 }, fix: W, patch: W } };
    const [a, b] = withPasses([matched, { id: 'b', steps: { A: W, B: W, match: W, fix: W, patch: W } }], { round: 47, started: '2026-11-20T14:11:24.920Z' });
    expect(a!.pass).toEqual({ round: 47, date: '2026-11-20', a: 7, b: 4, shared: 1, distinct: 10, est: 19, left: 9 });
    expect(b).not.toHaveProperty('pass');
  });
});

describe('mergedIn', () => {
  it("answers whether an area branch is in main or its round's batch, as one merged by hand after a red round is", () => {
    const root = mkdtempSync(join(tmpdir(), 'skulkr-map-'));
    dirs.push(root);
    const git = gitIn(root);
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'skulkr@example.invalid');
    git('config', 'user.name', 'skulkr');
    git('commit', '-q', '--allow-empty', '-m', 'base');
    for (const b of ['audit80-a', 'audit80-b', 'audit80-c']) {
      git('checkout', '-q', '-b', b, 'main');
      git('commit', '-q', '--allow-empty', '-m', b);
    }
    git('checkout', '-q', '-b', 'batch/2026-11-23-audit80', 'main');
    git('merge', '-q', '--no-ff', '--no-edit', 'audit80-a');
    git('checkout', '-q', 'main');
    git('merge', '-q', '--ff-only', 'audit80-c');
    const merged = mergedIn(resolveConfig({}), git);
    expect([merged(80, 'a'), merged(80, 'b'), merged(80, 'c'), merged(80, 'gone'), merged(81, 'a')]).toEqual([true, false, true, false, false]);
  });
});

describe('nightRoundOf', () => {
  it("finds a run's night directory by its round where its record names none", () => {
    const state = mkdtempSync(join(tmpdir(), 'skulkr-map-'));
    dirs.push(state);
    mkdirSync(join(state, 'nights', '2026-11-20T01-31-25-262Z-round41'), { recursive: true });
    writeFileSync(join(state, 'last.json'), JSON.stringify({ round: 41, started: 's', ended: 'e', areas: [] }));
    expect(readRuns(state, [])[0]!.nightDir).toBe(join(state, 'nights', '2026-11-20T01-31-25-262Z-round41'));
  });

  it('finds every round in the nights directory, the latest night of each, live where a run still holds it', () => {
    const state = mkdtempSync(join(tmpdir(), 'skulkr-map-'));
    dirs.push(state);
    for (const name of ['2026-11-19T22-49-35-217Z-round40', '2026-11-20T03-23-24-845Z-round42', '2026-11-20T04-00-00-000Z-round42', 'scratch']) {
      mkdirSync(join(state, 'nights', name), { recursive: true });
    }
    expect(nightsOf([{ round: 42, running: true }], state)).toEqual([
      { round: 40, started: '2026-11-19', nightDir: join(state, 'nights', '2026-11-19T22-49-35-217Z-round40'), running: false },
      { round: 42, started: '2026-11-20', nightDir: join(state, 'nights', '2026-11-20T04-00-00-000Z-round42'), running: true },
    ]);
    expect(nightsOf([], join(state, 'missing'))).toEqual([]);
  });

  it('leaves out a round whose night was abandoned', () => {
    const state = mkdtempSync(join(tmpdir(), 'skulkr-map-'));
    dirs.push(state);
    for (const name of ['2026-11-20T19-14-32-392Z-round51', '2026-11-20T20-10-16-686Z-round52']) mkdirSync(join(state, 'nights', name), { recursive: true });
    writeFileSync(join(state, 'nights', '2026-11-20T20-10-16-686Z-round52', 'abandoned'), 'stopped while moving services\n');
    expect(nightsOf([], state).map((n) => n.round)).toEqual([51]);
  });

  it("draws a round with no committed record from its night directory's finished areas", () => {
    const nightDir = mkdtempSync(join(tmpdir(), 'skulkr-night-'));
    dirs.push(nightDir);
    const area = (id: string, a: number, b: number, pairs: number, files: number) => {
      mkdirSync(join(nightDir, 'areas', id), { recursive: true });
      writeFileSync(join(nightDir, 'areas', id, 'match.json'), JSON.stringify({ pairs: Array(pairs).fill([0, 0]), a: Array(a).fill('x'), b: Array(b).fill('y') }));
      writeFileSync(join(nightDir, 'areas', id, 'files.txt'), `${Array(files).fill('f.ts').join('\n')}\n`);
    };
    area('core.ops', 5, 2, 2, 24);
    area('geom', 3, 3, 3, 10);
    mkdirSync(join(nightDir, 'areas', 'cursor'));
    const bar = nightRoundOf({ round: 42, running: true, started: '2026-11-20T03:23:24Z', nightDir });
    expect(bar).toMatchObject({ round: 42, date: '2026-11-20', areas: 2, files: 34, distinct: 8, pending: 'live' });
    expect(bar!.est).toBeCloseTo(5 + 3);
    expect(nightRoundOf({ round: 41, running: false, nightDir })?.pending).toBe('unmerged');
    expect(nightRoundOf({ round: 40, running: false, nightDir: null })).toBeNull();
    expect(nightRoundOf({ round: 43, running: true, started: '2026-11-20T03:23:24Z', nightDir: null })).toMatchObject({ round: 43, areas: 0, distinct: 0, pending: 'live' });
  });
});

describe('readRuns', () => {
  it('lists a resumed round once, as its live run, not beside the summary its earlier run left', () => {
    const state = mkdtempSync(join(tmpdir(), 'skulkr-map-'));
    dirs.push(state);
    const dir = join(state, 'nights', 'r70');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'night.log'), '');
    claimRound(70, state);
    writeSummary(70, { round: 70, started: 's', ended: 'e', areas: [{ id: 'a' }], nightDir: dir, report: 'red: …' }, state);
    writeStatus(70, { step: 'fleet', areas: ['a'], nightDir: dir }, state);
    expect(readRuns(state, []).map((r) => [r.round, r.running])).toEqual([[70, true]]);
  });

  it('lists every live run with its own stages, lanes and lines, then the last finished', () => {
    const state = mkdtempSync(join(tmpdir(), 'skulkr-map-'));
    dirs.push(state);
    const night = (round: number, lines: string[]) => {
      const dir = join(state, 'nights', `r${round}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'night.log'), `${lines.join('\n')}\n`);
      return dir;
    };
    for (const round of [40, 41, 42]) claimRound(round, state);
    writeSummary(40, { round: 40, started: 's', ended: 'e', areas: [{ id: 'old' }], nightDir: night(40, []) }, state);
    writeStatus(41, { step: 'review', areas: ['a'], nightDir: night(41, ['review 1/2 a A on studio: 0 findings, 3/3 files read, 1.0 min']) }, state);
    writeStatus(42, { step: 'fleet', areas: ['b'], nightDir: night(42, ['patch b: 1 commits on audit42-b']) }, state);
    const jobs = [{ task: 'audit41-a-B', node: 'teitou', started: 't' }, { task: 'audit42-a-B', node: 'studio', started: 'u' }];
    const runs = readRuns(state, jobs);
    expect(runs.map((r) => [r.round, r.running, r.step, r.areas, r.stages])).toEqual([
      [41, true, 'review', ['a'], { a: 'reviewing' }],
      [42, true, 'fleet', ['b'], { b: 'patched' }],
      [40, false, 'done', ['old'], {}],
    ]);
    expect(runs[0].lanes).toEqual([{ id: 'a', steps: {
      A: { state: 'done', node: 'studio', findings: 0, read: 3, files: 3, minutes: 1 },
      B: { state: 'running', node: 'teitou', since: 't' },
      match: { state: 'waiting' }, fix: { state: 'waiting' }, patch: { state: 'waiting' },
    } }]);
    expect(runs[1].lanes[0].steps.patch).toEqual({ state: 'done', commits: 1 });
    expect(runs[1].lines).toEqual(['patch b: 1 commits on audit42-b']);
    expect(runs[2].lanes).toEqual([{ id: 'old', steps: expect.objectContaining({ A: { state: 'waiting' } }) }]);
    expect(runs[2].nightDir).toBe(join(state, 'nights', 'r40'));
  });
});

describe('fleetProgressOf', () => {
  it('reads each gate run\'s last progress line from the gate log, by its prefix', () => {
    const night = mkdtempSync(join(tmpdir(), 'skulkr-map-'));
    dirs.push(night);
    const gate = weaselConfig().gate;
    expect(fleetProgressOf(night, gate)).toBeNull();
    writeFileSync(join(night, 'batch-2026-11-20-audit50.test-batch.log'),
      'onto: progress 3/90\npostbuild| onto: progress 1/4\n\x1b[2monto: progress 7/90\x1b[0m\n');
    expect(fleetProgressOf(night, gate)).toEqual({ tests: { done: 7, total: 90 }, build: { done: 1, total: 4 } });
  });
});

describe('gate outcomes and reruns', () => {
  const cfg = weaselConfig();
  it('reads each gate run\'s end from its closing line, or the whole gate\'s from the night log', () => {
    const night = mkdtempSync(join(tmpdir(), 'skulkr-map-'));
    dirs.push(night);
    writeFileSync(join(night, 'batch-2026-11-20-audit49.test-batch.log'), 'test:fleet failed\ntest:fleet:postbuild passed\n');
    expect(gateOutcomesOf(night, cfg.gate)).toEqual({ tests: 'failed', build: 'passed' });
    const plain = resolveConfig().gate;
    writeFileSync(join(night, 'night.log'), 'gate: gate failed (1); its log is x\n');
    expect(gateOutcomesOf(night, plain)).toEqual({ tests: 'failed' });
  });

  it('says what each gate run failed: how many, in which files, each test with its error', () => {
    const night = mkdtempSync(join(tmpdir(), 'skulkr-map-'));
    dirs.push(night);
    writeFileSync(join(night, 'batch-2026-11-20-audit54.test-batch.log'), [
      'fleet-fail: core packages/a/x.test.ts :: x > one',
      'fleet-fail: core packages/a/x.test.ts :: x > two',
      'fleet-fail: browser:chromium packages/b/y.browser.test.tsx :: y > three',
      'fleet-fail: postbuild npm run check:unnameable',
      ' FAIL  core  packages/a/x.test.ts > x > one',
      'AssertionError: expected 1 to be 2',
      'browser|  FAIL   browser (chromium)  packages/b/y.browser.test.tsx > y > three',
      'browser| TypeError: Illegal invocation',
      'test:fleet failed',
    ].join('\n'));
    const failed = gateFailuresOf(night, cfg.gate)!;
    expect(failed.tests).toMatchObject({ count: 3, files: 2, names: ['packages/a/x.test.ts', 'packages/b/y.browser.test.tsx'] });
    expect(failed.tests!.list[0]).toEqual({ file: 'packages/a/x.test.ts', count: 1, tests: [{ test: 'x > one', error: 'AssertionError: expected 1 to be 2' }] });
    expect(failed.tests!.list[1]!.tests[0]!.error).toBe('TypeError: Illegal invocation');
    expect(failed.build).toMatchObject({ count: 1, files: 1, names: ['npm run check:unnameable'] });
  });

  it('names a gate\'s runs by their labels, or by their keys where the config gives none', () => {
    expect(gateRunsOf({ progress: { tests: '' } })).toEqual([{ id: 'tests', label: 'tests' }]);
  });

  it('reads every run of a capstone going again as running, the one with no job placed yet too', () => {
    const night = mkdtempSync(join(tmpdir(), 'skulkr-map-'));
    dirs.push(night);
    writeFileSync(join(night, 'batch-2026-11-20-audit49.test-batch.log'), 'test:fleet failed\ntest:fleet:postbuild passed\n');
    const jobs = [{ task: 'postbuild-batch-2026-11-20-audit49', node: 'teitou', finished: false, progress: { done: 1, total: 17 } }];
    const run = { round: 49, nightDir: night };
    const again = fleetOf(run, false, jobs, cfg.gate, cfg.names);
    expect(again.gates).toEqual({ tests: 'running', build: 'running' });
    expect(again.gateRuns).toEqual([{ id: 'tests', label: 'fleet tests' }, { id: 'build', label: 'postbuild' }]);
    expect(again.failures).toBeNull();
  });

  it('splits a rerun batch\'s running jobs between the gate runs, summing their progress', () => {
    const jobs = [
      { task: 'batch-2026-11-20-audit49-s1', node: 'studio', progress: { done: 3, total: 10 } },
      { task: 'batch-2026-11-20-audit49-s2', node: 'teitou', progress: { done: 1, total: 10 } },
      { task: 'postbuild-batch-2026-11-20-audit49', node: 'studio' },
      { task: 'batch-2026-11-20-audit48', node: 'keiei' },
      { task: 'batch-2026-11-20-audit49-old', node: 'keiei', finished: 'f' },
    ];
    expect(rerunOf(49, jobs, cfg.gate, cfg.names)).toEqual({ tests: { done: 4, total: 20 }, build: null });
    expect(gateNodesOf(49, jobs, cfg.gate, cfg.names)).toEqual({ tests: 'studio + teitou', build: 'studio' });
    expect(rerunOf(47, jobs, cfg.gate, cfg.names)).toBeNull();
    // Another tenant's names would match no job; a caller that leaves them out fails rather than getting the defaults.
    expect(() => rerunOf(49, jobs, cfg.gate, undefined)).toThrow();
    expect(() => gateNodesOf(49, jobs, cfg.gate, undefined)).toThrow();
  });

  it('finds each task\'s first counter in onto top\'s answer', () => {
    const top = { nodes: [{ name: 'studio', jobs: [{ task: 'audit50-a-A', progress: [{ done: 4, total: 9 }, { done: 1, total: 2 }] }, { task: 'x' }] }] };
    expect([...progressOfTop(top)]).toEqual([['audit50-a-A', { done: 4, total: 9 }]]);
  });
});

describe('buildMap', () => {
  it('marks a pinned area and queues it first', () => {
    const root = mkdtempSync(join(tmpdir(), 'skulkr-map-pins-'));
    const state = mkdtempSync(join(tmpdir(), 'skulkr-map-state-'));
    dirs.push(root, state);
    const home = process.env.HOME;
    process.env.HOME = root;
    try {
      const run = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
      run('init', '-q', '-b', 'main');
      for (const pkg of ['core', 'ui']) {
        mkdirSync(join(root, 'packages', pkg, 'src'), { recursive: true });
        writeFileSync(join(root, 'packages', pkg, 'src', 'a.ts'), 'export const a = 1;\n');
      }
      run('add', '-A');
      run('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'c');
      const cfg = weaselConfig(state);
      pin(cfg, 'ui');
      const map = buildMap(cfg, root, { jobs: () => [] });
      expect(map.areas.map((a: any) => [a.id, a.queue, a.pinned])).toEqual([['core', 2, undefined], ['ui', 1, true]]);
    } finally {
      process.env.HOME = home;
    }
  });
});

