import { describe, expect, it } from 'vitest';
import { changedSincePass, correctionShows, fixedIn, foundIn, heatScaleOverRounds, defectsVersionOf, heatScaleOf, labelIn, lastPassOf, nextUpOf, runHolding, statsFor, toneOf, wrapAtDots } from './areaData';
import { continuousText, headlineOf, logTailsOf, parseJob, recentJobsOf, scrolledOf, spendOf, stepText } from './runData';
import { stageCountsOf } from './phases';
import { inSharedSteps, leadsWithNode, sharedSpansOf } from './sharedLane';
import { ticksFor } from './RoundsChart';
import { layoutMap, squarify } from './mapLayout';
import { areaTree, leavesOf, type AreaTreeNode } from './areaTree';
import fixture from './fixture.map.json';
import type { SkulkrMap } from './skulkrMap.types';

const map = fixture as unknown as SkulkrMap;
const [live, finished] = map.runs as [SkulkrMap['runs'][0], SkulkrMap['runs'][0]];
const now = Date.parse(map.generated);

describe('lanes', () => {
  it('says what each step of an area has done, or how long it has been running', () => {
    const ops = live.lanes[0]!;
    expect(stepText('A', ops.steps.A, now)).toBe('5 found · 2.8 min');
    expect(stepText('match', ops.steps.match, now)).toBe('2 shared, 3 unique');
    expect(stepText('fix', ops.steps.fix, now)).toBe('studio · 12 min');
    expect(stepText('patch', ops.steps.patch, now)).toBe('after fix');
    expect(stepText('B', live.lanes[1]!.steps.B, now)).toBe('studio · <1 min');
    expect(stepText('fix', { state: 'done', commits: 1, minutes: 7.6 }, now)).toBe('1 commit · 7.6 min');
    expect(stepText('patch', { state: 'failed', why: 'conflicts; left out of the batch' }, now)).toBe('conflicts; left out of the batch');
  });

  it('draws the gate runs the map names, one stripe each under the batch', () => {
    const one = { ...live, step: 'fleet', gateRuns: [{ id: 'suite', label: 'npm test' }], fleet: { suite: { done: 1, total: 2 } } } as const;
    expect(sharedSpansOf(one).map((s) => [s.id, s.label, s.trackSpan ?? 1])).toEqual([['batch', 'batch', 1], ['fleet-suite', 'npm test · 50%', 1]]);
  });

  it('runs the shared lane through batch and both fleet runs side by side, each fleet run filled by its count', () => {
    const states = (run: typeof live) => sharedSpansOf(run).map((s) => [s.id, s.state, s.fill]);
    expect(inSharedSteps(live)).toBe(false);
    expect(states({ ...live, step: 'batch' })).toEqual([['batch', 'active', 0], ['fleet-tests', 'pending', 0], ['fleet-build', 'pending', 0]]);
    const running = sharedSpansOf({ ...live, step: 'fleet', fleet: { tests: { done: 250, total: 1000 }, build: { done: 30, total: 40 } } });
    expect(running.map((s) => [s.id, s.state, s.fill, s.track ?? 0, s.trackSpan ?? 1])).toEqual([
      ['batch', 'done', 1, 0, 2], ['fleet-tests', 'active', 0.25, 0, 1], ['fleet-build', 'active', 0.75, 1, 1],
    ]);
    expect(running.map((s) => s.label)).toEqual(['batch', 'fleet tests · 25%', 'postbuild · 75%']);
    // The node running each, where known, leads its label, and only that part pulses.
    const placed = { ...live, step: 'fleet', fleet: { tests: { done: 1, total: 4 }, build: null }, gateNodes: { tests: 'studio', build: null } } as const;
    const spans = sharedSpansOf(placed);
    expect(spans.map((s) => s.label)).toEqual(['batch', 'studio · fleet tests · 25%', 'postbuild']);
    expect(spans.map((s) => leadsWithNode(s, placed))).toEqual([true, true, false]);
    // Waiting for the merge lock or the fleet is the fleet column's, not a column of its own.
    for (const step of ['merge-wait', 'fleet-wait']) {
      const waits = sharedSpansOf({ ...live, step });
      expect(waits.map((s) => [s.id, s.state])).toEqual([['batch', 'done'], ['fleet-tests', 'pending'], ['fleet-build', 'pending']]);
      expect(waits[1]!.label).toBe('fleet tests · waiting');
    }
    expect(states(finished).every(([, state]) => state === 'done')).toBe(true);
    // A red round says which of its fleet runs failed, and its batch running again reads as running.
    const red = { ...finished, report: 'red: batch kept', gates: { tests: 'failed', build: 'passed' } } as const;
    expect(states(red)).toEqual([['batch', 'done', 1], ['fleet-tests', 'failed', 1], ['fleet-build', 'done', 1]]);
    // A failed run says how many failed and where, the first few files in its title.
    const counted = sharedSpansOf({ ...red, failures: { tests: { count: 181, files: 44, names: ['a.test.ts', 'b.test.ts'], list: [] }, build: null } });
    expect(counted[1]!.label).toBe('fleet tests · 181 failed in 44 files');
    expect(counted[1]!.title).toBe('a.test.ts\nb.test.ts\nand 42 more');
    expect(counted[2]!.label).toBe('postbuild');
    const again = sharedSpansOf({ ...red, rerun: true, gates: { tests: 'running', build: 'passed' }, fleet: { tests: { done: 10, total: 40 }, build: null } });
    expect(again.map((s) => [s.id, s.state, s.fill])).toEqual([['batch', 'done', 1], ['fleet-tests', 'active', 0.25], ['fleet-build', 'done', 1]]);
  });

  it('counts a round\'s areas done and in each stage', () => {
    const c = stageCountsOf(live.lanes);
    expect(c.total).toBe(live.lanes.length);
    expect(c.done + c.stages.reduce((n, st) => n + st.n, 0)).toBe(c.total);
    expect(stageCountsOf([])).toEqual({ done: 0, total: 0, stages: [] });
  });

  it('heads each run with its round, step and spend', () => {
    expect(headlineOf(live)).toBe('Round 41 running · fix · 2 areas');
    expect(headlineOf(finished)).toBe('Round 40 finished · 8 areas merged');
    expect(headlineOf({ ...live, step: 'fleet-wait', behind: 'weasel round 40' })).toBe('Round 41 running · waiting for the fleet, behind weasel round 40 · 2 areas');
    expect(headlineOf({ ...live, step: 'merge-wait' })).toBe('Round 41 running · waiting to merge · 2 areas');
    expect(continuousText(undefined)).toBeNull();
    expect(continuousText({ until: '', next: 'starts now', nightUsd: 200, spentUsd: 57.4, leftUsd: 142.6 })).toBe('continuous · $143 of $200 left tonight');
    expect(spendOf(live)).toBe('$12.50 of $80');
    expect(spendOf({ ...live, capUsd: null })).toBe('$12.50');
  });
});

