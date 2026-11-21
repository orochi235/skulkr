import { describe, expect, it } from 'vitest';
import { fixOf, givenIn, likeness, openFindings } from './carry.mjs';

const section = (claim: string, where: string) => `## ${claim}\n- where: ${where}\n- severity: low\n`;
/** One area's record for a round in which reviewer A alone reported `claims`, each at its `where`. */
const reported = (round: number, claims: [string, string][], extra: Record<string, unknown> = {}) => ({
  round, id: 'x',
  A: claims.map(([c, w]) => section(c, w)).join('\n'), B: '',
  match: { pairs: [], a: claims.map(([c]) => c), b: [] },
  fix: '', area: { patches: 0, fixCommits: [] }, carried: [],
  ...extra,
});

const ROUNDING = ['`clamp` rounds a negative step toward zero, so a reversed range never reaches its end', 'src/clamp.ts:12'] as [string, string];
const LEAK = ['`useTicker` keeps its interval after unmount, so every remount adds another timer', 'src/ticker.ts:40'] as [string, string];

describe('openFindings', () => {
  it('keeps every finding of a round whose fix job did no work: no report, no commits', () => {
    const open = openFindings([reported(56, [ROUNDING, LEAK], { fix: "You've hit your weekly limit" })]);
    expect(open.get('x')!.map((o: any) => [o.id, o.round, o.from])).toEqual([['r56-1', 56, 'A'], ['r56-2', 56, 'A']]);
  });

  it('closes a finding the fixer gave a verdict, matched by its paraphrase, and keeps one it skipped', () => {
    const fix = '- `clamp` rounds a negative step toward zero (A): fixed 1a2b3c4d. It rounds away now.\n\ntally: 1 of 2 fixed, 0 extra fixed';
    const open = openFindings([reported(56, [ROUNDING, LEAK], { fix })]);
    expect(open.get('x')!.map((o: any) => o.id)).toEqual(['r56-2']);
  });

  it('closes every finding when the report gives as many verdicts as it was handed findings', () => {
    const fix = '- Reversed range is fine (A): not a defect. Documented.\n- Leak (A): fixed 1a2b3c4d\n\ntally: 1 of 2 fixed, 0 extra fixed';
    expect(openFindings([reported(56, [ROUNDING, LEAK], { fix })]).has('x')).toBe(false);
  });

  it('counts commits as acting: their subjects close the findings they match', () => {
    const rec = reported(56, [ROUNDING, LEAK], { area: { patches: 1, fixCommits: ['abc'] }, subjects: ['stop useTicker keeping its interval after unmount'] });
    expect(openFindings([rec]).get('x')!.map((o: any) => o.id)).toEqual(['r56-1']);
  });

  it('dedupes a defect reported again in a later round, keeping its first round and listing both', () => {
    const again: [string, string] = ['`clamp` rounds a negative step toward zero, so a reversed range stops short', 'src/clamp.ts:14'];
    const open = openFindings([reported(59, [again]), reported(56, [ROUNDING])]);
    expect(open.get('x')!.map((o: any) => [o.id, o.round, o.rounds])).toEqual([['r56-1', 56, [56, 59]]]);
  });

  it('keeps two like claims apart when they cite different files', () => {
    const elsewhere: [string, string] = [ROUNDING[0], 'src/other.ts:3'];
    expect(openFindings([reported(56, [ROUNDING]), reported(57, [elsewhere])]).get('x')).toHaveLength(2);
  });

  it('closes an earlier finding when a later fixer of the area acts on it, carried by id or not', () => {
    const byId = reported(58, [], { fix: '- [r56-1] reversed ranges (carried): fixed 9f9f9f9f\n\ntally: 1 of 1 fixed, 0 extra fixed', carried: [{ id: 'r56-1', claim: ROUNDING[0], where: ROUNDING[1], from: 'A', round: 56 }] });
    expect(openFindings([reported(56, [ROUNDING, LEAK]), byId]).get('x')!.map((o: any) => o.id)).toEqual(['r56-2']);
    const later = reported(57, [], { fix: '- `useTicker` keeps its interval after unmount (sweep): fixed 7e7e7e7e' });
    expect(openFindings([reported(56, [ROUNDING, LEAK]), later]).get('x')!.map((o: any) => o.id)).toEqual(['r56-1']);
  });

  it('opens a finding again when a later round reports it and that round\'s fixer does no work', () => {
    const closed = reported(56, [ROUNDING], { fix: '- clamp (A): not a defect\n\ntally: 0 of 1 fixed, 0 extra fixed' });
    expect(openFindings([closed]).has('x')).toBe(false);
    expect(openFindings([closed, reported(57, [ROUNDING])]).get('x')!.map((o: any) => o.rounds)).toEqual([[56, 57]]);
  });
});

describe('givenIn and fixOf', () => {
  it('orders matched findings first and drops a heading with no where line', () => {
    const rec = {
      round: 3, A: section('one', 'a/b.ts:1') + section('two', 'a/c.ts:2'), B: '## title of the report\n\n' + section('two too', 'a/c.ts:3'),
      match: { pairs: [[1, 1]], a: ['one', 'two'], b: ['title of the report', 'two too'] },
    };
    expect(givenIn(rec).fresh.map((f: any) => [f.id, f.claim, f.from, f.where])).toEqual([
      ['r3-1', 'two', 'A+B', 'a/c.ts:2'], ['r3-2', 'one', 'A', 'a/b.ts:1'],
    ]);
  });

  it('reads a report with only a tally line as work, and a usage-limit reply as none', () => {
    expect(fixOf({ fix: 'tally: 0 of 3 fixed, 0 extra fixed' }).worked).toBe(true);
    expect(fixOf({ fix: "You've hit your weekly limit", area: { patches: 0 } }).worked).toBe(false);
    expect(likeness('A B', '')).toBe(0);
  });
});
