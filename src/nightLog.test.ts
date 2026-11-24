import { describe, expect, it } from 'vitest';
import { nightLanes, nightLeftOut, nightStages, settleMerged } from './nightLog.mjs';

describe('nightStages and nightLanes from one reading', () => {
  it('counts any review line toward a stage, but marks a step done only from its whole form', () => {
    const log = 'review 1/2 a A unfinished line\nreview 2/2 a B on studio: 2 findings, 3/3 files read, 1.0 min\nverify b: passed';
    expect(Object.fromEntries(nightStages(log))).toEqual({ a: 'reviewed' });
    const [a] = nightLanes(log, ['a']);
    expect(a!.steps.A).toEqual({ state: 'waiting' });
    expect(a!.steps.B).toMatchObject({ state: 'done', findings: 2 });
  });
});

describe('nightStages', () => {
  it('takes each area to the furthest step its log lines reach', () => {
    const log = [
      'control sweep: 0 dead, 19 unsure, 1086 skipped of 2503 controls in 180 demos, 29.4 min',
      'review 1/16 apps.chart A on studio: 0 findings, 3/3 files read, 3.4 min, 0.54M tokens',
      'review 2/16 apps.chart B on studio: 1 findings, 3/3 files read, 3.5 min, 0.58M tokens',
      'review 3/16 core.core B on teitou: 5 findings, 35/35 files read, 3.8 min, 2.25M tokens',
      'match 1/8 apps.chart: 0 shared of 0 + 1',
      'fix 1/8 apps.chart on studio: 1 commits, 8.0 min, 0.79M tokens',
      'patch apps.chart: 1 commits on audit40-apps.chart',
      'review 4/16 core.canvas.part1 A on studio: 3 findings, 47/47 files read, 5.5 min, 5.79M tokens',
      'review 5/16 core.canvas.part1 B on studio: 3 findings, 47/47 files read, 13.7 min, 9.96M tokens',
      'patch core.canvas.part1: 6 commits on audit40-core.canvas.part1',
      'batch: audit40-core.canvas.part1 left out: merge conflict in a.ts',
      'batch: audit38-apps.chart (round 38) left out: merge conflict in b.ts',
    ].join('\n');
    expect(Object.fromEntries(nightStages(log))).toEqual({
      'apps.chart': 'patched',
      'core.core': 'reviewing',
      'core.canvas.part1': 'conflict',
    });
  });

  it("reads an old night log's conflict line", () => {
    expect(Object.fromEntries(nightStages('batch: audit40-core.canvas.part1 conflicts; left out'))).toEqual({ 'core.canvas.part1': 'conflict' });
  });
});

describe('nightLeftOut', () => {
  it('lists each branch the batch left out, with its round and why, old lines too', () => {
    const log = [
      'batch: audit40-a left out: merge conflict in a.ts, b.ts',
      'batch: audit38-b (round 38) left out: merge failed: fatal: bad',
      'batch: audit38-c, left out of round 38, merged',
      'batch: audit40-d conflicts; left out',
    ].join('\n');
    expect(nightLeftOut(log, 40)).toEqual([
      { area: 'a', round: 40, why: 'merge conflict in a.ts, b.ts' },
      { area: 'b', round: 38, why: 'merge failed: fatal: bad' },
      { area: 'd', round: 40, why: 'merge conflict' },
    ]);
  });
});

describe('settleMerged', () => {
  const log = ['patch a: 2 commits on audit80-a', 'patch b: 1 commits on audit80-b', 'batch: audit80-a left out: merge conflict in a.ts', 'batch: audit79-c (round 79) left out: merge conflict in c.ts'].join('\n');
  const run = { round: 80, stages: Object.fromEntries(nightStages(log)), leftOut: nightLeftOut(log, 80), lanes: nightLanes(log, ['a', 'b']) };

  it('takes a branch merged outside skulkr, into its batch or main, off its conflict', () => {
    const settled = settleMerged(run, (round: number, area: string) => round === 80 && area === 'a');
    expect(settled.stages).toEqual({ a: 'patched', b: 'patched' });
    expect(settled.leftOut).toEqual([{ area: 'c', round: 79, why: 'merge conflict in c.ts' }]);
    expect(settled.lanes[0]!.steps.patch).toEqual({ state: 'done', commits: 2, resolved: 'merged outside skulkr' });
    expect(settleMerged(run, () => true).leftOut).toEqual([]);
  });

  it('leaves a run whose conflicted branches are not merged as it was', () => {
    expect(settleMerged(run, () => false)).toBe(run);
  });
});

