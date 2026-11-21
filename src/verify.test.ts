import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TIMED_OUT, failedFilesIn, failureExcerpt, fileCountsOf, isTestPath, needsGui, verdictOf, verifyLine, verifyLines } from './verify.mjs';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const jobOut = (files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), 'skulkr-verify-'));
  dirs.push(dir);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
};

// Round 57's `Bar` fixer read "Tests 1 passed" here and reported the file passing.
const TEARDOWN_THREW = [
  ' FAIL  |weasel-ui| packages/ui/src/components/Bar/Bar.test.tsx [ packages/ui/src/components/Bar/Bar.test.tsx ]',
  'Error: ResizeObserver loop completed with undelivered notifications.',
  '',
  ' Test Files  \x1b[31m1 failed\x1b[39m (1)',
  '      Tests  \x1b[32m1 passed\x1b[39m (1)',
].join('\n');

describe('verdictOf', () => {
  it('fails a file whose teardown threw, though every test in it passed', () => {
    const v = verdictOf('1\n', TEARDOWN_THREW);
    expect(v).toMatchObject({ ok: false, counts: { failed: 1, passed: 0, total: 1 }, why: '1 of 1 test files failed' });
    expect(v.failedFiles).toEqual(['packages/ui/src/components/Bar/Bar.test.tsx']);
  });

  it('fails on a failed file count even where the command exited 0', () => {
    expect(verdictOf('0', ' Test Files  1 failed | 2 passed (3)').ok).toBe(false);
  });

  it('passes on exit 0 with no failed file, and with no tests related at all', () => {
    expect(verdictOf('0', ' Test Files  3 passed (3)\n      Tests  12 passed (12)')).toMatchObject({ ok: true, counts: { failed: 0, passed: 3, total: 3 } });
    expect(verdictOf('0', 'No affected test files found')).toMatchObject({ ok: true, counts: undefined });
  });

  it('marks a run its alarm stopped as timed out, and one that left no exit as unrun', () => {
    expect(verdictOf(String(TIMED_OUT), '')).toMatchObject({ ok: false, timedOut: true, why: 'timed out' });
    expect(verdictOf('', '')).toMatchObject({ ok: false, unrun: true });
  });
});

describe('fileCountsOf and failedFilesIn', () => {
  it('read the last summary, and each failing file once', () => {
    const log = ' Test Files  1 failed (1)\n FAIL  a/x.test.ts > one\n FAIL  a/x.test.ts > two\n FAIL  b/y.pbt.test.ts > p\n Test Files  2 failed | 5 passed (7)';
    expect(fileCountsOf(log)).toEqual({ failed: 2, passed: 5, total: 7 });
    expect(failedFilesIn(log)).toEqual(['a/x.test.ts', 'b/y.pbt.test.ts']);
  });
});

describe('isTestPath', () => {
  it('tells a test file the runner names from a step or another file, by the pattern failing lines are read with', () => {
    for (const path of ['src/a.test.ts', 'packages/ui/src/Bar.browser.test.tsx', '@scope/x.spec.mjs']) {
      expect(isTestPath(path)).toBe(true);
      expect(failedFilesIn(` FAIL  ${path} > works`)).toEqual([path]);
    }
    for (const step of ['npm run check:x', 'src/a.ts', 'src/a.test.ts.snap', 'run src/a.test.ts']) expect(isTestPath(step)).toBe(false);
  });
});

describe('needsGui', () => {
  const verify = { command: 'run {files}', gui: { probe: 'list {related}', command: 'run-gui {files}' } };

  it('dispatches the GUI part when the probe lists a test file or fails, and not when it lists none', () => {
    expect(needsGui(verify, jobOut({ 'verify.files': 'a.ts', 'gui.exit': '0', 'gui.txt': '[browser] a/b.browser.test.tsx\n' }))).toBe(true);
    expect(needsGui(verify, jobOut({ 'verify.files': 'a.ts', 'gui.exit': '1', 'gui.txt': '' }))).toBe(true);
    expect(needsGui(verify, jobOut({ 'verify.files': 'a.ts', 'gui.exit': '0', 'gui.txt': '\n' }))).toBe(false);
  });

  it('without a probe, dispatches it for any changed file; without a GUI command, never', () => {
    expect(needsGui({ ...verify, gui: { command: 'run-gui' } }, jobOut({ 'verify.files': 'a.ts' }))).toBe(true);
    expect(needsGui({ command: 'run' }, jobOut({ 'verify.files': 'a.ts', 'gui.exit': '1' }))).toBe(false);
  });
});

