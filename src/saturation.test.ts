import { describe, expect, it } from 'vitest';
import { chao2, chapmanPairs, estimatesOf, perSource, stopReason, yieldRows } from './saturation.mjs';

/** Incidence by occasion: occ1 {A,B,C,D}, occ2 {D,B,E,F,G,H,I}, occ3 {J,A,K,H}, occ4 {A,D}, occ5 {H,L,A,C,M}. */
const SEEN = [['A', 'B', 'C', 'D'], ['D', 'B', 'E', 'F', 'G', 'H', 'I'], ['J', 'A', 'K', 'H'], ['A', 'D'], ['H', 'L', 'A', 'C', 'M']];
const ledgerOf = (seen: string[][], sourceOf = (_n: number) => 'claude') => {
  const occasions = seen.map((_, i) => ({ n: i + 1, source: sourceOf(i + 1) }));
  const ids = [...new Set(seen.flat())];
  const defects = ids.map((id) => {
    const sightings = seen.flatMap((s, i) => (s.includes(id) ? [i + 1] : []));
    const sources: Record<string, number[]> = {};
    for (const n of sightings) (sources[sourceOf(n)] ??= []).push(n);
    return { id, claim: id, where: '', firstOccasion: sightings[0], sightings, sources };
  });
  return { area: 'a', commit: 'c', files: [], occasions, defects };
};

describe('chao2', () => {
  it('matches the worked example after five occasions', () => {
    const l = ledgerOf(SEEN);
    const s = chao2(l.occasions, l.defects);
    expect(s).toMatchObject({ m: 5, S: 13, Q1: 8, Q2: 2, U: 22 });
    expect(s.f0).toBeCloseTo(12.8, 10);
    expect(s.total).toBeCloseTo(25.8, 10);
    expect(s.nextNew).toBeCloseTo(0.3232, 3);
  });

  it('counts only the occasions it is given, and takes occasion numbers as well as records', () => {
    const l = ledgerOf(SEEN);
    const s = chao2([1, 2], l.defects);
    // A, C seen once; B, D twice; E–I once.
    expect(s).toMatchObject({ m: 2, S: 9, Q1: 7, Q2: 2, U: 11 });
    expect(s.f0).toBeCloseTo(0.5 * 49 / 4, 10);
  });

  it('uses the bias-corrected form when no defect was seen twice', () => {
    const l = ledgerOf([['A', 'B', 'C'], ['D']]);
    const s = chao2(l.occasions, l.defects);
    expect(s).toMatchObject({ Q1: 4, Q2: 0 });
    expect(s.f0).toBeCloseTo(0.5 * 4 * 3 / 2, 10);
    expect(s.coverage).toBeCloseTo(0, 10);
  });

  it('leaves every estimate undefined for one occasion, and full coverage once nothing is a singleton', () => {
    const one = ledgerOf([['A']]);
    expect(chao2(one.occasions, one.defects)).toMatchObject({ m: 1, S: 1, f0: undefined, nextNew: undefined });
    const twice = ledgerOf([['A'], ['A']]);
    expect(chao2(twice.occasions, twice.defects)).toMatchObject({ f0: 0, coverage: 1, nextNew: 0 });
    const none = ledgerOf([[], []]);
    expect(chao2(none.occasions, none.defects)).toMatchObject({ S: 0, f0: 0, nextNew: 0 });
  });
});

describe('per source and across sources', () => {
  const bySource = (n: number) => (n % 2 ? 'claude' : 'codex');

  it("runs chao2 over each source's occasions alone", () => {
    const per = perSource(ledgerOf(SEEN, bySource));
    expect(Object.keys(per)).toEqual(['claude', 'codex']);
    expect(per.claude).toMatchObject({ m: 3 });
    expect(per.codex).toMatchObject({ m: 2, S: 8 });
  });

  it("takes Chapman over each source's union", () => {
    const [pair] = chapmanPairs(ledgerOf(SEEN, bySource));
    // claude: occ 1, 3, 5 → A B C D J K H L M (9); codex: occ 2, 4 → D B E F G H I A (8); both: A B D H.
    expect(pair).toMatchObject({ a: 'claude', b: 'codex', n1: 9, n2: 8, overlap: 4 });
    expect(pair.total).toBeCloseTo(10 * 9 / 5 - 1, 10);
    expect(chapmanPairs(ledgerOf(SEEN))).toEqual([]);
  });

  it('pairs every two of three sources', () => {
    const three = (n: number) => ['x', 'y', 'z'][n % 3];
    expect(estimatesOf(ledgerOf(SEEN, three)).chapman.map((p) => `${p.a}-${p.b}`)).toEqual(['y-z', 'y-x', 'z-x']);
  });
});

describe('yieldRows', () => {
  it('gives each occasion its new defects and the running estimate', () => {
    const rows = yieldRows(ledgerOf(SEEN));
    expect(rows.map((r) => r.new)).toEqual([4, 5, 2, 0, 2]);
    expect(rows.map((r) => r.stats.S)).toEqual([4, 9, 11, 11, 13]);
    expect(rows[0].stats.f0).toBeUndefined();
    expect(rows[4].stats.f0).toBeCloseTo(12.8, 10);
  });

  it('gives each occasion the cost so far per distinct defect so far', () => {
    const l = ledgerOf([[], ['A', 'B'], ['B', 'C']]);
    l.occasions = l.occasions.map((o, i) => ({ ...o, costUsd: [1, 2, 3][i] }));
    const rows = yieldRows(l);
    expect(rows.map((r) => r.spentUsd)).toEqual([1, 3, 6]);
    expect(rows.map((r) => r.usdPerDefect)).toEqual([undefined, 1.5, 2]);
  });
});

describe('stopReason', () => {
  const rule = { max: 40, stopNextNew: 0.1 };
  it('stops at the limit, under one unseen, or under the next-new floor, and not before', () => {
    expect(stopReason({ m: 40, f0: 9, nextNew: 0.5 }, rule)).toMatch(/limit of 40/);
    expect(stopReason({ m: 6, f0: 0.4, nextNew: 0.2 }, rule)).toMatch(/fewer than one/);
    expect(stopReason({ m: 6, f0: 3, nextNew: 0.08 }, rule)).toMatch(/under 10%/);
    expect(stopReason({ m: 6, f0: 3, nextNew: 0.12 }, rule)).toBeNull();
    expect(stopReason({ m: 1, f0: undefined, nextNew: undefined }, rule)).toBeNull();
  });
});
