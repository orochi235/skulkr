import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { gitIn } from './batch.mjs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { weaselConfig } from '../test/weaselConfig.ts';
import { areaStats, areasInFlight, areasInFlightFor, calibrationFor, chapman, drawnRoundOf, inheritPasses, lastPassIn, isSettled, nextRound, pickAreas, readPasses, incompleteByRound, scaledOf } from './rounds.mjs';
import { diskRecords } from './recordFiles.mjs';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A repo root holding `docs/audits/round-<N>/<id>/area.json` for each pass. */
const fixture = (passes: { round: number; id: string; distinct: number; files: string[]; commit?: string; fixCommits?: string[]; incomplete?: string[]; fixOnly?: boolean }[]) => {
  const root = mkdtempSync(join(tmpdir(), 'skulkr-'));
  dirs.push(root);
  for (const { round, ...pass } of passes) {
    const dir = join(root, 'docs/audits', `round-${round}`, pass.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'area.json'), JSON.stringify({ commit: `c${round}`, fixCommits: [], ...pass }));
  }
  return root;
};

describe('chapman', () => {
  it('is (a+1)(b+1)/(m+1) − 1', () => {
    expect(chapman(10, 8, 4)).toBeCloseTo(18.8);
    expect(chapman(0, 0, 0)).toBe(0);
    expect(chapman(3, 3, 3)).toBe(3);
  });
});

describe('nextRound', () => {
  it('follows the highest number used by a round directory, the hardening record, or a branch', () => {
    expect(nextRound({ roundDirs: ['round-12', 'partition.json'] })).toBe(13);
    expect(nextRound({ hardening: '| rounds 28–30; method below |\n| (audit round 15) |' })).toBe(31);
    expect(nextRound({ branches: ['main', 'audit30-ui', 'batch/2026-11-17-audit33', 'skulkr'], roundIn: weaselConfig().names.roundIn })).toBe(34);
    expect(nextRound({ roundDirs: ['round-12'], claimed: ['14', '13'] })).toBe(15);
    expect(nextRound({})).toBe(1);
  });
});