describe('defectsVersionOf', () => {
  it("changes when the area's passes or lane do, and not when only the map's stamp or another area does", () => {
    const v = defectsVersionOf(map, 'core.ops');
    expect(defectsVersionOf({ ...map, generated: '2030-01-01T00:00:00Z' } as SkulkrMap, 'core.ops')).toBe(v);
    const other = { ...live, lanes: live.lanes.map((l) => (l.id === 'core.ops' ? l : { ...l, steps: { ...l.steps, B: { state: 'done' as const } } })) };
    expect(defectsVersionOf({ ...map, runs: [other, finished] }, 'core.ops')).toBe(v);
    const ops = live.lanes[0]!;
    const fixed = { ...live, lanes: [{ ...ops, steps: { ...ops.steps, fix: { state: 'done' as const, commits: 2 } } }] };
    expect(defectsVersionOf({ ...map, runs: [fixed, finished] }, 'core.ops')).not.toBe(v);
  });
});

describe('jobs', () => {
  it('reads each kind of log line, and marks a review that skipped files', () => {
    expect(parseJob('review 3/4 core.debug A on teitou: 1 findings, 9/12 files read, 1.5 min, 0.40M tokens')).toEqual({
      kind: 'review', label: 'review A', area: 'core.debug', what: '1 finding, read 9 of 12 files',
      node: 'teitou', minutes: 1.5, tokens: 0.4, of: '3/4', bad: true,
    });
    expect(parseJob('fix 2/4 core.ops on studio: 3 commits, 12.0 min, 0.81M weighted tokens')).toMatchObject({ kind: 'fix', tokens: 0.81 });
    expect(parseJob('match 1/4 core.ops: 2 shared of 5 + 4')).toMatchObject({ kind: 'match', what: '2 shared, 5 unique' });
    expect(parseJob('fleet: 2 failed')).toMatchObject({ kind: 'fleet', bad: true });
    expect(parseJob('something else')).toBeNull();
  });

  it("reads skulkr's verify of a fix and each repair, a failing one as bad", () => {
    expect(parseJob('verify core.ops: failed: 1 of 3 test files failed (a/store.pbt.test.ts)')).toMatchObject({ kind: 'fix', label: 'verify', area: 'core.ops', bad: true });
    expect(parseJob('verify core.ops: passed (3 test files)')).toMatchObject({ label: 'verify', bad: false });
    expect(parseJob('repair core.ops 1/2 on studio: 1 commits, 4.0 min; verify passed')).toEqual({
      kind: 'fix', label: 'repair 1/2', area: 'core.ops', what: '1 commit; verify passed', node: 'studio', minutes: 4, bad: false,
    });
    expect(parseJob('patch core.ops: left out: verify still failing after 2 repairs (exited 1)')).toMatchObject({ kind: 'patch', bad: true });
    expect(stepText('repair', { state: 'done', attempts: 1, outcome: 'passed' }, 0)).toBe('1 repair · passed');
  });

  it('reads a patch that did not apply as a bad patch job', () => {
    expect(parseJob('patch core.ops: did not apply: error: patch failed: a.ts:3')).toEqual({
      kind: 'patch', label: 'patch', area: 'core.ops', what: 'did not apply: error: patch failed: a.ts:3', bad: true,
    });
    expect(parseJob('patch core.ops: 2 commits on audit41-core.ops')).toMatchObject({ kind: 'patch', bad: false });
  });

  it('reads a sweep that came back, and not the plan announcing one', () => {
    expect(parseJob('control sweep: 2 dead, 1 unsure, 0 skipped of 90 controls in 12 demos, 6.5 min')).toMatchObject({
      kind: 'sweep', what: '2 dead, 1 unsure, 0 skipped of 90 controls in 12 demos, 6.5 min', bad: false,
    });
    expect(parseJob('control sweep: did not run (no gui node)')).toMatchObject({ kind: 'sweep', bad: true });
    expect(parseJob('control sweep: off (it runs only with --sweep)')).toBeNull();
    expect(parseJob('control sweep: one browser job at the frozen commit beside the reviews, and a fixer for what it finds dead')).toBeNull();
  });

  it('marks a review that did not finish, and says so and that it hit its ceiling', () => {
    const line = 'review 1/4 core.ops B on teitou: 2 findings, 12/12 files read, 9.0 min, 1.20M tokens';
    expect(parseJob(`${line}, hit its ceiling, unfinished: not counted as a pass`)).toMatchObject({
      what: '2 findings, read 12 of 12 files, hit its ceiling, unfinished: not counted as a pass', bad: true,
    });
    expect(parseJob(`${line}, hit its ceiling`)).toMatchObject({ what: '2 findings, read 12 of 12 files, hit its ceiling', bad: false });
  });

  it("reads a branch the batch left out from the map's leftOut, whatever the project names its branches", () => {
    const leftOut = [
      { area: 'core.ops', round: 41, why: 'conflicts in a.ts, b.ts' },
      { area: 'ui.p-touch', round: 6, why: 'merge failed: lock' },
      { area: 'core.debug', round: 41, why: 'merge conflict' },
    ];
    const lines = [
      'batch: a1141-core.ops left out: conflicts in a.ts, b.ts',
      'batch: sk6-ui.p-touch (round 6) left out: merge failed: lock',
      'batch: audit41-core.debug conflicts; left out',
      'batch: audit40-core.ops, left out of round 40, merged',
    ];
    const rows = recentJobsOf([{ ...live, lines, leftOut }]).reverse();
    expect(rows.map((r) => [r.round, r.job.kind, r.job.area, r.job.what, r.job.bad])).toEqual([
      [41, 'batch', 'core.ops', 'left out: conflicts in a.ts, b.ts', true],
      [6, 'batch', 'ui.p-touch', 'left out: merge failed: lock', true],
      [41, 'batch', 'core.debug', 'left out: merge conflict', true],
      [41, 'night', '', 'audit40-core.ops, left out of round 40, merged', false],
    ]);
    // A map from before leftOut reads the line as any other batch line.
    expect(recentJobsOf([{ ...live, lines: lines.slice(0, 1) }])[0]!.job).toMatchObject({ kind: 'night', label: 'batch', bad: false });
  });

  it('gives a branch an earlier round left out its own round, from the map', () => {
    const lines = ['batch: audit39-ui.badge (round 39) left out: merge failed: lock'];
    const run = { ...live, lines, leftOut: [{ area: 'ui.badge', round: 39, why: 'merge failed: lock' }] };
    expect(recentJobsOf([run]).map((j) => [j.round, j.job.area])).toEqual([[39, 'ui.badge']]);
  });

  it('keys two identical lines of one log apart', () => {
    const run = { ...map.runs[0]!, lines: ['fleet: test:batch passed', 'fleet: test:batch passed'] };
    const keys = recentJobsOf([run]).map((j) => j.key);
    expect(new Set(keys).size).toBe(2);
  });

  it('keeps a job its key while its line moves up the tail, a copy of it scrolling off the front', () => {
    const dup = 'fleet: test:batch passed';
    const first = { ...map.runs[0]!, lines: [dup, 'night: x', dup] };
    const later = { ...first, lines: ['night: x', dup, 'fleet: test:build passed'] };
    expect(scrolledOf(first.lines, later.lines)).toBe(1);
    const tails = logTailsOf(new Map(), [first]);
    const before = recentJobsOf([first], 14, tails).map((j) => j.key);
    const after = recentJobsOf([later], 14, logTailsOf(tails, [later])).map((j) => j.key);
    // The newer copy of `dup` keeps its key; only the new line is new.
    expect(after.filter((k) => !before.includes(k))).toEqual([after[0]]);
    expect(after[0]).toContain('test:build');
  });

  it('lists every run, each newest first', () => {
    const jobs = recentJobsOf(map.runs);
    expect(jobs.map((j) => [j.round, j.job.label, j.job.area])).toEqual([
      [41, 'match', 'core.ops'],
      [41, 'review A', 'core.debug'],
      [41, 'review B', 'core.ops'],
      [41, 'review A', 'core.ops'],
      [41, 'night', ''],
      [40, 'fix', 'ui.badge'],
    ]);
  });
});