describe('nightLanes', () => {
  it('counts a match done, nothing shared, when one reviewer found nothing', () => {
    const log = 'review 1/4 p A on studio: 1 findings, 12/12 files read, 3.0 min\nreview 2/4 p B on teitou: 0 findings, 12/12 files read, 5.3 min';
    expect(nightLanes(log, ['p'])[0]!.steps.match).toMatchObject({ state: 'done', shared: 0, a: 1, b: 0 });
  });

  it('gives a done fix its report\'s tally, and leaves one with no tally as it was', () => {
    const log = 'fix 1/2 a on studio: 5 commits, 8.0 min, 0.5M weighted tokens\nfix 2/2 b on studio: 2 commits, 3.0 min, 0.2M weighted tokens';
    const lanes = nightLanes(log, ['a', 'b'], [], new Map([['a', 'tally: 3 of 4 fixed, 1 extra fixed'], ['b', 'A note about a watcher; nothing was lost.']]));
    expect(lanes.find((l) => l.id === 'a')!.steps.fix).toMatchObject({ commits: 5, fixed: 3, of: 4, extra: 1 });
    expect(lanes.find((l) => l.id === 'b')!.steps.fix).not.toHaveProperty('fixed');
  });

  it("fills each area's thread from the log, and marks a step running from onto's running tasks", () => {
    const log = [
      'review 1/4 core.core.ops A on studio: 5 findings, 24/24 files read, 2.8 min, 1.30M tokens',
      'review 2/4 core.core.ops B on teitou: 2 findings, 24/24 files read, 2.9 min, 1.66M tokens',
      'match 1/2 core.core.ops: 2 shared of 5 + 2',
    ].join('\n');
    const running = [{ task: 'audit41-core.core.ops-fix', node: 'studio', started: '2026-11-19T21:00:00Z' }, { task: 'audit41-core.debug-A', node: 'teitou', started: '2026-11-19T21:01:00Z' }];
    const [ops, debug] = nightLanes(log, ['core.core.ops', 'core.debug'], running);
    expect(ops.steps.A).toEqual({ state: 'done', node: 'studio', findings: 5, read: 24, files: 24, minutes: 2.8 });
    expect(ops.steps.match).toEqual({ state: 'done', shared: 2, a: 5, b: 2 });
    expect(ops.steps.fix).toEqual({ state: 'running', node: 'studio', since: '2026-11-19T21:00:00Z' });
    expect(ops.steps.patch.state).toBe('waiting');
    expect(debug.steps.A.state).toBe('running');
    expect(debug.steps.B.state).toBe('waiting');
  });

  it("gives a running fixer's step its commits, checks, tests and latest note", () => {
    const now = { text: 'running: npx vitest run a.test.ts', at: '2026-11-19T21:20:00Z' };
    const checks = { done: 6, total: 7, failed: 2 };
    const running = [{ task: 'audit41-a-fix', node: 'local', started: '2026-11-19T21:00:00Z', progress: { done: 10, total: 10, checks, now } }];
    expect(nightLanes('match 1/1 a: 0 shared of 1 + 1', ['a'], running)[0]!.steps.fix)
      .toEqual({ state: 'running', node: 'local', since: '2026-11-19T21:00:00Z', done: 10, total: 10, checks, now });
  });

  it("times a done step from onto's finished job nearest its logged minutes, ending when that job did", () => {
    const log = 'review 1/2 core.core.ops A on studio: 5 findings, 24/24 files read, 3.0 min, 1.30M tokens';
    const jobs = [
      { task: 'audit41-core.core.ops-A', node: 'studio', started: '2026-11-19T21:00:00Z', finished: '2026-11-19T21:00:04Z' },
      { task: 'audit41-core.core.ops-A', node: 'studio', started: '2026-11-19T20:50:00Z', finished: '2026-11-19T20:53:10Z' },
    ];
    const [ops] = nightLanes(log, ['core.core.ops'], jobs);
    expect(ops.steps.A).toMatchObject({ state: 'done', minutes: 3, started: '2026-11-19T20:50:10.000Z', ended: '2026-11-19T20:53:10.000Z' });
    expect(ops.steps.B).toEqual({ state: 'waiting' });
  });

  it("fails the patch of a branch the batch left out, saying why, but not for an earlier round's retried branch", () => {
    const log = 'batch: audit40-a left out: merge conflict in a.ts\nbatch: audit38-b (round 38) left out: merge conflict in b.ts';
    const [a, b] = nightLanes(log, ['a', 'b']);
    expect(a!.steps.patch).toEqual({ state: 'failed', why: 'merge conflict in a.ts; left out of the batch' });
    expect(b!.steps.patch).toEqual({ state: 'waiting' });
  });

  it('takes a branch a conflict repair merged off its conflict, its patch done and saying how', () => {
    const left = ['patch a: 2 commits on audit40-a', 'batch: audit40-a left out: merge conflict in a.ts; its conflict repair failed'];
    const log = [...left, 'repair a conflict on studio: 1 commits, 4.0 min; verify passed', 'batch: audit40-a merged after a conflict repair of a.ts'].join('\n');
    const [a] = nightLanes(log, ['a']);
    expect(a!.steps.patch).toEqual({ state: 'done', commits: 2, resolved: 'merged after a conflict repair' });
    expect(a!.steps.repair).toMatchObject({ state: 'done', attempts: 1, outcome: 'passed' });
    expect(nightStages(log).get('a')).toBe('patched');
    expect(nightLeftOut(log, 40)).toEqual([]);
    expect(nightLeftOut(left.join('\n'), 40)).toEqual([{ area: 'a', round: 40, why: 'merge conflict in a.ts; its conflict repair failed' }]);
    const failed = [...left, 'repair a conflict on studio: 1 commits, 4.0 min; verify failed: exited 1'].join('\n');
    expect(nightLanes(failed, ['a'])[0]!.steps.repair).toMatchObject({ state: 'failed', why: 'conflict repair failed its verify' });
  });

  it("fails a patch that did not apply", () => {
    const [ops] = nightLanes('patch core.core.ops: did not apply: conflict in a.ts', ['core.core.ops']);
    expect(ops.steps.patch).toEqual({ state: 'failed', why: 'did not apply' });
  });
});

