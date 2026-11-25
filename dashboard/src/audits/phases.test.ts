import { describe, expect, it } from 'vitest';
import { CLOCK_AHEAD_MINUTES, laneViewOf, runClockOf } from './clockLane';
import { TYPICAL_MINUTES, agentsRunningIn, isFinished, passDone, phaseColor, phaseOf, phasesOf, stageCountsOf, withLivePasses } from './phases';
import { STEP_COLUMN_COUNT, countedFillOf, laneStepsOf } from './stepsLane';
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
      ['A', 2, 3, 'done'], ['B', 2, 4, 'done'], ['match', 6, TYPICAL_MINUTES.match, 'done'], ['fix', 18, 12, 'active'], ['patch', 30, TYPICAL_MINUTES.patch, 'pending'],
    ]);
    expect(view.elapsed).toBe('12:00');
    expect(view.spans.map((s) => s.label)).toEqual(['A 5 found · 3:00', 'B 2 found · 4:00', '5 total (2 shared)', 'studio · 12:00', '5 found']);
    expect(view.spans.map((s) => s.color).slice(0, 3)).toEqual([phaseColor('review'), phaseColor('reviewed'), phaseColor('match')]);
  });

  it("starts a lane with no record of when it ran at the round's start, and a part not begun no earlier than now", () => {
    const view = laneViewOf(lane({ A: done({ minutes: 3, findings: 1 }), B: done({ minutes: 5 }) }), NOW, START);
    expect(view.spans.map((s) => ((s.start ?? 0) - START) / MIN)).toEqual([0, 3, 30, 30 + TYPICAL_MINUTES.match, 30 + TYPICAL_MINUTES.match + TYPICAL_MINUTES.fix]);
    expect(view.spans.map((s) => s.fill)).toEqual([undefined, undefined, 0, 0, 0]);
  });

  it('runs B beside A on a track of its own where the two overlap, and dims it while it waits for a slot', () => {
    const both = laneViewOf(lane({ A: running(at(26)), B: running(at(27)) }), NOW, START);
    expect(both.spans.slice(0, 2).map((s) => [s.id, ((s.start ?? 0) - START) / MIN, s.ms / MIN, s.state, s.track])).toEqual([
      ['A', 26, 4, 'active', 0], ['B', 27, 3, 'active', 1],
    ]);
    expect(both.tracks).toBe(2);
    expect(both.spans.find((s) => s.id === 'match')?.trackSpan).toBe(2);
    const waiting = laneViewOf(lane({ A: done({ minutes: 2, started: at(20), ended: at(22) }) }), NOW, START);
    expect(waiting.tracks).toBe(1);
    expect(waiting.spans.slice(0, 2).map((s) => [s.id, ((s.start ?? 0) - START) / MIN, s.fill, s.label])).toEqual([
      ['A', 20, undefined, 'A 0 found · 2:00'], ['B', 30, 0, ''],
    ]);
  });


  it('captions and shades the patch with the fixer\'s tally of what it fixed', () => {
    const fixed = { A: done({ findings: 3 }), B: done({ findings: 2 }), match: matched(3, 2, 1), fix: done({ minutes: 9, commits: 6, fixed: 3, of: 4, extra: 1 }) };
    const patchOf = (spans: { id: string }[]) => spans.find((s) => s.id === 'patch') as { label: string; ms: number; fill?: number } | undefined;
    expect(patchOf(laneViewOf(lane(fixed), NOW, START).spans)?.label).toBe('3/4 fixed ★1 extra');
    expect(patchOf(laneStepsOf(lane({ ...fixed, patch: done({ commits: 6 }) }), NOW))?.label).toBe('3/4 fixed ★1 extra');
    expect(laneViewOf(lane({ ...fixed, fix: done({ minutes: 9, commits: 6 }) }), NOW, START).spans.at(-1)?.label).toBe('4 found');
  });

  it('splits the patch into the share settled, shaded, and the share left for later, hatched dark gray', () => {
    const fixed = { A: done({ findings: 3 }), B: done({ findings: 2 }), match: matched(3, 2, 1), fix: done({ minutes: 9, commits: 6, fixed: 2, of: 4, deferred: 1 }) };
    for (const spans of [laneStepsOf(lane(fixed), NOW), laneStepsOf(lane({ ...fixed, patch: done({ commits: 6 }) }), NOW)]) {
      const [kept, filed] = spans.slice(-2);
      expect([kept!.id, kept!.ms, kept!.fill]).toEqual(['patch', 1.1 * 0.75, 1]);
      expect([filed!.id, filed!.ms, filed!.state, filed!.color, filed!.label]).toEqual(['patch-unfixed', 1.1 * 0.25, 'failed', 'var(--audit-filed)', '']);
    }
    // A finding found sound is settled, not left: no hatch where nothing was deferred.
    const sound = { ...fixed, fix: done({ minutes: 9, commits: 6, fixed: 3, of: 4, deferred: 0, dismissed: 1 }) };
    expect(laneStepsOf(lane(sound), NOW).at(-1)?.label).toBe('3/4 fixed · 1 FP');
    expect(laneStepsOf(lane(fixed), NOW).find((s) => s.id === 'patch')?.label).toBe('2/4 fixed · 1 filed');
    expect(laneStepsOf(lane(sound), NOW).map((s) => s.id)).not.toContain('patch-unfixed');
    // Settled whole, so shaded whole, in both views, before the batch applies it.
    expect(laneStepsOf(lane(sound), NOW).find((s) => s.id === 'patch')?.fill).toBe(1);
    expect(laneViewOf(lane(sound), NOW, START).spans.find((s) => s.id === 'patch')?.fill).toBe(1);
    // A tally line alone says nothing of why, so everything unfixed is left.
    const tallied = { ...fixed, fix: done({ minutes: 9, commits: 6, fixed: 3, of: 4 }) };
    expect(laneStepsOf(lane(tallied), NOW).find((s) => s.id === 'patch-unfixed')?.ms).toBeCloseTo(1.1 * 0.25);
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
    expect(spans.map((s) => [s.id, s.ms, s.fill])).toEqual([['A', 1, 1], ['B', 1, 0.5], ['match', 1, 0], ['fix', 1, 0], ['checks', 0.5, 0], ['verify', 0.5, 0], ['patch', 1.1, 0]]);
    // The finished review is dark gray; the rest wear their phases.
    expect(spans.filter((s) => !['checks', 'verify', 'repair'].includes(s.id)).map((s) => s.color)).toEqual(['var(--audit-stage-done)', ...['reviewed', 'match', 'fix', 'patch'].map((p) => phaseColor(p as never))]);
    expect(spans[0]!.ink).toBe('var(--audit-stage-done-ink)');
    expect(spans[1]!.label).toBe('studio · 2:30');
    expect(spans[2]!.label).toBe('');
  });

  it('moves a counted step on by its minutes between counts, never past halfway to the next count', () => {
    expect(countedFillOf(0, 6, 0)).toBe(0);
    expect(countedFillOf(0, 6, 0.05)).toBeCloseTo(0.05);
    expect(countedFillOf(0, 6, 0.5)).toBeCloseTo(0.5 / 6);
    expect(countedFillOf(3, 6, 0.1)).toBe(0.5);
    expect(countedFillOf(6, 6, 2)).toBe(1);
  });

  it("counts a running fixer's failing checks with the fail mark before the number", () => {
    const checking = lane({ fix: { ...running(at(6)), done: 3, total: 3, checks: { done: 2, total: 3, failed: 1 } } });
    expect(laneStepsOf(checking, NOW).find((s) => s.id === 'checks')!.label).toBe('studio · 2/3 · ✗1');
  });

  it("leaves the fixer's checks column saying how many it fixed once the fix is done", () => {
    const checks = (fix: LaneStep) => laneStepsOf(lane({ fix }), NOW).find((s) => s.id === 'checks')!.label;
    expect(checks(done({ commits: 2 }))).toBe('checked');
    expect(checks(done({ commits: 2, fixed: 4 }))).toBe('4 fixed');
  });

  it('says a step is queued once the step before it has finished, and nothing for one further on', () => {
    const label = (steps: Partial<Record<LaneStepName, LaneStep>>, id: string) => laneStepsOf(lane(steps), NOW).find((s) => s.id === id)!.label;
    const matchedLane = { A: done({ findings: 2 }), B: done({ findings: 1 }), match: matched(2, 1, 1) };
    expect(label(matchedLane, 'fix')).toBe('queued');
    expect(label(matchedLane, 'verify')).toBe('');
    expect(label({ ...matchedLane, fix: done({ commits: 2 }) }, 'verify')).toBe('queued');
    expect(label({}, 'fix')).toBe('');
  });

  it('runs A, then B, then every later step a column after, on one stripe', () => {
    const spans = laneStepsOf(lane({}), NOW);
    expect(spans.map((s) => [s.id, s.start, s.track, s.trackSpan])).toEqual([
      ['A', 0, undefined, undefined], ['B', 1, undefined, undefined], ['match', 2, undefined, undefined], ['fix', 3, undefined, undefined],
      ['checks', 4, undefined, undefined], ['verify', 4.5, undefined, undefined], ['patch', 5, undefined, undefined],
    ]);
    expect(STEP_COLUMN_COUNT).toBeCloseTo(6.1);
  });

  it('stops a running step short of full until it finishes', () => {
    expect(laneStepsOf(lane({ A: running(at(0)) }), NOW)[0]!.fill).toBe(0.9);
  });

  it('fills a running step by its own count where onto reports one, and says the count', () => {
    const fixing = lane({ A: done({ findings: 5 }), B: done({ findings: 3 }), match: matched(5, 3, 0), fix: { ...running(at(6)), done: 3, total: 8 } });
    const fix = laneStepsOf(fixing, NOW).find((s) => s.id === 'fix')!;
    // Past its typical minutes, it sits halfway to its next commit, never nearer it than its caption's count.
    expect(fix.fill).toBeCloseTo((3 + 0.5) / 8);
    expect(fix.label).toMatch(/^studio · 3\/8 commits · \d/);
    const checking = laneStepsOf(lane({ fix: { ...running(at(6)), done: 8, total: 8 } }), NOW);
    expect(checking.find((s) => s.id === 'fix')!.fill).toBe(1);
    expect(checking.find((s) => s.id === 'checks')).toMatchObject({ state: 'active', fill: 1, label: 'studio' });
    expect(checking.find((s) => s.id === 'fix')).toMatchObject({ state: 'done' });
    expect(checking.find((s) => s.id === 'fix')!.label).toMatch(/^8 commits · /);
    expect(laneStepsOf(fixing, NOW).find((s) => s.id === 'checks')!.state).toBe('pending');
  });
});

