import { describe, expect, it } from 'vitest';
import { budgetNight, inModelSteps, modeOf, nextContinuous, queuesOf, roundEstimate, spentSince } from './continuous.mjs';

const at = (hhmm: string, day = 16) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2026, 10, day, h!, m!);
};
const schedule = { startAt: '23:00', stopAt: '07:00', continuous: true };
const on = { on: true, by: 'config', until: at('07:00', 17).toISOString() };

/** One tenant's decision inputs, a run per `steps` entry (round 50 up), at 23:30 with $40 of $200 spent. */
const inputs = (steps: string[], over: Record<string, unknown> = {}) => ({
  now: at('23:30'), mode: on, readOnly: false, runs: steps.map((step, i) => ({ round: 50 + i, step })),
  pending: 0, spentUsd: 40, estimateUsd: 50, nightUsd: 200, capUsd: 160, ...over,
});

describe('modeOf', () => {
  it('is on between startAt and stopAt when the config says so, and only with a nightly budget', () => {
    expect(modeOf({ now: at('23:30'), schedule, nightUsd: 200 })).toMatchObject({ on: true, by: 'config', until: at('07:00', 17).toISOString() });
    expect(modeOf({ now: at('07:00', 17), schedule, nightUsd: 200 })).toMatchObject({ on: false });
    expect(modeOf({ now: at('22:59'), schedule, nightUsd: 200 })).toMatchObject({ on: false });
    expect(modeOf({ now: at('23:30'), schedule: { ...schedule, continuous: false }, nightUsd: 200 })).toMatchObject({ on: false });
    expect(modeOf({ now: at('23:30'), schedule, nightUsd: undefined })).toEqual({ on: false, by: 'off', why: 'no budget.nightUsd' });
  });

  it('follows a request until the night\'s stop time, and a stop ends it for the night', () => {
    const until = at('07:00', 17).toISOString();
    const off = { ...schedule, continuous: false };
    expect(modeOf({ now: at('14:00'), schedule: off, nightUsd: 200, override: { on: true, until } })).toEqual({ on: true, by: 'request', until });
    expect(modeOf({ now: at('23:30'), schedule, nightUsd: 200, override: { on: false, until } })).toEqual({ on: false, by: 'stop', until });
    // An override past its night is spent; the config decides again.
    expect(modeOf({ now: at('23:30', 17), schedule, nightUsd: 200, override: { on: false, until } })).toMatchObject({ on: true, by: 'config' });
  });
});

describe('the budget', () => {
  it('counts a night from one stopAt to the next', () => {
    expect(budgetNight(at('23:30'), '07:00')).toEqual({ from: at('07:00'), to: at('07:00', 17) });
    expect(budgetNight(at('03:00', 17), '07:00')).toEqual({ from: at('07:00'), to: at('07:00', 17) });
    expect(budgetNight(at('07:00', 17), '07:00').from).toEqual(at('07:00', 17));
  });

  it('sums the spend of the runs started since', () => {
    const runs = [{ started: at('06:00').toISOString(), costUsd: 90 }, { started: at('15:00').toISOString(), costUsd: 30 }, { started: at('23:05').toISOString(), costUsd: 12.5 }];
    expect(spentSince(runs, at('07:00'))).toBe(42.5);
  });

  it('estimates a round from recent rounds\' cost per area, else from the guess', () => {
    expect(roundEstimate({ finished: [], areasPerRound: 16, areaGuessUsd: 10 })).toEqual({ usd: 160, perAreaUsd: 10, from: 'guess' });
    const finished = [
      { ended: '2026-11-15', costUsd: 999, areas: [1] },
      ...[1, 2, 3, 4, 5].map((d) => ({ ended: `2026-11-${15 + d}`, costUsd: 24, areas: [1, 2, 3, 4] })),
      { ended: '2026-11-21', costUsd: 0, areas: [] },
    ];
    expect(roundEstimate({ finished, areasPerRound: 16, areaGuessUsd: 10 })).toEqual({ usd: 96, perAreaUsd: 6, from: '5 recent rounds' });
  });
});

describe('nextContinuous', () => {
  it('starts the next round once the last leaves its model steps, its cap what the night has left', () => {
    expect(nextContinuous(inputs(['review']))).toEqual({ start: false, why: 'round 50 is in its model steps', behind: 50 });
    expect(nextContinuous(inputs(['freeze']))).toMatchObject({ start: false, behind: 50 });
    // Round 50 reaches its patch step: 51 may start, capped by the per-run cap.
    expect(nextContinuous(inputs(['patch']))).toEqual({ start: true, capUsd: 160 });
    expect(nextContinuous(inputs(['fleet-wait'], { spentUsd: 120 }))).toEqual({ start: true, capUsd: 80 });
    expect(nextContinuous(inputs([]))).toEqual({ start: true, capUsd: 160 });
    expect(nextContinuous({ ...inputs([]), held: "round 49's batch is unmerged" })).toEqual({ start: false, why: "round 49's batch is unmerged" });
    // Its capstone repair runs a model again, so the next waits for that too.
    expect(nextContinuous(inputs(['repair']))).toMatchObject({ start: false, behind: 50 });
  });

  it('waits for a round that has started but not claimed one', () => {
    expect(nextContinuous(inputs(['batch'], { pending: 1 }))).toMatchObject({ start: false, why: 'a round is starting' });
    expect(inModelSteps({ round: 1 })).toBe(true);
  });

  it('stops the chain when the next round\'s estimate would cross the night\'s budget', () => {
    expect(nextContinuous(inputs(['fleet'], { spentUsd: 150 }))).toEqual({ start: true, capUsd: 50 });
    expect(nextContinuous(inputs(['fleet'], { spentUsd: 151 }))).toMatchObject({
      start: false, why: 'the night\'s budget: $151.00 of $200.00 spent, and the next round is expected to cost $50.00',
    });
  });

  it('starts nothing once the mode is off: past stopAt, stopped, read-only, or after a round that found nothing', () => {
    const past = modeOf({ now: at('07:01', 17), schedule, nightUsd: 200 });
    expect(nextContinuous(inputs([], { now: at('07:01', 17), mode: past }))).toMatchObject({ start: false, why: 'off' });
    expect(nextContinuous(inputs([], { mode: { on: false, by: 'stop' } }))).toMatchObject({ start: false, why: 'stopped for the night' });
    expect(nextContinuous(inputs([], { readOnly: true }))).toEqual({ start: false, why: 'read-only here' });
    expect(nextContinuous(inputs([], { idleUntil: at('07:00', 17).toISOString() }))).toMatchObject({ start: false });
  });
});

describe('queuesOf', () => {
  it('names the round in its model steps and the fleet queue\'s holder and waiters', () => {
    const fleet = { holder: { tenant: 'weasel', round: 50 }, waiting: [{ tenant: 'weasel', round: 51 }] };
    expect(queuesOf({ runs: [{ round: 50, step: 'fleet' }, { round: 51, step: 'fleet-wait' }, { round: 52, step: 'review' }], fleet })).toEqual({
      model: { round: 52, step: 'review' }, fleet,
    });
    expect(queuesOf({ runs: [], fleet: { holder: null, waiting: [] } })).toEqual({ model: null, fleet: { holder: null, waiting: [] } });
  });
});