describe('pickAreas', () => {
  const area = (id: string, files = [`${id}.ts`]) => ({ id, files });
  const never = () => false;

  it('takes never-audited areas first in partition order, then the longest since their last pass', () => {
    const root = fixture([
      { round: 31, id: 'b', distinct: 5, files: ['b.ts'] },
      { round: 32, id: 'a', distinct: 5, files: ['a.ts'] },
    ]);
    const picked = pickAreas({ areas: ['a', 'b', 'c', 'd'].map((id) => area(id)), passes: readPasses(root, 'docs/audits'), touched: never, count: 3 }).picked;
    expect(picked).toEqual(['c', 'd', 'b']);
  });

  it('skips an area an unlanded round still holds on an audit branch', () => {
    const inFlight = areasInFlight(['audit37-b', 'audit37-core.animation', 'batch/2026-11-18-audit37', 'feature-x'], weaselConfig().names.branchOf);
    expect([...inFlight].sort()).toEqual(['b', 'core.animation']);
    const picked = pickAreas({ areas: ['a', 'b', 'c'].map((id) => area(id)), passes: new Map(), touched: never, count: 3, inFlight }).picked;
    expect(picked).toEqual(['a', 'c']);
  });

  it("asks git for the branches main has not merged, under the config's names", () => {
    const cfg = weaselConfig();
    const asked: string[][] = [];
    const git = (...args: string[]) => (asked.push(args), 'audit37-b\nbatch/2026-11-18-audit37\n');
    expect([...areasInFlightFor(cfg, git)]).toEqual(['b']);
    expect(asked[0]).toContain(`--no-merged=${cfg.git.main}`);
  });

  it('picks an area again as never audited when its only pass had a reviewer that never ran', () => {
    const root = fixture([
      { round: 31, id: 'a', distinct: 0, files: ['a.ts'] },
      { round: 34, id: 'b', distinct: 7, files: ['b.ts'], incomplete: ['B'] },
    ]);
    const passes = readPasses(root, 'docs/audits');
    expect(passes.has('b')).toBe(false);
    expect(pickAreas({ areas: [area('a'), area('b')], passes, touched: never, count: 1 }).picked).toEqual(['b']);
  });

  it('reads no pass from a fix-only round, which ran no reviewers', () => {
    const root = fixture([
      { round: 31, id: 'a', distinct: 3, files: ['a.ts'] },
      { round: 35, id: 'a', distinct: 0, files: ['a.ts'], fixOnly: true },
    ]);
    expect(readPasses(root, 'docs/audits').get('a')!.map((p: any) => p.round)).toEqual([31]);
  });

  it('skips an area settled by two quiet passes on unchanged files, until its files change', () => {
    const root = fixture([
      { round: 31, id: 'a', distinct: 1, files: ['a.ts'] },
      { round: 32, id: 'a', distinct: 0, files: ['a.ts'] },
    ]);
    const passes = readPasses(root, 'docs/audits');
    expect(pickAreas({ areas: [area('a')], passes, touched: never, count: 5 })).toEqual({ picked: [], settled: ['a'] });
    expect(pickAreas({ areas: [area('a')], passes, touched: () => true, count: 5 }).picked).toEqual(['a']);
  });

  it('does not settle on one quiet pass, a loud pass, or a changed file list', () => {
    const passes = readPasses(fixture([
      { round: 31, id: 'one', distinct: 0, files: ['one.ts'] },
      { round: 31, id: 'loud', distinct: 2, files: ['loud.ts'] },
      { round: 32, id: 'loud', distinct: 0, files: ['loud.ts'] },
      { round: 31, id: 'moved', distinct: 0, files: ['moved.ts'] },
      { round: 32, id: 'moved', distinct: 0, files: ['moved.ts'] },
    ]), 'docs/audits');
    const areas = [area('one'), area('loud'), area('moved', ['moved.ts', 'new.ts'])];
    expect(pickAreas({ areas, passes, touched: never, count: 5 }).settled).toEqual([]);
  });

  it('does not settle, or throw, on two quiet passes that recorded no file list', () => {
    const passes = new Map([['a', [{ round: 31, id: 'a', distinct: 0 }, { round: 32, id: 'a', distinct: 0 }]]]);
    expect(pickAreas({ areas: [area('a')], passes, touched: never, count: 5 })).toEqual({ picked: ['a'], settled: [] });
  });

  it('ignores the passes\' own fix commits when asking whether files changed', () => {
    const passes = readPasses(fixture([
      { round: 31, id: 'a', distinct: 1, files: ['a.ts'], commit: 'base', fixCommits: ['fix1'] },
      { round: 32, id: 'a', distinct: 0, files: ['a.ts'] },
    ]), 'docs/audits');
    const seen: unknown[] = [];
    isSettled(area('a'), passes.get('a'), (files: string[], from: string, exclude: string[]) => (seen.push({ files, from, exclude }), false));
    expect(seen).toEqual([{ files: ['a.ts'], from: 'base', exclude: ['fix1'] }]);
  });
});

describe('inheritPasses', () => {
  const pass = (round: number, id: string, files: string[], est = 10, left = 4) => ({ round, id, files, a: 3, b: 3, m: 1, distinct: 5, chapman: est, unfound: left });

  it('keeps a renamed area\'s whole history and gives a split area\'s parts their shares', () => {
    const raw = new Map([
      ['old', [pass(1, 'old', ['x/1.ts', 'x/2.ts', 'x/3.ts', 'x/4.ts'])]],
      ['gone', [pass(2, 'gone', ['y/1.ts', 'y/2.ts'])]],
    ]);
    const areas = [
      { id: 'renamed', files: ['x/1.ts', 'x/2.ts', 'x/3.ts', 'x/4.ts'] },
      { id: 'left', files: ['y/1.ts', 'z/9.ts', 'z/8.ts'] },
      { id: 'right', files: ['y/2.ts'] },
      { id: 'new', files: ['n/1.ts'] },
    ];
    const { history, covered } = inheritPasses(areas, raw);
    expect(history.get('renamed')!.map((p) => [p.round, p.share])).toEqual([[1, 1]]);
    expect(history.get('left')!.map((p) => [p.id, p.share])).toEqual([['gone', 0.5]]);
    expect(scaledOf(history.get('left')![0]!)).toEqual({ chapman: 5, unfound: 2 });
    expect(history.get('new')).toEqual([]);
    expect(Object.fromEntries(covered)).toEqual({ renamed: 1, left: 1 / 3, right: 1, new: 0 });
  });

  it('gives a pass with no file list to the area of its own id', () => {
    const { history } = inheritPasses([{ id: 'a', files: ['a/1.ts'] }], new Map([['a', [{ ...pass(1, 'a', []), files: undefined }]]]));
    expect(history.get('a')!.map((p) => p.share)).toEqual([1]);
  });
});

