import { describe, expect, it } from 'vitest';
import { defectGraphOf, openFindings } from './defectGraph.mjs';
import { entryOf } from './registry.mjs';

const section = (claim: string, where: string) => `## ${claim}\n- where: ${where}\n- severity: medium\n`;
const reported = (round: number, claims: [string, string][], extra: Record<string, unknown> = {}) => ({
  round, id: 'x',
  A: claims.map(([c, w]) => section(c, w)).join('\n'), B: '',
  match: { pairs: [], a: claims.map(([c]) => c), b: [] },
  fix: '', area: { patches: 0, fixCommits: [], commit: `c${round}`, date: '2026-11-20' }, carried: [],
  ...extra,
});

const ROUNDING = ['`clamp` rounds a negative step toward zero, so a reversed range never reaches its end', 'src/clamp.ts:12'] as [string, string];
const LEAK = ['`useTicker` keeps its interval after unmount, so every remount adds another timer', 'src/ticker.ts:40'] as [string, string];

/** A landed ledger of area `x` read ahead of round `before`, holding `defects`. */
const ledger = (before: number, defects: [string, string][]) => ({
  key: 'x@c0ffee0000', area: 'x', commit: 'c0ffee', before,
  defects: defects.map(([claim, where], i) => ({ id: `D${i + 1}`, claim, where, severity: 'low', sightings: [1, 2], sources: { claude: [1], codex: [2] } })),
});

describe('defectGraphOf', () => {
  it('records the verdict and commit that resolved a defect', () => {
    const fix = '- `clamp` rounds a negative step toward zero (A): fixed 1a2b3c4d. It rounds away now.\n\ntally: 1 of 2 fixed, 0 extra fixed';
    const [rounding, leak] = defectGraphOf([reported(56, [ROUNDING, LEAK], { fix })]).map(entryOf);
    expect(rounding).toMatchObject({ status: 'fixed', resolved: { round: 56, area: 'x', verdict: 'fixed', sha: '1a2b3c4d' }, severity: 'medium', files: ['src/clamp.ts'] });
    expect(rounding.first).toEqual({ round: 56, commit: 'c56', date: '2026-11-20' });
    expect(rounding.sightings).toEqual([{ round: 56, area: 'x', from: 'A' }]);
    expect(leak).toMatchObject({ status: 'open' });
    expect(leak.resolved).toBeUndefined();
  });

  it('keeps a defect only a ledger found open and out of every fixer’s view, until its fixer’s words close it', () => {
    const records = [reported(56, [ROUNDING], { fix: '- `clamp` rounds a negative step toward zero (A): fixed 1a2b3c4d' })];
    const sat = ledger(57, [LEAK]);
    const graph = defectGraphOf(records, { ledgers: [sat] });
    const leak = entryOf(graph.find((o: any) => o.claim === LEAK[0]));
    expect(leak).toMatchObject({ status: 'open', first: { ledger: 'x@c0ffee0000', commit: 'c0ffee' } });
    expect(leak.sightings).toEqual([{ ledger: 'x@c0ffee0000', defect: 'D1', occasions: [1, 2], sources: ['claude', 'codex'] }]);
    expect(openFindings(records).has('x')).toBe(false);

    const answered = reported(58, [], { fix: '- `useTicker` keeps its interval after unmount (sweep): fixed 7e7e7e7e' });
    const closed = defectGraphOf([...records, answered], { ledgers: [sat] }).map(entryOf).find((e: any) => e.claim === LEAK[0]);
    expect(closed).toMatchObject({ status: 'fixed', resolved: { round: 58, sha: '7e7e7e7e' } });
  });

  it('joins a ledger’s defect to the round that finds it again, and leaves that round’s defect as it was', () => {
    const again = reported(57, [LEAK], { fix: '- `useTicker` keeps its interval (A): fixed 5c5c5c5c\n\ntally: 1 of 1 fixed, 0 extra fixed' });
    const without = defectGraphOf([again]).map(entryOf);
    const withLedger = defectGraphOf([again], { ledgers: [ledger(57, [LEAK])] }).map(entryOf);
    expect(withLedger).toHaveLength(1);
    expect(withLedger[0]).toMatchObject({ id: without[0].id, status: 'fixed', first: { round: 57 } });
    expect(withLedger[0].sightings.map((x: any) => x.round ?? x.ledger)).toEqual([57, 'x@c0ffee0000']);
  });

  it('adds a ledger’s sighting to an open round defect it read after', () => {
    const graph = defectGraphOf([reported(56, [LEAK])], { ledgers: [ledger(Infinity, [LEAK])] }).map(entryOf);
    expect(graph).toHaveLength(1);
    expect(graph[0].sightings.map((x: any) => x.round ?? x.ledger)).toEqual([56, 'x@c0ffee0000']);
  });
});
