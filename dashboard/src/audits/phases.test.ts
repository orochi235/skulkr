import { describe, expect, it } from 'vitest';
import { CLOCK_AHEAD_MINUTES, laneViewOf, runClockOf } from './clockLane';
import { TYPICAL_MINUTES, agentsRunningIn, isFinished, passDone, phaseColor, phaseOf, phasesOf, stageCountsOf, withLivePasses } from './phases';
import { STEP_COLUMN_COUNT, laneStepsOf } from './stepsLane';
import fixture from './fixture.map.json';
import type { AuditLane, AuditRun, LaneStep, LaneStepName, SkulkrMap } from './skulkrMap.types';

const map = fixture as unknown as SkulkrMap;
const MIN = 60_000;
const START = Date.parse('2026-11-19T21:00:00.000Z');
const NOW = Date.parse('2026-11-19T21:30:00.000Z');
const at = (minutes: number) => new Date(START + minutes * MIN).toISOString();
const W: LaneStep = { state: 'waiting' };

const lane = (steps: Partial<Record<LaneStepName, LaneStep>>): AuditLane =>
  ({ id: 'x', steps: { A: W, B: W, match: W, fix: W, patch: W, ...steps } });
const done = (more: Partial<LaneStep> = {}): LaneStep => ({ state: 'done', ...more });
const running = (since: string): LaneStep => ({ state: 'running', node: 'studio', since });
const matched = (a: number, b: number, shared: number) => done({ a, b, shared });

describe('phaseOf', () => {
  it('is review while either reviewer runs or waits, the reviewers sharing one phase', () => {
    expect(phaseOf(lane({}))).toBe('review');
    expect(phaseOf(lane({ A: done(), B: running(at(29)) }))).toBe('reviewed');
    expect(phaseOf(lane({ A: running(at(29)) }))).toBe('review');
  });

  it('is the step running, or the next to run', () => {
    const found = { A: done({ findings: 2 }), B: done({ findings: 1 }) };
    expect(phaseOf(lane(found))).toBe('match');
    expect(phaseOf(lane({ ...found, match: matched(2, 1, 1), fix: running(at(10)) }))).toBe('fix');
    expect(phaseOf(lane({ ...found, match: matched(2, 1, 1), fix: done({ commits: 2 }) }))).toBe('patch');
  });

  it('is conflict once a step fails, and done once patched or matched with nothing found', () => {
    const through = { A: done({ findings: 2 }), B: done({ findings: 1 }), match: matched(2, 1, 1), fix: done({ commits: 2 }) };
    expect(phaseOf(lane({ ...through, patch: { state: 'failed', why: 'conflicts' } }))).toBe('conflict');
    expect(phaseOf(lane({ ...through, patch: done() }))).toBe('done');
    // A conflict merged later, by a conflict repair or by hand, is done like any patch.
    expect(phaseOf(lane({ ...through, patch: done({ commits: 2, resolved: 'merged outside skulkr' }) }))).toBe('done');
    expect(phaseOf(lane({ A: done({ findings: 1 }), B: done(), match: matched(1, 0, 1) }))).toBe('done');
    expect(isFinished(lane({ A: done({ findings: 1 }), B: done(), match: matched(1, 0, 0) }))).toBe(false);
    expect(isFinished(lane({ A: done({ findings: 0 }), B: done({ findings: 0 }) }))).toBe(true);
    expect(isFinished(lane({ A: done(), B: done(), match: matched(2, 1, 1), fix: done({ commits: 0 }) }))).toBe(true);
  });

  it('maps every area a live run holds, and none from a finished run', () => {
    expect([...phasesOf(map.runs)]).toEqual([['core.ops', 'fix'], ['core.debug', 'reviewed']]);
  });
});