describe('pickAreas with churn', () => {
  const area = (id: string) => ({ id, files: [`${id}/x.ts`] });
  const pass = (round: number, id: string) => ({ round, id, files: [`${id}/x.ts`], distinct: 5, commit: 'c', fixCommits: [] });
  it('puts never-audited areas first, then the most lines changed, then the oldest pass', () => {
    const passes = new Map([['a', [pass(3, 'a')]], ['b', [pass(1, 'b')]], ['c', [pass(2, 'c')]], ['d', [pass(4, 'd')]], ['e', [pass(5, 'e')]]]);
    const covered = new Map([['e', 0.2]]);
    const staleLines = new Map([['a', 40], ['d', 400]]);
    const { picked } = pickAreas({ areas: ['a', 'b', 'c', 'd', 'e', 'f'].map(area), passes, covered, staleLines, touched: () => true, count: 9 });
    expect(picked).toEqual(['e', 'f', 'd', 'a', 'b', 'c']);
  });
});

describe('pickAreas by corrected defects left', () => {
  const area = (id: string) => ({ id, files: [`${id}/x.ts`] });
  const pass = (round: number, id: string, a: number, b: number, m: number, distinct: number) =>
    ({ round, id, a, b, m, distinct, files: [`${id}/x.ts`], commit: 'c', fixCommits: [] });

  it('ranks due areas by what their last pass left, then lines changed, then the oldest pass; a changed area with nothing left still competes', () => {
    const passes = new Map([
      ['x', [pass(5, 'x', 4, 4, 1, 7)]], // left 4.5
      ['y', [pass(6, 'y', 2, 2, 2, 2)]], // left 0, its files changed since
      ['z', [pass(7, 'z', 2, 2, 1, 3)]], // left 0.5
      ['w', [pass(2, 'w', 2, 2, 2, 2)]],
      ['v', [pass(3, 'v', 2, 2, 2, 2)]],
    ]);
    const staleLines = new Map([['y', 300]]);
    const { picked } = pickAreas({ areas: ['v', 'w', 'x', 'y', 'z', 'new'].map(area), passes, staleLines, touched: () => true, count: 9 });
    expect(picked).toEqual(['new', 'x', 'y', 'z', 'w', 'v']);
  });

  it("scales each area's left by its shared bucket's factor", () => {
    const passes = new Map([['q', [pass(1, 'q', 2, 2, 1, 3)]], ['r', [pass(1, 'r', 6, 6, 3, 9)]]]); // left 0.5 and 2.3
    const bucket = (factor: number) => ({ pairs: 9, predicted: 1, found: factor, factor });
    const calibration = { minPairs: 5, pairs: [], series: [], factors: { overall: bucket(1), byShared: { '0': bucket(1), '1–2': bucket(10), '3+': bucket(1) } } };
    expect(pickAreas({ areas: [area('r'), area('q')], passes, calibration, touched: () => true, count: 2 }).picked).toEqual(['q', 'r']);
    expect(pickAreas({ areas: [area('r'), area('q')], passes, touched: () => true, count: 2 }).picked).toEqual(['r', 'q']);
  });
});

