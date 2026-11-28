import { describe, expect, it } from 'vitest';
import { fixPlanFor, resolvedFile } from './scourTriage.mjs';
import { defectsBatchOf, fixSizeOf, scourVerdictsOf } from './scourFix.mjs';
import { fixStatusesFor, lastFixRunOf, whyOf } from './scourFixStatus.mjs';
import { withFlags } from './scourFlags.mjs';
import { isRecurrent } from './triageFields.mjs';

const d = (id: string, where: string, extra: Record<string, unknown> = {}, seen = 1) => ({ id, claim: `claim ${id}`, where, sightings: Array.from({ length: seen }, (_, i) => i + 1), ...extra });
const ledgerOf = (defects: unknown[], files: string[] = [], occasions = 10) => ({ files, defects, occasions: Array.from({ length: occasions }, () => ({})) });

describe('scour fix triage', () => {
  it('makes one batch of exactly the named defects, numbered as the first one\'s batch, and refuses an id no batch holds', () => {
    const plan = { batches: [
      { n: 1, defects: [{ id: 'D1', files: ['a.ts'] }, { id: 'D2', files: ['b.ts'] }], files: ['a.ts', 'b.ts'] },
      { n: 2, defects: [{ id: 'D3', files: ['c.ts'] }], files: ['c.ts'] },
    ] };
    const b = defectsBatchOf(plan, ['D2', 'D3']);
    expect(b.n).toBe(1);
    expect(b.defects.map((x: { id: string }) => x.id)).toEqual(['D2', 'D3']);
    expect(b.files).toEqual(['b.ts', 'c.ts']);
    expect(() => defectsBatchOf(plan, ['D9'])).toThrow('no batch holds D9');
  });

  it('batches defects that share a file a fix would touch or a cause, and sets design-sized ones aside to ask', () => {
    const plan = fixPlanFor(ledgerOf([
      d('D1', 'src/a.ts:10'), d('D2', 'src/b.ts:5', { fix: ['src/a.ts'] }), d('D3', 'src/c.ts:1', { cause: 'stale capture' }),
      d('D4', 'src/d.ts:1', { cause: 'Stale capture ' }), d('D5', 'src/e.ts:1', { size: 'design' }),
    ]));
    expect(plan.ask.map((x: { id: string }) => x.id)).toEqual(['D5']);
    const groups = plan.batches.map((b: { defects: { id: string }[] }) => b.defects.map((x: { id: string }) => x.id).sort());
    expect(groups).toContainEqual(expect.arrayContaining(['D1', 'D2']));
    expect(groups.find((g: string[]) => g.includes('D3'))).toContain('D4');
  });

  it('caps batches at the size given, never packing small ones past it, and refuses a size outside 1 to 16', () => {
    const plan = fixPlanFor(ledgerOf([d('D1', 'src/a.ts:1'), d('D2', 'src/a.ts:2'), d('D3', 'src/b.ts:1'), d('D4', 'src/c.ts:1')]), { size: 1 });
    expect(plan.batches.map((b: { defects: unknown[] }) => b.defects.length)).toEqual([1, 1, 1, 1]);
    const two = fixPlanFor(ledgerOf(Array.from({ length: 5 }, (_, i) => d(`D${i + 1}`, `src/a.ts:${i + 1}`))), { size: 2 });
    expect(two.batches.map((b: { defects: unknown[] }) => b.defects.length)).toEqual([2, 2, 1]);
    expect(fixSizeOf(undefined)).toBe(8);
    expect(fixSizeOf('3')).toBe(3);
    expect(fixSizeOf('16')).toBe(16);
    expect(() => fixSizeOf('17')).toThrow('--size wants a whole number of defects from 1 to 16, not 17');
    expect(() => fixSizeOf('0')).toThrow('--size');
  });

  it('splits a group past eight in file and line order, and flags what most passes find', () => {
    const many = Array.from({ length: 11 }, (_, i) => d(`D${i + 1}`, `src/a.ts:${100 - i}`, {}, i === 0 ? 6 : 1));
    const plan = fixPlanFor(ledgerOf(many));
    expect(plan.batches.map((b: { defects: unknown[] }) => b.defects.length)).toEqual([6, 5]);
    expect(plan.batches[0]!.defects[0]!.id).toBe('D11');
    expect(plan.batches.flatMap((b: { defects: { id: string, recurrent: boolean }[] }) => b.defects).filter((x: { recurrent: boolean }) => x.recurrent).map((x: { id: string }) => x.id)).toEqual(['D1']);
  });

  it("makes a reviewer's file mention the path it names, or nothing for prose", () => {
    const known = ['packages/ui/src/CurveEditor/x.ts', 'packages/ui/src/T/y.ts'];
    expect(resolvedFile('CurveEditor/x.ts:12', known)).toBe('packages/ui/src/CurveEditor/x.ts');
    expect(resolvedFile('packages/ui/src/T/y.ts (fn)', known)).toBe('packages/ui/src/T/y.ts');
    expect(resolvedFile('`x.ts` (`fn`)', known)).toBe('packages/ui/src/CurveEditor/x.ts');
    expect(resolvedFile('[track.min', known)).toBeNull();
  });

  it('calls a defect recurrent at a quarter of the passes and five sightings', () => {
    expect(isRecurrent(9, 34)).toBe(true);
    expect(isRecurrent(4, 10)).toBe(false);
    expect(isRecurrent(5, 30)).toBe(false);
  });

  it("reads each defect's verdict from the line its id leads", () => {
    const report = [
      '[D3] key past duration (scour): fixed 1a2b3c4 — clamps to the arrow\'s direction',
      '- [D7] read-only scrub cursor (scour): not a defect (no longer applies)',
      '[D9] question (whether a hold cancels the drag)',
      'tally: 1 of 4 fixed, 0 extra fixed',
    ].join('\n');
    expect(scourVerdictsOf(report, ['D3', 'D7', 'D9', 'D12'])).toEqual([
      { id: 'D3', verdict: 'fixed', sha: '1a2b3c4', line: expect.stringContaining('[D3]') },
      { id: 'D7', verdict: 'not a defect', sha: null, line: expect.stringContaining('[D7]') },
      { id: 'D9', verdict: 'question', sha: null, line: expect.stringContaining('[D9]') },
      { id: 'D12', verdict: null, sha: null, line: null },
    ]);
  });

  it('reads the verdict after the source, so a claim holding a verdict word is not misread', () => {
    const report = [
      '[D9] A marker skipped for a duplicate id never takes over when the holder leaves (scour): fixed 3c67d8e86c',
      '[D15] The duplicate-marker check reads the id only at registration (scour): not a defect: it rereads on change',
      '[D4] a duplicate key is not fixed by a reload: fixed 1a2b3c4d',
    ].join('\n');
    expect(scourVerdictsOf(report, ['D9', 'D15', 'D4']).map((v: { verdict: string }) => v.verdict)).toEqual(['fixed', 'not a defect', 'fixed']);
    expect(whyOf({ verdict: 'not a defect', line: report.split('\n')[1] })).toBe('it rereads on change');
  });
});