describe('the repair step', () => {
  const fixed = { A: done({ findings: 2 }), B: done({ findings: 1 }), match: matched(2, 1, 1), fix: done({ commits: 2, minutes: 12 }) };

  it("gives the fixer's checks and the verify a column each, and the last column to a repair only while one is under way", () => {
    const ids = (repair?: LaneStep) => laneStepsOf({ id: 'x', steps: { ...lane(fixed).steps, ...(repair ? { repair } : {}) } }, NOW).map((s) => [s.id, s.start]);
    const before = [['A', 0], ['B', 1], ['match', 2], ['fix', 3], ['checks', 4], ['verify', 4.5]];
    expect(ids()).toEqual([...before, ['patch', 5]]);
    expect(ids({ ...running(at(25)), job: 'verify' })).toEqual([...before, ['patch', 5]]);
    expect(ids({ ...running(at(25)), job: 'repair' })).toEqual([...before, ['repair', 5]]);
    expect(ids({ state: 'running', outcome: 'failed' })).toEqual([...before, ['repair', 5]]);
    expect(ids(done({ attempts: 1, outcome: 'passed' }))).toEqual([...before, ['patch', 5]]);
  });

  it('lights the job running, verify or repair, in magenta, a repair with its progress and which repair it is', () => {
    const spans = (repair: LaneStep) => laneStepsOf({ id: 'x', steps: { ...lane(fixed).steps, repair } }, NOW);
    const verifying = spans({ ...running(at(25)), job: 'verify' });
    expect(verifying.find((s) => s.id === 'verify')).toMatchObject({ state: 'active', color: 'var(--audit-repair)' });
    const repairing = spans({ ...running(at(25)), job: 'repair', attempts: 1 });
    expect(repairing.find((s) => s.id === 'verify')).toMatchObject({ label: '✗ failed' });
    expect(repairing.find((s) => s.id === 'repair')).toMatchObject({ state: 'active', color: 'var(--audit-repair)' });
    expect(repairing.find((s) => s.id === 'repair')!.fill).toBeGreaterThan(0);
    expect(repairing.find((s) => s.id === 'repair')!.label).toMatch(/^repair 2 · studio · /);
    expect(spans({ state: 'running', outcome: 'failed' }).find((s) => s.id === 'repair')!.label).toBe('waiting for a repair');
    expect(laneViewOf({ id: 'x', steps: { ...lane(fixed).steps, repair: running(at(25)) } }, NOW, START).spans.find((s) => s.id === 'repair')!.color).toBe('var(--audit-repair)');
  });

  it('says how its verify ended', () => {
    const of = (repair: LaneStep, id: string) => laneStepsOf({ id: 'x', steps: { ...lane(fixed).steps, repair } }, NOW).find((s) => s.id === id)!;
    expect(of(done({ attempts: 0, outcome: 'passed' }), 'verify').label).toBe('✓ passed');
    expect(of(done({ attempts: 2, outcome: 'passed' }), 'verify').label).toBe('✓ passed (2)');
    expect(of(done({ attempts: 1, outcome: 'timed out' }), 'verify').label).toBe('✗ failed');
  });

  it('counts the model agents running: reviewers, matchers, fixers short of their hand-back verify, and repairs', () => {
    const fixing = lane({ A: done({ findings: 1 }), B: done({ findings: 1 }), match: matched(1, 1, 0), fix: running(at(25)) });
    const handingBack = lane({ A: done({ findings: 1 }), B: done({ findings: 1 }), match: matched(1, 1, 0), fix: { ...running(at(25)), now: { text: "verifying the fixer's commits", at: at(30) } } });
    const reviewing = lane({ A: running(at(25)), B: running(at(26)) });
    const verifying: AuditLane = { id: 'x', steps: { ...lane(fixed).steps, repair: { ...running(at(25)), job: 'verify' } } };
    const repairing: AuditLane = { id: 'x', steps: { ...lane(fixed).steps, repair: { ...running(at(25)), job: 'repair' } } };
    const onFleet = lane({ A: done({ findings: 1 }), B: done({ findings: 1 }), match: matched(1, 1, 0), fix: { ...running(at(25)), now: { text: 'on the fleet as weasel-verify-1a2b3c4d5e', at: at(30) } } });
    expect(agentsRunningIn([fixing, handingBack, reviewing, verifying, repairing, onFleet])).toBe(4);
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
