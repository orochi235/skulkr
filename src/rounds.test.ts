import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { areasInFlight, chapman, inheritPasses, isSettled, nextRound, pickAreas, readPasses, incompleteByRound, scaledOf, withBatchPasses } from './rounds.mjs';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A repo root holding `docs/audits/round-<N>/<id>/area.json` for each pass. */
const fixture = (passes: { round: number; id: string; distinct: number; files: string[]; commit?: string; fixCommits?: string[]; incomplete?: string[] }[]) => {
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
    expect(nextRound({ branches: ['main', 'audit30-ui', 'batch/2026-11-17-audit33', 'skulkr'] })).toBe(34);
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
    const inFlight = areasInFlight(['audit37-b', 'audit37-core.animation', 'batch/2026-11-18-audit37', 'feature-x']);
    expect([...inFlight].sort()).toEqual(['b', 'core.animation']);
    const picked = pickAreas({ areas: ['a', 'b', 'c'].map((id) => area(id)), passes: new Map(), touched: never, count: 3, inFlight }).picked;
    expect(picked).toEqual(['a', 'c']);
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

describe('withBatchPasses', () => {
  const tree = {
    'b/new:docs/audits/round-5/ui/area.json': JSON.stringify({ id: 'ui', a: 2, b: 1, m: 1, distinct: 2, files: ['x.ts'] }),
    'b/new:docs/audits/round-4/ui/area.json': JSON.stringify({ id: 'ui', a: 9, b: 9, m: 9, distinct: 9 }),
    'b/new:docs/audits/round-5/gone/area.json': JSON.stringify({ id: 'gone', incomplete: ['B'] }),
  };
  const git = (...args: string[]) => {
    if (args[0] === 'show') return tree[args[1] as keyof typeof tree];
    const ref = args[3];
    return Object.keys(tree).filter((k) => k.startsWith(`${ref}:`)).map((k) => k.slice(ref.length + 1)).join('\n');
  };

  it("adds an unlanded batch's passes for rounds not on disk, in round order, skipping incomplete ones", () => {
    const passes = new Map([['ui', [{ round: 4, id: 'ui', distinct: 3 }]]]);
    withBatchPasses(passes, git, 'docs/audits', ['b/new']);
    expect(passes.get('ui')!.map((p) => [p.round, p.distinct])).toEqual([[4, 3], [5, 2]]);
    expect(passes.has('gone')).toBe(false);
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
    expect([...incompleteByRound(root, 'docs/audits')]).toEqual([[56, 2]]);
    expect(readPasses(root, 'docs/audits').get('ui')!.map((p) => p.round)).toEqual([55]);
  });
});