describe('laneViewOf', () => {
  it('places each part at its real start for its real minutes, a running one up to now, and one not begun after it', () => {
    const view = laneViewOf(lane({
      A: done({ minutes: 3, findings: 5, started: at(2), ended: at(5) }), B: done({ minutes: 4, findings: 2, started: at(2), ended: at(6) }),
      match: matched(5, 2, 2), fix: running(at(18)),
    }), NOW, START);
    expect(view.phase).toBe('fix');
    expect(view.spans.map((s) => [s.id, ((s.start ?? 0) - START) / MIN, s.ms / MIN, s.state])).toEqual([
      ['A', 2, 3, 'done'], ['B', 5, 1, 'done'], ['match', 6, TYPICAL_MINUTES.match, 'done'], ['fix', 18, 12, 'active'], ['patch', 30, TYPICAL_MINUTES.patch, 'pending'],
    ]);
    expect(view.elapsed).toBe('12 min');
    expect(view.spans.map((s) => s.label)).toEqual(['A 5 found · 3.0 min', 'B 2 found · 4.0 min', '2 shared, 3 unique', 'studio · 12 min', '5 found']);
    expect(view.spans.map((s) => s.color).slice(0, 3)).toEqual([phaseColor('review'), phaseColor('reviewed'), phaseColor('match')]);
  });

  it("starts a lane with no record of when it ran at the round's start, and a part not begun no earlier than now", () => {
    const view = laneViewOf(lane({ A: done({ minutes: 3, findings: 1 }), B: done({ minutes: 5 }) }), NOW, START);
    expect(view.spans.map((s) => ((s.start ?? 0) - START) / MIN)).toEqual([0, 3, 30, 30 + TYPICAL_MINUTES.match, 30 + TYPICAL_MINUTES.match + TYPICAL_MINUTES.fix]);
    expect(view.spans.map((s) => s.fill)).toEqual([undefined, undefined, 0, 0, 0]);
  });

  it('runs B from where A ends, its typical minutes ahead while it runs, and dims it while it waits for a slot', () => {
    const both = laneViewOf(lane({ A: running(at(26)), B: running(at(27)) }), NOW, START);
    expect(both.spans.slice(0, 2).map((s) => [s.id, ((s.start ?? 0) - START) / MIN, s.ms / MIN, s.state])).toEqual([
      ['A', 26, 4, 'active'], ['B', 30, TYPICAL_MINUTES.review - 3, 'active'],
    ]);
    const waiting = laneViewOf(lane({ A: done({ minutes: 2, started: at(20), ended: at(22) }) }), NOW, START);
    expect(waiting.spans.slice(0, 2).map((s) => [s.id, ((s.start ?? 0) - START) / MIN, s.fill, s.label])).toEqual([
      ['A', 20, undefined, 'A 0 found · 2.0 min'], ['B', 30, 0, ''],
    ]);
  });

  it("leads the steps view's first segment with the area's files", () => {
    const first = (steps: Partial<Record<LaneStepName, LaneStep>>) => laneStepsOf(lane(steps), NOW, 27).find((s) => s.id === 'A')?.label;
    expect(first({})).toBe('27 files');
    expect(first({ A: done({ findings: 3, minutes: 2 }) })).toBe('27 files · 3 found · 2.0 min');
  });

  it('captions and shades the patch with the fixer\'s tally of what it fixed', () => {
    const fixed = { A: done({ findings: 3 }), B: done({ findings: 2 }), match: matched(3, 2, 1), fix: done({ minutes: 9, commits: 6, fixed: 3, of: 4, extra: 1 }) };
    const patchOf = (spans: { id: string }[]) => spans.find((s) => s.id === 'patch') as { label: string; ms: number; fill?: number } | undefined;
    expect(patchOf(laneViewOf(lane(fixed), NOW, START).spans)?.label).toBe('3 of 4 fixed +1 extra');
    expect(patchOf(laneStepsOf(lane({ ...fixed, patch: done({ commits: 6 }) }), NOW))?.label).toBe('3 of 4 fixed +1 extra');
    expect(laneViewOf(lane({ ...fixed, fix: done({ minutes: 9, commits: 6 }) }), NOW, START).spans.at(-1)?.label).toBe('4 found');
  });

  it('splits the patch into the share settled, shaded, and the share left for later, hatched dark gray', () => {
    const fixed = { A: done({ findings: 3 }), B: done({ findings: 2 }), match: matched(3, 2, 1), fix: done({ minutes: 9, commits: 6, fixed: 2, of: 4, deferred: 1 }) };
    for (const spans of [laneStepsOf(lane(fixed), NOW), laneStepsOf(lane({ ...fixed, patch: done({ commits: 6 }) }), NOW)]) {
      const [kept, filed] = spans.slice(-2);
      expect([kept!.id, kept!.ms, kept!.fill]).toEqual(['patch', 0.6 * 0.75, 1]);
      expect([filed!.id, filed!.ms, filed!.state, filed!.color, filed!.label]).toEqual(['patch-unfixed', 0.6 * 0.25, 'failed', 'var(--audit-filed)', '']);
    }
    // A finding found sound is settled, not left: no hatch where nothing was deferred.
    const sound = { ...fixed, fix: done({ minutes: 9, commits: 6, fixed: 3, of: 4, deferred: 0, dismissed: 1 }) };
    expect(laneStepsOf(lane(sound), NOW).at(-1)?.label).toBe('3 of 4 fixed · 1 FP');
    expect(laneStepsOf(lane(fixed), NOW).find((s) => s.id === 'patch')?.label).toBe('2 of 4 fixed · 1 filed');
    expect(laneStepsOf(lane(sound), NOW).map((s) => s.id)).not.toContain('patch-unfixed');
    // Settled whole, so shaded whole, in both views, before the batch applies it.
    expect(laneStepsOf(lane(sound), NOW).find((s) => s.id === 'patch')?.fill).toBe(1);
    expect(laneViewOf(lane(sound), NOW, START).spans.find((s) => s.id === 'patch')?.fill).toBe(1);
    // A tally line alone says nothing of why, so everything unfixed is left.
    const tallied = { ...fixed, fix: done({ minutes: 9, commits: 6, fixed: 3, of: 4 }) };
    expect(laneStepsOf(lane(tallied), NOW).find((s) => s.id === 'patch-unfixed')?.ms).toBeCloseTo(0.6 * 0.25);
  });

  it('counts an area\'s pass done once its fixer is, and gives the map that pass, provisionally', () => {
    const pass = { round: 47, date: '2026-11-20', a: 3, b: 2, shared: 1, distinct: 4, est: 5, left: 1 };
    const fixing = { ...lane({ match: matched(3, 2, 1), fix: { state: 'running' } }), pass };
    const fixed = { ...lane({ match: matched(3, 2, 1), fix: done({ commits: 4 }) }), pass };
    expect([passDone(fixing), passDone(fixed)]).toEqual([false, true]);
    const area = { id: 'x', group: 'x', files: 3, status: 'tonight', queue: null, passes: [], stage: null } as const;
    const run = (l: typeof fixed) => ({ ...map.runs[0]!, running: true, lanes: [l] });
    expect(withLivePasses([area], [run(fixing)])[0]!.passes).toEqual([]);
    expect(withLivePasses([area], [run(fixed)])[0]!.passes).toEqual([{ ...pass, provisional: true }]);
    expect(withLivePasses([area], [run(fixed)])[0]!.last).toEqual({ ...pass, provisional: true });
    expect(phasesOf([run(fixed)]).get('x')).toBe('done');
    // One the batch left out is a conflict on the map, as in its lane, though its pass is done.
    const leftOut = { ...lane({ match: matched(3, 2, 1), fix: done({ commits: 4 }), patch: { state: 'failed', why: 'conflicts; left out of the batch' } }), pass };
    expect(passDone(leftOut)).toBe(true);
    expect(phasesOf([run(leftOut)]).get('x')).toBe('conflict');
    // The round's counts read done as the map and "Hide complete" do: a fixed area waiting on its patch is done.
    expect(stageCountsOf([fixing, fixed, leftOut])).toMatchObject({ done: 1, total: 3 });
  });

  it('counts an area whose reviews have not started as waiting, not in review', () => {
    expect(stageCountsOf([lane({}), lane({ A: running(at(25)) })]).stages).toEqual([{ phase: 'waiting', n: 1 }, { phase: 'review', n: 1 }]);
  });

  it("counts a fixer past its last commit as checks and a running verify or repair as verify, as the steps view lights them", () => {
    const fixLane = (fix: LaneStep, repair?: LaneStep): AuditLane => ({ id: 'x', steps: { ...lane({ A: done({ findings: 1 }), B: done({ findings: 1 }), match: matched(1, 1, 0), fix }).steps, ...(repair ? { repair } : {}) } });
    const lanes = [
      fixLane({ ...running(at(6)), done: 3, total: 8 }),
      fixLane({ ...running(at(6)), done: 8, total: 8 }),
      fixLane(done({ minutes: 9, commits: 2 }), running(at(25))),
    ];
    expect(stageCountsOf(lanes).stages).toEqual([{ phase: 'fix', n: 1 }, { phase: 'checks', n: 1 }, { phase: 'repair', n: 1 }]);
  });

  it('colors a failed part as a conflict and says why', () => {
    const view = laneViewOf(lane({ A: done({ findings: 1 }), B: done({ findings: 1 }), match: matched(1, 1, 1), fix: done({ minutes: 9, commits: 2 }), patch: { state: 'failed', why: 'conflicts' } }), NOW, START);
    expect(view.phase).toBe('conflict');
    expect(view.spans.at(-1)).toMatchObject({ label: 'conflicts', state: 'failed', color: phaseColor('conflict') });
    expect(view.elapsed).toBeNull();
  });
});