describe('areas', () => {
  it('shades by estimated defects left, settled and never-audited apart', () => {
    expect(map.areas.map(toneOf)).toEqual([{ left: 1.7 }, 'unaudited', { left: 10 }, 'settled', 'unaudited', { left: 1 }]);
  });

  it('puts defects left on a heat scale whose top is the 98th percentile, at least 8, ticked evenly along it', () => {
    const heat = heatScaleOf(map.areas);
    expect(heat.top).toBeCloseTo(9.668);
    expect(heat.at(0)).toBe(0);
    expect(heat.at(heat.top)).toBe(1);
    expect(heat.at(40)).toBe(1);
    expect(heat.at(1.7)).toBeCloseTo(Math.log1p(1.7) / Math.log1p(9.668));
    const ticks = heat.ticks.map((t) => t.value);
    expect(ticks.slice(0, -1)).toEqual([0, 1, 2, 5]);
    expect(heat.ticks.at(-1)).toMatchObject({ label: 'top', value: expect.closeTo(9.668, 2) });
    const gaps = ticks.slice(1).map((t, i) => heat.at(t) - heat.at(ticks[i]!));
    // Whole-number ticks trade a little evenness: 0, 1, 2, 5 over 0, 0.8, 2.5, 5.
    expect(Math.max(...gaps) / Math.min(...gaps)).toBeLessThan(1.8);
    expect(heatScaleOf([]).top).toBe(8);
  });

  it('sums the headline stats', () => {
    expect(statsFor(map.areas)).toEqual([
      { value: '4 / 6', label: 'areas audited at least once' },
      { value: '80%', label: 'of 150 source files charted' },
      { value: '23', label: 'defects found and fixed, all rounds' },
      { value: '≈13', label: 'estimated still in audited areas' },
      { value: '1', label: 'areas settled' },
    ]);
  });

  it('gives the corrected total beside the raw one once the map carries corrected figures', () => {
    const corrected = map.areas.map((a) => ({ ...a, passes: a.passes.map((p) => ({ ...p, leftCorrected: p.left * 4 })) }));
    expect(statsFor(corrected)[3]).toEqual({ value: '≈13', label: 'estimated still in audited areas (≈51 corrected)' });
  });

  it('says how much of what is left rests on areas changed since their pass, and counts a shared pass once', () => {
    const due = map.areas.find((a) => a.status === 'due' && a.passes.length)!;
    const stale = map.areas.map((a) => (a.id === due.id ? { ...a, staleLines: 120 } : a));
    expect(statsFor(stale)[3]!.label).toBe(`estimated still in audited areas, ≈${Math.round(due.passes.at(-1)!.left)} of it in areas changed since`);
    const half = { ...due, passes: [{ ...due.passes[0]!, distinct: 4, share: 0.5 }] };
    const split = [half, { ...half, id: 'other' }];
    expect(statsFor(split)[2]!.value).toBe('4');
    // An area holding too little of the passes it inherited is still unaudited.
    expect(toneOf({ ...due, status: 'unaudited' })).toBe('unaudited');
  });

  it("reads an area's estimate from the map's last pass where it has one, and from its passes where it does not", () => {
    const due = map.areas.find((a) => a.status === 'due' && a.passes.length)!;
    const covering = { ...due.passes.at(-1)!, round: 50, left: 20, leftCorrected: 40 };
    const boundary = { ...due.passes.at(-1)!, round: 55, left: 0.1, leftCorrected: 0.2, share: 0.033 };
    const area = { ...due, passes: [covering, boundary], last: covering };
    expect(lastPassOf(area)).toBe(covering);
    expect(toneOf(area)).toEqual({ left: 20 });
    expect(statsFor([area])[3]).toEqual({ value: '≈20', label: 'estimated still in audited areas (≈40 corrected)' });
    expect(heatScaleOf([area]).top).toBe(20);
    expect(lastPassOf({ ...area, last: null })).toBeNull();
    const { last: _, ...kept } = area;
    expect(lastPassOf(kept)?.round).toBe(55);
  });

  it('marks an area changed once any of its lines changed since its pass, however many', () => {
    expect(changedSincePass({})).toBe(false);
    expect(changedSincePass({ staleLines: 0 })).toBe(false);
    expect(changedSincePass({ staleLines: 1 })).toBe(true);
    expect(changedSincePass({ staleLines: 1e9 })).toBe(true);
  });

  it('queues by place, leaving out areas a live run holds', () => {
    expect(nextUpOf(map.areas).map((a) => a.id)).toEqual(['ui.menu', 'core.scene', 'geom']);
    expect(runHolding(map.runs, 'core.ops')?.round).toBe(41);
    expect(runHolding(map.runs, 'ui.badge')).toBeUndefined();
  });

  it('ticks the rounds axis on round steps', () => {
    expect(ticksFor(74)).toEqual([0, 20, 40, 60, 80]);
    expect(ticksFor(0)).toEqual([0]);
    expect(ticksFor(1.7)).toEqual([0, 0.5, 1, 1.5, 2]);
  });
});