describe('nightLanes repair step', () => {
  const fix = 'fix 1/1 a on studio: 2 commits, 8.0 min, 0.5M weighted tokens';

  it('is absent until skulkr checks the fix, then done once its verify passes', () => {
    expect(nightLanes(fix, ['a'])[0]!.steps).not.toHaveProperty('repair');
    expect(nightLanes(`${fix}\nverify a: passed (3 test files)`, ['a'])[0]!.steps.repair).toEqual({ state: 'done', attempts: 0, outcome: 'passed' });
  });

  it('counts repairs, runs while a failing verdict waits on one, and fails once the area is left out', () => {
    const log = [fix, 'verify a: failed: 1 of 3 test files failed (a/x.test.ts)', 'repair a 1/2 on teitou: 1 commits, 4.0 min; verify failed: exited 1'];
    const running = [{ task: 'audit9-a-repair', node: 'studio', started: '2026-11-20T23:00:00Z' }];
    expect(nightLanes(log.join('\n'), ['a'], running)[0]!.steps.repair).toMatchObject({ state: 'running', attempts: 1, node: 'studio', since: '2026-11-20T23:00:00Z' });
    const left = [...log, 'repair a 2/2 on studio: 0 commits, 3.5 min; verify failed: exited 1', 'verify a: still failing after 2 repairs; left out of the batch', 'patch a: left out: verify still failing after 2 repairs (exited 1)'];
    const [lane] = nightLanes(left.join('\n'), ['a']);
    expect(lane!.steps.repair).toMatchObject({ state: 'failed', attempts: 2, minutes: 7.5, why: 'still failing after 2 repairs' });
    expect(lane!.steps.patch).toEqual({ state: 'failed', why: 'verify still failing after 2 repairs (exited 1)' });
  });

  it('shows a GUI verify job running before any verdict', () => {
    const running = [{ task: 'audit9-a-verify', node: 'msb-uai', started: '2026-11-20T23:00:00Z' }];
    expect(nightLanes(fix, ['a'], running)[0]!.steps.repair).toEqual({ state: 'running', node: 'msb-uai', since: '2026-11-20T23:00:00Z', job: 'verify' });
  });

  it("counts a numbered repair once, though a resumed round logs its reused line again", () => {
    const line = 'repair a 1/2 on local: 1 commits, 22.0 min; verify passed';
    const log = [fix, 'verify a: failed: 1 of 9 test files failed (x.test.ts)', line, 'verify a: failed: 1 of 9 test files failed (x.test.ts)', line.replace('local: 1 commits, 22.0', 'earlier: 1 commits, 0.0')];
    expect(nightLanes(log.join('\n'), ['a'])[0]!.steps.repair).toMatchObject({ state: 'done', attempts: 1 });
  });

  it('counts a capstone repair as one more attempt', () => {
    const log = [fix, 'verify a: passed (3 test files)', 'repair a capstone on studio: 1 commits, 5.0 min; verify passed'];
    expect(nightLanes(log.join('\n'), ['a'])[0]!.steps.repair).toMatchObject({ state: 'done', attempts: 1, outcome: 'passed' });
  });

  it('runs again once the capstone lays a gate failure at a lane its verify had passed', () => {
    const patched = [fix, 'verify a: passed (3 test files)', 'patch a: 2 commits on audit9-a', 'patch b.c: 1 commits on audit9-b.c'];
    const laid = [...patched, 'capstone: 2 failures; a 1, b.c 1; 1 unattributed'];
    const running = [{ task: 'audit9-a-repair', node: 'msb-uai', started: '2026-11-23T22:49:00Z' }];
    const lanes = nightLanes(laid.join('\n'), ['a', 'b.c'], running);
    expect(lanes[0]!.steps.repair).toMatchObject({ state: 'running', node: 'msb-uai', since: '2026-11-23T22:49:00Z' });
    expect(lanes[1]!.steps.repair).toMatchObject({ state: 'running' });
    expect(nightLanes([...patched, 'capstone: 1 failures; none laid at a branch; 1 unattributed'].join('\n'), ['a'])[0]!.steps.repair).toMatchObject({ state: 'done' });
    const after = [...laid, 'repair a capstone on msb-uai: 1 commits, 6.0 min; verify passed', 'repair b.c capstone on studio: 0 commits, 3.0 min; verify failed: exited 1'];
    const [a, bc] = nightLanes(after.join('\n'), ['a', 'b.c']);
    expect(a!.steps.repair).toMatchObject({ state: 'done', attempts: 1, outcome: 'passed' });
    expect(bc!.steps.repair).toMatchObject({ state: 'failed', why: 'capstone repair failed its verify' });
  });

  it('fails a capstone repair that did not start, crashed, or did not apply', () => {
    const laid = 'capstone: 3 failures; a 1, b 1, c 1';
    const log = [laid, 'repair a capstone: not started, over the $40 cap', 'repair b capstone failed: Error: boom', 'repair c capstone on studio: 1 commits, 2.0 min; verify passed', 'patch c: the capstone repair did not apply: conflict'];
    const whys = nightLanes(log.join('\n'), ['a', 'b', 'c']).map((l) => l.steps.repair?.why);
    expect(whys).toEqual(['capstone repair not started: over the $40 cap', 'capstone repair crashed', 'capstone repair did not apply']);
  });
});