describe('runClockOf', () => {
  it('runs a live round from its start to now and room ahead, and a finished one to its end', () => {
    const live = { ...map.runs[0]!, started: at(0) } as AuditRun;
    expect(runClockOf(live, NOW)).toEqual({ from: START, to: NOW + CLOCK_AHEAD_MINUTES * MIN });
    const over = { ...live, running: false, ended: at(40) } as AuditRun;
    expect(runClockOf(over, NOW)).toEqual({ from: START, to: START + 40 * MIN });
  });
});

describe('laneStepsOf', () => {
  it('gives every step one equal column, filled by its state, a running one by its share of the typical time', () => {
    const spans = laneStepsOf(lane({ A: done({ findings: 5, minutes: 3 }), B: running(at(27.5)), match: W }), NOW);
    expect(spans.map((s) => [s.id, s.ms, s.fill])).toEqual([['A', 1, 1], ['B', 1, 0.5], ['match', 1, 0], ['fix', 1, 0], ['checks', 0.5, 0], ['verify', 0.5, 0], ['repair', 0.5, 0], ['patch', 0.6, 0]]);
    // The finished review is dark gray; the rest wear their phases.
    expect(spans.filter((s) => !['checks', 'verify', 'repair'].includes(s.id)).map((s) => s.color)).toEqual(['var(--audit-stage-done)', ...['reviewed', 'match', 'fix', 'patch'].map((p) => phaseColor(p as never))]);
    expect(spans[0]!.ink).toBe('var(--audit-stage-done-ink)');
    expect(spans[1]!.label).toBe('studio · 2.5 min');
    expect(spans[2]!.label).toBe('');
  });

  it('runs A, then B, then every later step a column after, on one stripe', () => {
    const spans = laneStepsOf(lane({}), NOW);
    expect(spans.map((s) => [s.id, s.start, s.track, s.trackSpan])).toEqual([
      ['A', 0, undefined, undefined], ['B', 1, undefined, undefined], ['match', 2, undefined, undefined], ['fix', 3, undefined, undefined],
      ['checks', 4, undefined, undefined], ['verify', 4.5, undefined, undefined], ['repair', 5, undefined, undefined], ['patch', 5.5, undefined, undefined],
    ]);
    expect(STEP_COLUMN_COUNT).toBeCloseTo(6.1);
  });

  it('stops a running step short of full until it finishes', () => {
    expect(laneStepsOf(lane({ A: running(at(0)) }), NOW)[0]!.fill).toBe(0.9);
  });

  it('fills a running step by its own count where onto reports one, and says the count', () => {
    const fixing = lane({ A: done({ findings: 5 }), B: done({ findings: 3 }), match: matched(5, 3, 0), fix: { ...running(at(6)), done: 3, total: 8 } });
    const fix = laneStepsOf(fixing, NOW).find((s) => s.id === 'fix')!;
    expect(fix.fill).toBe(3 / 8);
    expect(fix.label).toMatch(/^studio · 3\/8 · \d/);
    const checking = laneStepsOf(lane({ fix: { ...running(at(6)), done: 8, total: 8 } }), NOW);
    expect(checking.find((s) => s.id === 'fix')!.fill).toBe(1);
    expect(checking.find((s) => s.id === 'checks')).toMatchObject({ state: 'active', fill: 1, label: 'studio' });
    expect(checking.find((s) => s.id === 'fix')).toMatchObject({ state: 'done' });
    expect(checking.find((s) => s.id === 'fix')!.label).toMatch(/^8\/8 · /);
    expect(laneStepsOf(fixing, NOW).find((s) => s.id === 'checks')!.state).toBe('pending');
  });
});