describe('treemap', () => {
  it('gives each item an area in proportion to its value, inside the box', () => {
    const box = { x: 0, y: 0, width: 600, height: 400 };
    const out = squarify([6, 6, 4, 3, 2, 2, 1].map((value, i) => ({ item: i, value })), box);
    const total = 24;
    for (const r of out) {
      expect(r.width * r.height).toBeCloseTo((box.width * box.height * [6, 6, 4, 3, 2, 2, 1][r.item]!) / total, 6);
      expect(r.x).toBeGreaterThanOrEqual(-1e-9);
      expect(r.x + r.width).toBeLessThanOrEqual(box.width + 1e-9);
      expect(r.y + r.height).toBeLessThanOrEqual(box.height + 1e-9);
    }
    expect(squarify([{ item: 'a', value: 0 }], box)).toEqual([{ item: 'a', x: 0, y: 0, width: 0, height: 0 }]);
  });

  it('frames the areas that share a path and puts each one inside its frame', () => {
    const { frames, cells } = layoutMap(map.areas, 800, 400);
    expect(frames.map((f) => [f.name, f.files, f.parent])).toEqual([['core', 76, null], ['ui', 48, null]]);
    expect(cells.find((c) => c.id === 'geom')?.parent).toBeNull();
    for (const c of cells.filter((cell) => cell.parent !== null)) {
      const f = frames.find((fr) => fr.name === c.parent)!;
      expect(c.x).toBeGreaterThanOrEqual(f.x);
      expect(c.y).toBeGreaterThanOrEqual(f.y);
      expect(c.x + c.width).toBeLessThanOrEqual(f.x + f.width);
      expect(c.y + c.height).toBeLessThanOrEqual(f.y + f.height);
    }
    expect(cells).toHaveLength(map.areas.length);
  });

  it('nests a frame inside its parent, a step deeper', () => {
    const areas = ['core.domains', 'core.domains.paths', 'core.domains.snap', 'core.ops', 'geom'].map((id) => ({ id, files: 10 }));
    const { frames, cells } = layoutMap(areas, 800, 400);
    expect(frames.map((f) => [f.name, f.parent, f.depth])).toEqual([['core', null, 0], ['core.domains', 'core', 1]]);
    expect(cells.map((c) => [c.id, c.parent]).sort()).toEqual([
      ['core.domains', 'core.domains'], ['core.domains.paths', 'core.domains'], ['core.domains.snap', 'core.domains'], ['core.ops', 'core'], ['geom', null],
    ]);
  });
});