describe('verifyLines', () => {
  it('checks the committed tree over the changed files, the command and probe bounded by an alarm', () => {
    const lines = verifyLines({ command: 'npx vitest related --run {files}', gui: { probe: 'npx vitest list {related}', command: 'x' }, timeoutMin: 3 }).join('\n');
    expect(lines).toContain('git reset -q --hard HEAD && git clean -qfd -e .skulkr/');
    expect(lines).toContain('git diff --name-only --diff-filter=d "$BASE..HEAD"');
    expect(lines).toContain(`alarm shift; exec @ARGV' 180 bash -c 'npx vitest related --run $VERIFY_FILES'`);
    expect(lines).toContain(`bash -c 'npx vitest list $VERIFY_RELATED' > .skulkr/out/gui.txt`);
  });
});

describe('failureExcerpt', () => {
  it('starts at the first failure and cuts a long middle', () => {
    const log = ['setup', 'more setup', ' FAIL  a.test.ts', ...Array.from({ length: 400 }, (_, i) => `line ${i}`)].join('\n');
    const excerpt = failureExcerpt(log);
    expect(excerpt.startsWith(' FAIL  a.test.ts'.trim())).toBe(true);
    expect(excerpt).toContain('lines cut');
    expect(excerpt.endsWith('line 399')).toBe(true);
  });
});

describe('verifyLines in bash', () => {
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

  it('passes the commits\' changed files, existing extras, and their --related form, and drops uncommitted edits first', () => {
    const tree = jobOut({});
    git(tree, 'init', '-q', '-b', 'main');
    writeFileSync(join(tree, 'a.ts'), '1');
    writeFileSync(join(tree, 'gone.ts'), '1');
    git(tree, 'add', '-A');
    git(tree, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'base');
    const base = git(tree, 'rev-parse', 'HEAD');
    writeFileSync(join(tree, 'a.ts'), '2');
    rmSync(join(tree, 'gone.ts'));
    git(tree, 'add', '-A');
    git(tree, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'fix');
    writeFileSync(join(tree, 'a.ts'), 'uncommitted');
    writeFileSync(join(tree, 'x.test.ts'), 'stray');
    git(tree, 'add', 'x.test.ts');
    const lines = verifyLines({ command: 'echo "files: {files}"; cat a.ts; echo; exit 3', gui: { probe: 'echo {related}', command: 'x' } });
    const script = ['mkdir -p .skulkr/out', 'set +e', ...lines].join('\n');
    execFileSync('bash', ['-c', script], { cwd: tree, env: { ...process.env, BASE: base, VERIFY_EXTRA: 'a.ts missing.test.ts' } });
    const out = (f: string) => readFileSync(join(tree, '.skulkr/out', f), 'utf8').trim();
    expect(out('verify.exit')).toBe('3');
    expect(out('verify.log')).toBe('files: a.ts\n2');
    expect(out('gui.txt')).toBe('--related=a.ts');
    expect(existsSync(join(tree, 'x.test.ts'))).toBe(false);
  });
});

describe('verifyLine', () => {
  it('counts the areas that passed at once and names the rest by how they ended', () => {
    const areas = [
      { id: 'a', verify: { ok: true, repairs: 0 } }, { id: 'b', verify: { ok: true, repairs: 0 } }, { id: 'c', verify: { ok: true, repairs: 1 } },
      { id: 'd', verify: { ok: false, timedOut: true, repairs: 0 } }, { id: 'e', verify: { ok: false, repairs: 2 } }, { id: 'f' },
    ];
    expect(verifyLine(areas)).toBe('verify: 2 passed, 1 passed after repair (c), 1 timed out unverified (d), 1 left out failing (e)');
    expect(verifyLine([{ id: 'f' }])).toBe('');
  });
});
