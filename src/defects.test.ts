import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { areaDefects, commitSubjects, defectsFor, foldDuplicates, openItems } from './defects.mjs';
import { reportItems } from './findings.mjs';
import { weaselConfig } from '../test/weaselConfig.ts';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'skulkr-defects-')); dirs.push(d); return d; };
const put = (file: string, text: string) => { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, text); };

/** A record as `recordFiles.mjs` reads one: its `area.json` from `area`, its other files from `files`. */
const record = (round: number, id: string, area: Record<string, unknown>, files: Record<string, string> = {}, ref?: string) => {
  const all: Record<string, string> = { 'area.json': JSON.stringify({ id, a: 1, b: 1, m: 1, distinct: 1, ...area }), ...files };
  return { round, id, read: (f: string) => all[f] ?? null, ...(ref ? { ref } : {}) };
};
const night = (state: string, name: string, id: string, match: unknown) =>
  put(join(state, 'nights', name, 'areas', id, 'match.json'), JSON.stringify(match));

describe('areaDefects', () => {
  it('refuses an id not in the partition, so a path in it reads nothing', () => {
    const root = tmp(), state = tmp();
    put(join(root, 'secret/fix.md'), 'A thing breaks (A): fixed 1a2b3c4d.');
    const cfg = { ...weaselConfig(state), record: { dir: 'docs/audits', dirs: ['docs/audits'] }, partition: { path: 'docs/audits/partition.json' } };
    expect(() => defectsFor(cfg, root, '../../secret', [{ id: 'x', files: [] }], () => '')).toThrow(/no area named/);
    expect(defectsFor(cfg, root, 'x', [{ id: 'x', files: [] }], () => '')).toEqual([]);
  });

  it("reads a recorded round's report, and a round with no record from its night, open until its fixer reports", () => {
    const state = tmp();
    const records = [record(46, 'x', { files: ['x/a.ts'] }, { 'fix.md': 'A thing breaks (A): fixed 1a2b3c4d. It no longer does.' })];
    night(state, '2026-11-20T00-00-00-000Z-round47', 'x', { pairs: [[1, 0]], a: ['one', 'two'], b: ['two too', 'three'] });
    expect(areaDefects({ records, areas: [{ id: 'x', files: ['x/a.ts'] }], id: 'x', state })).toEqual([
      { round: 47, recorded: false, fixed: false, items: [
        { claim: 'two', from: 'A+B', verdict: 'open', note: '' }, { claim: 'one', from: 'A', verdict: 'open', note: '' },
        { claim: 'three', from: 'B', verdict: 'open', note: '' },
      ] },
      { round: 46, recorded: true, fixed: true, items: [{ claim: 'A thing breaks', from: 'A', verdict: 'fixed', note: 'It no longer does.' }] },
    ]);
    expect(openItems({})).toEqual([]);
    expect(commitSubjects('From 1a2b Mon Sep 17 00:00:00 2001\nSubject: [PATCH 1/2] keep a lone min\n bound\n\nbody\nFrom 3c4d Mon\nSubject: [PATCH 2/2] draw a choice\n')).toEqual(['keep a lone min bound', 'draw a choice']);
  });

  it("reads a report giving no verdict, a usage limit's refusal written in its place, as no report", () => {
    const state = tmp();
    night(state, '2026-11-24T00-00-00-000Z-round83', 'x', { pairs: [], a: ['one'], b: [] });
    put(join(state, 'nights', '2026-11-24T00-00-00-000Z-round83', 'areas', 'x', 'fix.md'), "You've hit your 5-hour limit · resets 6:30pm (America/New_York)");
    expect(areaDefects({ records: [], areas: [{ id: 'x', files: ['x/a.ts'] }], id: 'x', state })).toEqual([
      { round: 83, recorded: false, fixed: false, items: [{ claim: 'one', from: 'A', verdict: 'open', note: '' }] },
    ]);
  });

  it("lists a round's findings before its match: a finished reviewer's file, else what its log says so far", () => {
    const state = tmp();
    const jobs = join(state, 'nights', '2026-11-25T00-00-00-000Z-round88', 'jobs', 'x');
    put(join(jobs, 'A.log'), 'onto: progress 1/3\nskulkr: finding {"claim":"Drops an event","where":"x/a.ts:1"}\nskulkr: finding {"claim":"Drops an event","where":"x/a.ts:1"}\nskulkr: finding {broken\n');
    put(join(jobs, 'B.log'), 'onto: progress 3/3\n');
    put(join(jobs, 'B', 'findings.md'), '## Leaks a timer\n- where: x/b.ts:9\n\n## Files read\n- x/b.ts\n');
    expect(areaDefects({ records: [], areas: [{ id: 'x', files: ['x/a.ts'] }], id: 'x', state })).toEqual([
      { round: 88, recorded: false, fixed: false, reviewing: true, items: [
        { claim: 'Drops an event', from: 'A', verdict: 'reviewing', note: '' }, { claim: 'Leaks a timer', from: 'B', verdict: 'reviewing', note: '' },
      ] },
    ]);
  });

  it('follows its files across a recut, and reads no night of an abandoned round or of one with a record', () => {
    const state = tmp();
    const match = (claim: string) => ({ 'match.json': JSON.stringify({ pairs: [], a: [claim], b: [] }) });
    const records = [
      // The old area's pass read all of the new one's files: a covering round, recorded under the old id.
      record(36, 'old', { files: ['n/a.ts', 'n/b.ts', 'o/c.ts'] }, match('from the old area')),
      // A pass that read one of its four files does not stand for it.
      record(37, 'other', { files: ['n/a.ts', 'z/z.ts'] }, match('from a neighbor')),
      record(38, 'new', { fixOnly: true }, match('a fix-only round of its own id')),
      record(40, 'new', { files: ['n/a.ts', 'n/b.ts', 'n/d.ts', 'n/e.ts'] }, match('on a batch'), 'batch/2026-11-21-audit40'),
    ];
    night(state, '2026-11-21T00-00-00-000Z-round40', 'new', { a: ['the night of a recorded round'] });
    night(state, '2026-11-21T01-00-00-000Z-round41', 'new', { a: ['given up'] });
    put(join(state, 'nights', '2026-11-21T01-00-00-000Z-round41', 'abandoned'), 'stopped');
    night(state, '2026-11-21T02-00-00-000Z-round42', 'new', { a: ['not landed yet'] });
    const areas = [{ id: 'new', files: ['n/a.ts', 'n/b.ts', 'n/d.ts', 'n/e.ts'] }];
    const got = areaDefects({ records, areas, id: 'new', state });
    expect(got.map((r: any) => [r.round, r.recorded, r.items.map((i: any) => i.claim)])).toEqual([
      [42, false, ['not landed yet']],
      [40, false, ['on a batch']],
      [38, true, ['a fix-only round of its own id']],
      [36, true, ['from the old area']],
    ]);
  });
});

describe('foldDuplicates', () => {
  it("folds a duplicate line into the finding it repeats, by their shared commit or else its words, as both reviewers'", () => {
    const report = [
      '- The cursor stays after a gesture ends (A) — fixed 788913d82c',
      '- The same stuck cursor (B) — duplicate of the cursor finding from A, fixed 788913d82c',
      '- Immediate params drop `bodyKind` (A) — fixed 59e717f8f4',
      '- `heldPointer` is read once at attach (B) — fixed 9ba4de092a',
      '- Wrong reason in the doc (A) — fixed 1a242656a6',
      '- Params drop it for some kinds (B) — duplicate of the `bodyKind` finding from A',
    ].join('\n');
    expect(foldDuplicates(reportItems(report, { shas: true })).map((i: any) => [i.from, i.claim])).toEqual([
      ['A+B', 'The cursor stays after a gesture ends'],
      ['A+B', 'Immediate params drop `bodyKind`'],
      ['B', '`heldPointer` is read once at attach'],
      ['A', 'Wrong reason in the doc'],
    ]);
  });
});