describe('areaTree', () => {
  const tree = (ids: string[]) => areaTree(ids.map((id) => ({ id, files: 1 })));
  const shape = (nodes: readonly AreaTreeNode[]): unknown[] =>
    nodes.map((n) => (n.kind === 'area' ? n.id : { [n.name]: shape(n.children) }));

  it('makes a frame of every shared prefix, an area that is also a prefix one cell beside its siblings', () => {
    expect(shape(tree(['apps.site', 'apps.draw.src', 'apps.draw.src.dev', 'devtools', 'devtools.page', 'devtools.views']))).toEqual([
      { apps: ['apps.site', { 'apps.draw.src': ['apps.draw.src', 'apps.draw.src.dev'] }] },
      { devtools: ['devtools', 'devtools.page', 'devtools.views'] },
    ]);
  });

  it('collapses a frame with one child into that child, ending at the area itself', () => {
    expect(shape(tree(['apps.draw.src.dev.audits', 'core.interactions.actions.part1', 'core.interactions.actions.part2']))).toEqual([
      'apps.draw.src.dev.audits',
      { 'core.interactions.actions': ['core.interactions.actions.part1', 'core.interactions.actions.part2'] },
    ]);
  });

  it('gives every area exactly one leaf, and no frame holds only one', () => {
    const ids = [...map.areas.map((a) => a.id), 'core.domains', 'core.domains.paths', 'devtools', 'devtools.page', 'cursor'];
    const nodes = tree(ids);
    expect(leavesOf(nodes).sort()).toEqual([...ids].sort());
    const frames = (ns: readonly AreaTreeNode[]): AreaTreeNode[] => ns.flatMap((n) => (n.kind === 'frame' ? [n, ...frames(n.children)] : []));
    for (const f of frames(nodes)) expect(f.kind === 'frame' && f.children.length).toBeGreaterThan(1);
  });
});