describe('history by round', () => {
  const pass = (round: number, id: string, files: string[], a: number, b: number, m: number, distinct: number, extra = {}) =>
    ({ round, id, files, a, b, m, distinct, commit: `c${round}`, fixCommits: [], ...extra });

  it("neither ranks nor calibrates an area by a later pass that read only a boundary file of it", () => {
    const raw = new Map([
      ['x', [pass(10, 'x', ['x/1.ts', 'x/2.ts', 'x/3.ts'], 12, 12, 1, 23)]], // left 60.5
      ['y', [pass(11, 'y', ['y/1.ts', 'y/2.ts', 'y/3.ts', 'y/4.ts'], 0, 0, 0, 0)]],
      ['z', [pass(9, 'z', ['z/1.ts'], 3, 3, 1, 5)]], // left 2
    ]);
    const areas = [{ id: 'x', files: ['x/1.ts', 'x/2.ts', 'x/3.ts', 'y/4.ts'] }, { id: 'z', files: ['z/1.ts'] }];
    const { history, covered } = inheritPasses(areas, raw);
    expect(history.get('x')!.map((p) => p.round)).toEqual([10, 11]);
    expect(pickAreas({ areas, passes: history, covered, touched: () => true, count: 2 }).picked).toEqual(['x', 'z']);
    expect(calibrationFor(history).pairs).toEqual([]);
    expect(lastPassIn(history.get('x'))!.round).toBe(10);
  });

  it('takes two passes of one round in a merged area as one: left summed, fixes joined, no pair between them', () => {
    const raw = new Map([
      ['p', [pass(5, 'p', ['p/1.ts'], 3, 3, 1, 5, { chapman: 7, unfound: 2, fixCommits: ['f1'] })]],
      ['q', [pass(5, 'q', ['q/1.ts'], 3, 3, 1, 5, { chapman: 7, unfound: 2, fixCommits: ['f2'] })]],
    ]);
    const { history } = inheritPasses([{ id: 'pq', files: ['p/1.ts', 'q/1.ts'] }], raw);
    const last = lastPassIn(history.get('pq'))!;
    expect([last.unfound, last.fixCommits]).toEqual([4, ['f1', 'f2']]);
    expect(drawnRoundOf(history.get('pq')!)).toMatchObject({ round: 5, distinct: 10, est: 14, left: 4 });
    expect(calibrationFor(history).pairs).toEqual([]);
  });
});

describe('areaStats', () => {
  it("gives each pair of passes the lines changed from the first to the second, the first's fixes aside", () => {
    const root = mkdtempSync(join(tmpdir(), 'skulkr-stats-'));
    dirs.push(root);
    const home = process.env.HOME;
    process.env.HOME = root;
    try {
      const run = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
      run('init', '-q', '-b', 'main');
      const commit = (lines: number) => {
        writeFileSync(join(root, 'a.ts'), Array.from({ length: lines }, (_, i) => `line ${i} ${Math.random()}`).join('\n') + '\n');
        run('add', '-A');
        run('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'c');
        return run('rev-parse', 'HEAD');
      };
      const first = commit(3);
      const fix = commit(2);
      const second = commit(4);
      commit(1);
      const raw = new Map([['a', [
        { round: 1, id: 'a', a: 1, b: 1, m: 1, distinct: 1, files: ['a.ts'], commit: first, fixCommits: [fix] },
        { round: 2, id: 'a', a: 1, b: 1, m: 1, distinct: 1, files: ['a.ts'], commit: second, fixCommits: [] },
      ]]]);
      const cfg = { name: 'stats-test', partition: { isSource: () => true } };
      const { staleLines, pairLines, touched } = areaStats(cfg, gitIn(root), [{ id: 'a', files: ['a.ts'] }], raw, root);
      // From the first pass: 2 deleted and 4 added by the second's commit; the fix's 5 lines are left out.
      expect(Object.fromEntries(pairLines)).toEqual({ 'a\n1': 6 });
      expect(Object.fromEntries(staleLines)).toEqual({ a: 5 });
      // isSettled asks whether anything but the two passes' fixes touched its files since the first: the second's
      // commit did. It is answered from the same walk, so a range the walk did not take is refused.
      expect(touched(['a.ts'], first, [fix])).toBe(true);
      expect(() => touched(['a.ts'], second, [])).toThrow(/did not walk/);
    } finally {
      process.env.HOME = home;
    }
  });
});

describe('incompleteByRound', () => {
  it('counts the areas each round recorded incomplete, which readPasses leaves out', () => {
    const root = fixture([
      { round: 56, id: 'ui', distinct: 0, files: ['a.ts'], incomplete: ['A', 'B'] },
      { round: 56, id: 'theme', distinct: 0, files: ['b.ts'], incomplete: ['B'] },
      { round: 56, id: 'Badge', distinct: 13, files: ['c.ts'] },
      { round: 55, id: 'ui', distinct: 4, files: ['a.ts'] },
    ]);
    expect([...incompleteByRound(diskRecords(root, 'docs/audits'))]).toEqual([[56, 2]]);
    expect(readPasses(root, 'docs/audits').get('ui')!.map((p: { round: number }) => p.round)).toEqual([55]);
  });
});
