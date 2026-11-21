import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { gitIn } from './batch.mjs';
import { churnSince, commitsAfter, parseNumstat, reachedBy } from './churn.mjs';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A repository whose commits each write `files` (path → line count), answering each commit's sha. */
const repo = () => {
  const root = mkdtempSync(join(tmpdir(), 'skulkr-churn-'));
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
    const { lines, touched } = churnSince(gitIn(root), entries, { keep, cacheKey: 'src', cacheFile, root });
    // a: the third commit rewrote 2 lines into 4 (2 deleted, 4 added); the fix is not counted.
    expect(Object.fromEntries(lines)).toEqual({ a: 6, b: 4, late: 6, lost: 0 });
    expect(Object.fromEntries(touched)).toEqual({ a: ['src/a.ts'], b: ['src/b.ts'], late: ['src/a.ts'], lost: null });
    expect(existsSync(cacheFile)).toBe(true);
    const cached = JSON.parse(readFileSync(cacheFile, 'utf8'));
    expect(cached.key).toBe('src');
    expect(Object.keys(cached.commits)).toHaveLength(2);
    expect(Object.values(cached.commits).some((c) => 'docs/x.md' in (c as object))).toBe(false);
    // A second build reads the counts back rather than asking git for them.
    const noShow = (...args: string[]) => {
      if (args[0] === 'show') throw new Error('asked git for counts the cache holds');
      return gitIn(root)(...args);
    };
    expect(Object.fromEntries(churnSince(noShow, entries.slice(0, 2), { keep, cacheKey: 'src', cacheFile, root }).lines)).toEqual({ a: 6, b: 4 });
    // Counts kept under another filter are dropped, not read back: docs/ is counted once the filter takes it.
    const all = churnSince(gitIn(root), [{ id: 'docs', files: ['docs/x.md'], commit: pass, exclude: [] }], { cacheKey: 'all', cacheFile, root });
    expect(all.lines.get('docs')).toBe(50);
    expect(JSON.parse(readFileSync(cacheFile, 'utf8')).key).toBe('all');
  });

  it('names the files a later commit touched, a mode-only change included and fixes aside, and keeps the cache unpruned when asked', () => {
    const { root, run, commit } = repo();
    commit({ 'src/old.ts': 1 });
    const pass = commit({ 'src/a.ts': 1, 'src/b.ts': 1, 'src/c.ts': 1 });
    const fix = commit({ 'src/c.ts': 2 });
    run('update-index', '--chmod=+x', 'src/b.ts');
    run('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'mode');
    const cacheFile = join(root, '..', `${root.split('/').at(-1)}-cache`, 'churn.json');
    dirs.push(dirname(cacheFile));
    const files = ['src/c.ts', 'src/b.ts', 'src/a.ts'];
    const first = churnSince(gitIn(root), [{ id: 'x', files, commit: run('rev-parse', 'HEAD~3'), exclude: [] }], { cacheFile, root });
    expect(first.touched.get('x')).toEqual(['src/c.ts', 'src/b.ts', 'src/a.ts']);
    const kept = Object.keys(JSON.parse(readFileSync(cacheFile, 'utf8')).commits).length;
    const { lines, touched } = churnSince(gitIn(root), [{ id: 'x', files, commit: pass, exclude: [fix] }], { cacheFile, root, prune: false });
    expect(touched.get('x')).toEqual(['src/b.ts']);
    expect(lines.get('x')).toBe(0);
    expect(Object.keys(JSON.parse(readFileSync(cacheFile, 'utf8')).commits)).toHaveLength(kept);
  });

  it('reads numstat output and walks a commit graph', () => {
    expect(parseNumstat('@abc\n3\t1\tsrc/a.ts\n-\t-\timg.png\n@def\n1\t0\tsrc/b.ts\n')).toEqual({ abc: { 'src/a.ts': 4, 'img.png': 0 }, def: { 'src/b.ts': 1 } });
    const graph = new Map([['d', ['c', 'b']], ['c', ['a']], ['b', ['a']], ['a', []]]);
    expect(commitsAfter(graph, 'b').sort()).toEqual(['c', 'd']);
  });

  it('marks in one walk which of many commits reach each commit, past one word of bits', () => {
    // c39 → c38 → … → c0, newest first; c_i reaches every c_j with j <= i.
    const chain = Array.from({ length: 40 }, (_, i) => `c${39 - i}`);
    const graph = new Map(chain.map((sha, i) => [sha, i + 1 < chain.length ? [chain[i + 1]!] : []]));
    const from = [...chain].reverse();
    const { masks } = reachedBy(graph, from);
    const reaching = (sha: string) => from.filter((_, k) => masks.get(sha)![k >> 5]! & (1 << (k & 31)));
    expect(reaching('c0')).toHaveLength(40);
    expect(reaching('c35')).toEqual(['c35', 'c36', 'c37', 'c38', 'c39']);
    expect(reaching('c39')).toEqual(['c39']);
  });
});
