import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { gitIn } from './batch.mjs';
import { churnSince, commitsAfter, parseNumstat } from './churn.mjs';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A repository whose commits each write `files` (path → line count), answering each commit's sha. */
const repo = () => {
  const root = mkdtempSync(join(tmpdir(), 'skulk-churn-'));
  dirs.push(root);
  const run = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  run('init', '-q', '-b', 'main');
  const commit = (files: Record<string, number>) => {
    for (const [path, lines] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), Array.from({ length: lines }, (_, i) => `line ${i} ${Math.random()}`).join('\n') + '\n');
    }
    run('add', '-A');
    run('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'c');
    return run('rev-parse', 'HEAD');
  };
  return { root, run, commit };
};

describe('churnSince', () => {
  it('counts lines changed in each area\'s files since its pass, leaving out the pass\'s own fixes, cached', () => {
    const { root, commit } = repo();
    const pass = commit({ 'src/a.ts': 3, 'src/b.ts': 3 });
    const fix = commit({ 'src/a.ts': 2 });
    commit({ 'src/a.ts': 4, 'src/b.ts': 1, 'docs/x.md': 50 });
    const cacheFile = join(root, '..', `${root.split('/').at(-1)}-cache`, 'churn.json');
    dirs.push(dirname(cacheFile));
    const entries = [
      { id: 'a', files: ['src/a.ts'], commit: pass, exclude: [fix] },
      { id: 'b', files: ['src/b.ts'], commit: pass, exclude: [] },
      { id: 'late', files: ['src/a.ts'], commit: fix, exclude: [] },
      { id: 'lost', files: ['src/a.ts'], commit: 'f'.repeat(40), exclude: [] },
    ];
    const keep = (p: string) => p.startsWith('src/');
    const lines = churnSince(gitIn(root), entries, { keep, cacheFile, root });
    // a: the third commit rewrote 2 lines into 4 (2 deleted, 4 added); the fix is not counted.
    expect(Object.fromEntries(lines)).toEqual({ a: 6, b: 4, late: 6, lost: 0 });
    expect(existsSync(cacheFile)).toBe(true);
    const cached = JSON.parse(readFileSync(cacheFile, 'utf8'));
    expect(Object.keys(cached)).toHaveLength(2);
    expect(Object.values(cached).some((c) => 'docs/x.md' in (c as object))).toBe(false);
    // A second build reads the counts back rather than asking git for them.
    const noShow = (...args: string[]) => {
      if (args[0] === 'show') throw new Error('asked git for counts the cache holds');
      return gitIn(root)(...args);
    };
    expect(Object.fromEntries(churnSince(noShow, entries.slice(0, 2), { keep, cacheFile, root }))).toEqual({ a: 6, b: 4 });
  });

  it('reads numstat output and walks a commit graph', () => {
    expect(parseNumstat('@abc\n3\t1\tsrc/a.ts\n-\t-\timg.png\n@def\n1\t0\tsrc/b.ts\n')).toEqual({ abc: { 'src/a.ts': 4, 'img.png': 0 }, def: { 'src/b.ts': 1 } });
    const graph = new Map([['d', ['c', 'b']], ['c', ['a']], ['b', ['a']], ['a', []]]);
    expect(commitsAfter(graph, 'b').sort()).toEqual(['c', 'd']);
  });
});