describe('the repair step', () => {
  const fixed = { A: done({ findings: 2 }), B: done({ findings: 1 }), match: matched(2, 1, 1), fix: done({ commits: 2, minutes: 12 }) };

  it('gives the fixer\'s checks, the verify and the repair a column each, always in place', () => {
    const ids = (repair?: LaneStep) => laneStepsOf({ id: 'x', steps: { ...lane(fixed).steps, ...(repair ? { repair } : {}) } }, NOW).map((s) => [s.id, s.start]);
    const columns = [['A', 0], ['B', 1], ['match', 2], ['fix', 3], ['checks', 4], ['verify', 4.5], ['repair', 5], ['patch', 5.5]];
    expect(ids()).toEqual(columns);
    expect(ids({ ...running(at(25)), job: 'repair' })).toEqual(columns);
  });

  it('lights the column of the job running, verify or repair, in magenta, and a failed one as a conflict', () => {
    const spans = (repair: LaneStep) => laneStepsOf({ id: 'x', steps: { ...lane(fixed).steps, repair } }, NOW);
    const verifying = spans({ ...running(at(25)), job: 'verify' });
    expect(verifying.find((s) => s.id === 'verify')).toMatchObject({ state: 'active', color: 'var(--audit-repair)' });
    expect(verifying.find((s) => s.id === 'repair')).toMatchObject({ state: 'pending', label: '' });
    const repairing = spans({ ...running(at(25)), job: 'repair', attempts: 0 });
    expect(repairing.find((s) => s.id === 'verify')).toMatchObject({ state: 'failed', color: phaseColor('conflict') });
    expect(repairing.find((s) => s.id === 'repair')!.state).toBe('active');
    expect(laneViewOf({ id: 'x', steps: { ...lane(fixed).steps, repair: running(at(25)) } }, NOW, START).spans.find((s) => s.id === 'repair')!.color).toBe('var(--audit-repair)');
  });

  it('says how its verify ended and how many repairs ran, each in its own column', () => {
    const of = (repair: LaneStep, id: string) => laneStepsOf({ id: 'x', steps: { ...lane(fixed).steps, repair } }, NOW).find((s) => s.id === id)!;
    expect(of(done({ attempts: 0, outcome: 'passed' }), 'verify').label).toBe('passed');
    expect(of(done({ attempts: 0, outcome: 'passed' }), 'repair').label).toBe('');
    expect(of(done({ attempts: 2, outcome: 'passed' }), 'repair').label).toBe('2 repairs');
    expect(of({ state: 'failed', attempts: 2, why: 'still failing after 2 repairs' }, 'repair')).toMatchObject({ label: 'still failing after 2 repairs', state: 'failed', color: phaseColor('conflict') });
  });

  it('counts the model agents running: reviewers, matchers, fixers short of their hand-back verify, and repairs', () => {
    const fixing = lane({ A: done({ findings: 1 }), B: done({ findings: 1 }), match: matched(1, 1, 0), fix: running(at(25)) });
    const handingBack = lane({ A: done({ findings: 1 }), B: done({ findings: 1 }), match: matched(1, 1, 0), fix: { ...running(at(25)), now: { text: "verifying the fixer's commits", at: at(30) } } });
    const reviewing = lane({ A: running(at(25)), B: running(at(26)) });
    const verifying: AuditLane = { id: 'x', steps: { ...lane(fixed).steps, repair: { ...running(at(25)), job: 'verify' } } };
    const repairing: AuditLane = { id: 'x', steps: { ...lane(fixed).steps, repair: { ...running(at(25)), job: 'repair' } } };
    expect(agentsRunningIn([fixing, handingBack, reviewing, verifying, repairing])).toBe(4);
  });

  it('holds the pass open while a repair runs, and takes a stretch of the clock only once the fix is checked', () => {
    const repairing: AuditLane = { id: 'x', steps: { ...lane(fixed).steps, repair: running(at(25)) } };
    expect(passDone(repairing)).toBe(false);
    expect(phaseOf(repairing)).toBe('fix');
    expect(laneViewOf(repairing, NOW, START).spans.map((s) => s.id)).toEqual(['A', 'B', 'match', 'fix', 'repair', 'patch']);
    expect(laneViewOf(lane(fixed), NOW, START).spans.map((s) => s.id)).toEqual(['A', 'B', 'match', 'fix', 'patch']);
    expect(passDone(lane(fixed))).toBe(true);
  });

  it("reopens a patched area while the capstone repairs its branch", () => {
    const capstone: AuditLane = { id: 'x', steps: { ...lane(fixed).steps, patch: done({ commits: 2 }), repair: running(at(25)) } };
    expect(isFinished(capstone)).toBe(true);
    expect([phaseOf(capstone), passDone(capstone)]).toEqual(['fix', false]);
    expect(stageCountsOf([capstone])).toMatchObject({ done: 0, stages: [{ phase: 'repair', n: 1 }] });
  });
});
