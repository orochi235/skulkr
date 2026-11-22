import { describe, expect, it } from 'vitest';
import { lastPassOf, statsFor } from './areaData';
import { areasAsOf, bothIn, matchingIn, pastRoundsOf, readIn, roundScopeIn } from './asOf';
import type { AuditArea, AuditPass } from './skulkrMap.types';

const pass = (round: number, left: number): AuditPass => ({ round, date: '', a: 2, b: 2, shared: 1, distinct: 2, est: 2 + left, left });

const area = (id: string, extra: Partial<AuditArea> = {}): AuditArea => ({
  id, group: id.split('.')[0]!, files: 10, status: 'due', queue: 3, stage: null, passes: [], ...extra,
});

const AREAS: AuditArea[] = [
  area('core.ops', {
    status: 'settled', staleLines: 40, openFindings: 1,
    passes: [pass(38, 6), pass(40, 1), pass(41, 0)], last: { round: 41, left: 0 },
    lastByRound: [{ round: 39, pass: 38, left: 6, leftCorrected: 9 }, { round: 40, left: 1 }, { round: 41, left: 0 }],
  }),
  area('ui.menu', { status: 'unaudited', passes: [pass(40, 2)] }),
];

describe("an area's estimate as of a past round", () => {
  it('takes the last entry at or before the round, from the round its pass came from, corrected or as left', () => {
    const [ops] = AREAS;
    expect(lastPassOf(ops!, 38)).toBeNull();
    expect(lastPassOf(ops!, 39)).toEqual({ round: 38, left: 6, leftCorrected: 9 });
    expect(lastPassOf(ops!, 40)).toEqual({ round: 40, left: 1, leftCorrected: 1 });
    expect(lastPassOf(ops!, 99)).toEqual({ round: 41, left: 0, leftCorrected: 0 });
    expect(lastPassOf(ops!)).toEqual({ round: 41, left: 0 });
    expect(lastPassOf(AREAS[1]!, 40)).toBeNull();
  });

  it('shows each area as audited or not then, with its passes to that round and nothing known only of now', () => {
    const [ops, menu] = areasAsOf(AREAS, 40);
    expect(ops).toEqual({ id: 'core.ops', group: 'core', files: 10, status: 'due', queue: null, stage: null, passes: [pass(38, 6), pass(40, 1)], last: { round: 40, left: 1, leftCorrected: 1 } });
    expect(menu).toMatchObject({ status: 'unaudited', last: null, passes: [pass(40, 2)] });
    expect(areasAsOf(AREAS, 38)[0]).toMatchObject({ status: 'unaudited', last: null });
  });

  it("offers the map's rounds only where its areas carry lastByRound", () => {
    const rounds = [39, 41, 40].map((round) => ({ round, date: '', areas: 1, files: 1, distinct: 1, est: 1 }));
    expect(pastRoundsOf({ areas: AREAS, rounds })).toEqual([39, 40, 41]);
    expect(pastRoundsOf({ areas: [AREAS[1]!], rounds })).toEqual([]);
  });

  it('labels the headline numbers by the round, and counts settling as it stands now', () => {
    const stats = statsFor(areasAsOf(AREAS, 39), 39, AREAS);
    expect(stats.map((s) => s.label)).toEqual([
      'areas audited by round 39',
      'of 20 source files charted',
      'defects found and fixed through round 39',
      'estimated still in audited areas (≈9 corrected)',
      'areas settled now',
    ]);
    expect(stats[0]!.value).toBe('1 / 2');
    expect(stats[3]!.value).toBe('≈6');
  });

  it('names the areas a round read, for the map to keep in color', () => {
    expect([...readIn(AREAS, 40)!]).toEqual(['core.ops', 'ui.menu']);
    expect([...readIn(AREAS, 41)!]).toEqual(['core.ops']);
    expect(readIn(AREAS, null)).toBeNull();
  });

  it('keeps in color the areas whose name holds every word typed, with the round filter where both are on', () => {
    expect([...matchingIn(AREAS, 'OPS')!]).toEqual(['core.ops']);
    expect([...matchingIn(AREAS, ' ui  menu ')!]).toEqual(['ui.menu']);
    expect([...matchingIn(AREAS, 'core menu')!]).toEqual([]);
    expect(matchingIn(AREAS, '  ')).toBeNull();
    expect([...bothIn(readIn(AREAS, 40), matchingIn(AREAS, 'menu'))!]).toEqual(['ui.menu']);
    expect(bothIn(null, null)).toBeNull();
  });

  it('keeps a live round\'s areas in color at now, beside what the last recorded round read', () => {
    const live = area('core.live', { status: 'tonight', passes: [] });
    expect([...roundScopeIn([...AREAS, live], null, 41)!]).toEqual(['core.ops', 'core.live']);
    expect([...roundScopeIn([...AREAS, live], 40, 41)!]).toEqual(['core.ops', 'ui.menu']);
  });
});