describe('labelIn', () => {
  it("shows only what the frame's path does not", () => {
    expect(labelIn('apps.draw.src.dev', 'apps.draw.src')).toBe('dev');
    expect(labelIn('apps.draw.src', 'apps')).toBe('draw.src');
    expect(labelIn('devtools', 'devtools')).toBe('devtools');
    expect(labelIn('apps.draw.src.dev.audits', null)).toBe('apps.draw.src.dev.audits');
  });
});

describe('wrapAtDots', () => {
  it('breaks an id after its dots, as many pieces to a line as fit', () => {
    expect(wrapAtDots('core.domains.paths', 20, 3)).toEqual(['core.domains.paths']);
    expect(wrapAtDots('core.domains.paths', 13, 3)).toEqual(['core.domains.', 'paths']);
    expect(wrapAtDots('core.domains.paths', 8, 3)).toEqual(['core.', 'domains.', 'paths']);
  });

  it('cuts the last line it has room for, and a piece too long for any line', () => {
    expect(wrapAtDots('core.domains.paths', 8, 2)).toEqual(['core.', 'domains…']);
    expect(wrapAtDots('interactions.x', 6, 3)).toEqual(['inter…', 'x']);
    expect(wrapAtDots('core', 0, 3)).toEqual([]);
  });
});