describe("a fix shelf's statuses", () => {
  it("takes each defect's latest verdict, and marks a batch out with no record yet as fixing", () => {
    const runs = [
      { n: 1, jobs: ['core~b2'], record: { area: 'core', finished: 'x', batches: [{ n: 2, branch: 'scour1-core-b2', verify: { ok: true }, verdicts: [{ id: 'D4', verdict: 'fixed' }, { id: 'D5', verdict: null }] }] } },
      { n: 2, jobs: ['core~b1', 'other~b1'], record: null },
    ];
    expect(fixStatusesFor({ area: 'core' }, runs)).toEqual({
      D4: { status: 'fixed', run: 1, branch: 'scour1-core-b2', verified: true },
      D5: { status: 'unread', run: 1, branch: 'scour1-core-b2', verified: true },
      b1: { status: 'fixing', run: 2, branch: null },
    });
  });
});

describe("a fresh ledger's statuses", () => {
  it('leaves out runs on an earlier ledger of the area, whose ids name other defects', () => {
    const runs = [
      { n: 21, jobs: [], record: { area: 'scale', ledgerCommit: 'old', started: 'a', finished: 'b', batches: [{ n: 1, branch: 'x', verify: { ok: true }, verdicts: [{ id: 'D1', verdict: 'fixed' }] }] } },
      { n: 24, jobs: [], record: { area: 'scale', ledgerCommit: 'new', started: 'c', finished: 'd', batches: [{ n: 1, branch: 'y', verify: { ok: true }, verdicts: [{ id: 'D2', verdict: 'fixed' }] }] } },
    ];
    expect(Object.keys(fixStatusesFor({ area: 'scale', commit: 'new' }, runs))).toEqual(['D2']);
    expect(Object.keys(fixStatusesFor({ area: 'scale', commit: 'old' }, runs))).toEqual(['D1']);
    expect(lastFixRunOf({ area: 'scale', commit: 'old' }, runs)?.n).toBe(21);
  });
});

