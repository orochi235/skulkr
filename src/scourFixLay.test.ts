import { describe, expect, it } from 'vitest';
import { commitsLaidAt, laidDefectsFor, mboxCommitsOf } from './scourFixLay.mjs';
import { trailerDefectsOf } from './progress.mjs';

const patch = (sha: string, subject: string, trailer: string, files: Record<string, string[]>) => [
  `From ${sha} Mon Sep 17 00:00:00 2001`,
  `Subject: [PATCH] ${subject}`,
  '',
  ...(trailer ? [trailer] : []),
  '---',
  ...Object.entries(files).flatMap(([f, added]) => [`diff --git a/${f} b/${f}`, `--- a/${f}`, `+++ b/${f}`, '@@ -1 +1 @@', ...added.map((l) => `+${l}`)]),
  '',
].join('\n');

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const mbox = [
  patch(A, 'travel a sweep to its release point', 'Defect: D12', { 'src/sweep.ts': ['const end = at(release);'], 'src/sweep.test.ts': ['it()'] }),
  patch(B, 'find items in shadow roots', 'Defect: D14, D3', { 'src/sweep.ts': ['for (let depth = 0; depth < 64; depth++) {'], 'src/elementAt.ts': ['x'] }),
].join('');

describe('a fix batch’s commits', () => {
  it('reads each commit’s trailer, files and added lines from an mbox', () => {
    const [a, b] = mboxCommitsOf(mbox);
    expect(a).toMatchObject({ sha: A, defects: ['D12'], files: ['src/sweep.ts', 'src/sweep.test.ts'] });
    expect(b).toMatchObject({ sha: B, defects: ['D14', 'D3'], files: ['src/sweep.ts', 'src/elementAt.ts'] });
    expect(b!.added.get('src/sweep.ts')).toEqual(['for (let depth = 0; depth < 64; depth++) {']);
  });

  it('reads a trailer however a commit command quotes its message', () => {
    expect(trailerDefectsOf('git commit -m "clamp it" -m "Defect: D7"')).toEqual(['D7']);
    expect(trailerDefectsOf("git commit -m $'clamp it\\n\\nDefects: D3, D7'")).toEqual(['D3', 'D7']);
    expect(trailerDefectsOf('git commit -m "clamp it"')).toEqual([]);
  });
});

describe('laying a failing file at commits', () => {
  const commits = mboxCommitsOf(mbox);
  const none = { files: new Set<string>(), packages: new Set<string>() };
  const at = (file: string, text: string, reach = none) => commitsLaidAt(file, { commits, text, tests: new Set(), blame: undefined, log: '', reach: () => reach });

  it('takes the commits that changed the failing file itself first', () => {
    expect(at('src/sweep.test.ts', 'src/sweep.ts: 64')).toEqual([A]);
  });

  it('takes the commit that added what the failure flags in a file over every commit changing that file', () => {
    expect(at('pkg/kit.test.ts', 'expected [] to equal ["src/sweep.ts: 64"]')).toEqual([B]);
  });

  it('falls back to a file the failure names, then to what the failing file reaches', () => {
    expect(at('pkg/kit.test.ts', 'scanned src/sweep.ts and found a cycle')).toEqual([A, B]);
    expect(at('pkg/kit.test.ts', 'no file named', { files: new Set(['src/elementAt.ts']), packages: new Set() })).toEqual([B]);
    expect(at('pkg/kit.test.ts', 'no file named', { files: new Set(), packages: new Set(['src']) })).toEqual([A, B]);
  });

  it('answers the defects of the commits laid at, or null where one names none', () => {
    const log = ' FAIL  pkg/kit.test.ts > numbers\nAssertionError: + "src/sweep.ts: 64"\n';
    expect(laidDefectsFor({ tree: '/nonexistent', failing: ['pkg/kit.test.ts'], log, commits, blame: undefined }))
      .toEqual({ defects: ['D14', 'D3'], commits: [B] });
    const untagged = commits.map((c) => ({ ...c, defects: [] }));
    expect(laidDefectsFor({ tree: '/nonexistent', failing: ['pkg/kit.test.ts'], log, commits: untagged, blame: undefined })).toBeNull();
  });
});