describe('correctionShows', () => {
  it('shows a corrected figure only a whole defect and a tenth away from the raw one', () => {
    expect(correctionShows(0.2, 0.2)).toBe(false);
    expect(correctionShows(13, 13.9)).toBe(false);
    expect(correctionShows(13, 14.4)).toBe(true);
    expect(correctionShows(7.5, 17.4)).toBe(true);
    expect(correctionShows(40, 43)).toBe(false);
    expect(correctionShows(5, undefined)).toBe(false);
  });
});

describe('heatScaleOverRounds', () => {
  it('sets one top over now and every past round, so a past round with more left does not overflow it', () => {
    const area = (id: string, left: number, past: number[]) => ({
      id, group: 'g', files: 1, status: 'due' as const, queue: null, stage: null, passes: [], last: { round: 9, left },
      lastByRound: past.map((l, i) => ({ round: i + 1, left: l })),
    });
    const areas = [area('a', 1, [40, 30]), area('b', 2, [35]), area('c', 1, [])];
    expect(heatScaleOf(areas).top).toBeLessThan(10);
    expect(heatScaleOverRounds(areas).top).toBeGreaterThan(30);
  });
});

describe('foundIn and fixedIn', () => {
  const pass = (round: number, distinct: number, more: { fixed?: number; share?: number } = {}) =>
    ({ round, date: '', a: 0, b: 0, shared: 0, distinct, est: 0, left: 0, ...more });
  const area = (passes: ReturnType<typeof pass>[]) =>
    ({ id: 'a', group: 'g', files: 1, status: 'due' as const, queue: null, stage: null, passes });

  it('sums every pass, an inherited pass by its share', () => {
    expect(foundIn(area([pass(1, 6), pass(2, 4, { share: 0.5 })]))).toBe(8);
    expect(foundIn(area([]))).toBe(0);
  });

  it('sums the fixes passes reported, and says how many reported', () => {
    expect(fixedIn(area([pass(1, 6), pass(2, 4, { fixed: 4, share: 0.5 }), pass(3, 3, { fixed: 3 })]))).toEqual({ fixed: 5, reported: 2 });
    expect(fixedIn(area([pass(1, 6)]))).toBeNull();
  });
});