describe("a verdict's reason", () => {
  it('reads what the line says after its verdict, keeping a parenthesis that qualifies it', () => {
    expect(whyOf({ verdict: 'not a defect', line: '[D30] steps over an item (scour): not a defect. The line between events is a guess.' }))
      .toBe('The line between events is a guess.');
    expect(whyOf({ verdict: 'not a defect', line: '[D7] cursor (scour): not a defect (no longer applies). Commit abc filters it.' }))
      .toBe('(no longer applies). Commit abc filters it.');
    expect(whyOf({ verdict: 'question', line: '[D9] question — whether a hold cancels the drag' })).toBe('whether a hold cancels the drag');
    expect(whyOf({ verdict: 'not a defect', line: '[D2] x (scour): not a defect' })).toBeNull();
    expect(whyOf({ verdict: 'fixed', line: '[D3] x: fixed 1a2b3c4 — clamps it' })).toBeNull();
  });

  it('rides on the status', () => {
    const runs = [{ n: 1, jobs: [], record: { area: 'core', finished: 'x', batches: [{ n: 1, branch: null, verify: { ok: true }, verdicts: [{ id: 'D1', verdict: 'not a defect', line: '[D1] y (scour): not a defect: it is deliberate.' }] }] } }];
    expect(fixStatusesFor({ area: 'core' }, runs).D1).toEqual({ status: 'not a defect', run: 1, branch: null, verified: true, why: 'it is deliberate.' });
  });
});

describe("a ledger's last flush", () => {
  it('is the latest fix run on the area, finished or not, and none for an area no run touched', () => {
    const runs = [
      { n: 1, jobs: ['core~b1'], record: { area: 'core', started: 'a', finished: 'b' } },
      { n: 2, jobs: ['other~b1'], record: { area: 'other', started: 'c', finished: null } },
      { n: 3, jobs: ['core~b2'], record: null },
    ];
    expect(lastFixRunOf({ area: 'core' }, runs)).toEqual({ n: 3, started: null, finished: null });
    expect(lastFixRunOf({ area: 'other' }, runs)).toEqual({ n: 2, started: 'c', finished: null });
    expect(lastFixRunOf({ area: 'ui' }, runs)).toBeNull();
  });
});

describe('flags', () => {
  it('adds ids to an area in order, clears them, and drops an area left with none', () => {
    const one = withFlags({}, 'core', ['D10', 'D9']);
    expect(one).toEqual({ core: ['D9', 'D10'] });
    expect(withFlags(one, 'core', ['D9'], true)).toEqual({ core: ['D10'] });
    expect(withFlags(one, 'core', ['D9', 'D10'], true)).toEqual({});
  });
});
