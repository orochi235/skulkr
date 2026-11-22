import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { catchUpWithMain, commitRecord, gitIn, makeBatch, runGate } from './batch.mjs';
import { leftOutIn, leftOutWhy, recordLeftOut } from './leftOut.mjs';
import { resolveConfig } from './config.mjs';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A repo on `batch` branched from `main`, each with a commit of its own touching `file`s. */
const repo = (mainFile: string, batchFile: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'skulkr-batch-'));
  dirs.push(dir);
  const git = gitIn(dir);
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'skulkr@example.invalid');
  git('config', 'user.name', 'skulkr');
  const commit = (file: string, text: string) => {
    writeFileSync(join(dir, file), text);
    git('add', file);
    git('commit', '-q', '-m', `${file}: ${text}`);
  };
  commit('base.txt', 'base');
  git('checkout', '-q', '-b', 'batch');
  commit(batchFile, 'batch');
  git('checkout', '-q', 'main');
  commit(mainFile, 'main');
  git('checkout', '-q', 'batch');
  return { dir, git };
};

describe('catchUpWithMain', () => {
  it('merges a moved main into the batch and answers the new tip', () => {
    const { dir, git } = repo('main.txt', 'batch.txt');
    const caught = catchUpWithMain(dir);
    expect(caught).toEqual({ moved: true, tip: git('rev-parse', 'HEAD') });
    expect(git('merge-base', '--is-ancestor', 'main', 'HEAD')).toBe('');
  });

  it('answers not moved when the batch already holds main', () => {
    const { dir, git } = repo('main.txt', 'batch.txt');
    catchUpWithMain(dir);
    const tip = git('rev-parse', 'HEAD');
    expect(catchUpWithMain(dir)).toEqual({ moved: false });
    expect(git('rev-parse', 'HEAD')).toBe(tip);
  });

  it('merges two rounds\' ledger rows at one spot by appending the batch\'s to main\'s', () => {
    const { dir, git } = repo('base.txt', 'base.txt');
    git('reset', '-q', '--hard', 'HEAD~1');
    const table = (rows: string[]) => ['# Ledger', '', '## Record', '', '| round |', '| --- |', ...rows, '', '## After', ''].join('\n');
    const put = (text: string) => {
      writeFileSync(join(dir, 'ledger.md'), text);
      git('add', 'ledger.md');
      git('commit', '-q', '-m', 'ledger');
    };
    git('checkout', '-q', 'main');
    git('reset', '-q', '--hard', 'HEAD~1');
    put(table(['| 50 |']));
    git('checkout', '-q', '-B', 'batch');
    put(table(['| 50 |', '| 53 |']));
    git('checkout', '-q', 'main');
    put(table(['| 50 |', '| 51 |']));
    git('checkout', '-q', 'batch');
    const caught = catchUpWithMain(dir, 'main', { path: 'ledger.md', section: 'Record' });
    expect(caught.moved).toBe(true);
    expect(readFileSync(join(dir, 'ledger.md'), 'utf8')).toBe(table(['| 50 |', '| 51 |', '| 53 |']));
    expect(git('status', '--porcelain')).toBe('');
  });

  it('answers a merge that fails without conflicting as failed, with git\'s message', () => {
    const { dir } = repo('main.txt', 'batch.txt');
    expect(catchUpWithMain(dir, 'nowhere')).toEqual({ moved: false, failed: expect.stringMatching(/nowhere/) });
  });

  it('answers a conflict and leaves the batch as it was', () => {
    const { dir, git } = repo('same.txt', 'same.txt');
    const tip = git('rev-parse', 'HEAD');
    expect(catchUpWithMain(dir)).toEqual({ moved: false, conflict: true });
    expect(git('rev-parse', 'HEAD')).toBe(tip);
    expect(git('status', '--porcelain')).toBe('');
  });
});

const area = (id: string) => ({
  id, files: [`src/${id}/a.ts`], a: 2, b: 1, m: 1, distinct: 2, chapman: 2, unfound: 0, read: { A: 1, B: 1 }, patches: 1, questions: 0,
  jobs: { weightedTokens: 1e6, costUsd: 1.5 }, fixCommits: [],
});

/** A repo on main with a branch per name, each adding a file of its own. */
const branched = (names: string[]) => {
  const { dir, git } = repo('main.txt', 'batch.txt');
  git('checkout', '-q', 'main');
  git('branch', '-q', '-D', 'batch');
  const frozen = git('rev-parse', 'HEAD');
  for (const name of names) {
    git('checkout', '-q', '-b', name, frozen);
    writeFileSync(join(dir, `${name}.txt`), name);
    git('add', '.');
    git('commit', '-q', '-m', name);
  }
  git('checkout', '-q', 'main');
  return { dir, git, frozen };
};

/** A git hook in `git`'s repo. */
const hookIn = (git: (...a: string[]) => string, name: string, body: string) => {
  const dir = join(git('rev-parse', '--path-format=absolute', '--git-common-dir'), 'hooks');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
};

describe('makeBatch', () => {
  it('builds on main as it is now, leaving out only a branch that conflicts with it', () => {
    const { dir, git } = repo('main.txt', 'batch.txt');
    const frozen = git('rev-parse', 'HEAD~1');
    // Two area branches from the round's frozen commit: one touching a file main has since changed, one not.
    for (const [branch, file] of [['a-clean', 'clean.txt'], ['a-clash', 'main.txt']]) {
      git('checkout', '-q', '-b', branch, frozen);
      writeFileSync(join(dir, file), branch);
      git('add', file);
      git('commit', '-q', '-m', branch);
    }
    git('checkout', '-q', 'main');
    git('branch', '-q', '-D', 'batch');
    const made = makeBatch(resolveConfig({}), dir, { round: 9, date: '2026-11-20', commit: frozen, branches: ['a-clean', 'a-clash'] });
    expect(made.merged).toEqual(['a-clean']);
    expect(made.conflicted).toEqual([{ branch: 'a-clash', paths: ['main.txt'] }]);
    expect(made.failed).toEqual([]);
    expect(gitIn(made.tree)('merge-base', '--is-ancestor', 'main', 'HEAD')).toBe('');
    expect(gitIn(made.tree)('status', '--porcelain')).toBe('');
  });

  it('waits out another git\'s index lock and merges once it clears', () => {
    const { dir, git, frozen } = branched(['one', 'two']);
    // After the first merge, plant a lock in the batch worktree's git dir, as another git holding it would.
    hookIn(git, 'post-merge', '[ -e "$(git rev-parse --git-common-dir)/planted" ] && exit 0\ntouch "$(git rev-parse --git-common-dir)/planted" "$(git rev-parse --git-path index.lock)"');
    const waits: number[] = [];
    let tree = '';
    const wait = (ms: number) => {
      waits.push(ms);
      rmSync(gitIn(tree)('rev-parse', '--path-format=absolute', '--git-path', 'index.lock'));
    };
    const cfg = resolveConfig({});
    tree = join(dir, '.worktrees', cfg.names.batchTree('2026-11-20', 9));
    const made = makeBatch(cfg, dir, { round: 9, date: '2026-11-20', commit: frozen, branches: ['one', 'two'], retryMs: [5, 10], wait });
    expect(waits).toEqual([5]);
    expect(made.merged).toEqual(['one', 'two']);
    expect(made.conflicted).toEqual([]);
    expect(made.failed).toEqual([]);
  });

  it('gives up on a lock that never clears, as a failed merge naming it', () => {
    const { dir, git, frozen } = branched(['one']);
    const cfg = resolveConfig({});
    const tree = join(dir, '.worktrees', cfg.names.batchTree('2026-11-20', 9));
    const lock = () => gitIn(tree)('rev-parse', '--path-format=absolute', '--git-path', 'index.lock');
    hookIn(git, 'post-checkout', 'touch "$(git rev-parse --git-path index.lock)"');
    const waits: number[] = [];
    const made = makeBatch(cfg, dir, { round: 9, date: '2026-11-20', commit: frozen, branches: ['one'], retryMs: [1, 2], wait: (ms: number) => waits.push(ms) });
    expect(waits).toEqual([1, 2]);
    expect(made.merged).toEqual([]);
    expect(made.conflicted).toEqual([]);
    expect(made.failed).toHaveLength(1);
    expect(made.failed[0].error).toMatch(/index\.lock': File exists/);
    expect(existsSync(lock())).toBe(true);
  });

  it('records a merge that fails for another reason as failed with git\'s message, not a conflict', () => {
    const { dir, frozen } = branched(['one']);
    const made = makeBatch(resolveConfig({}), dir, { round: 9, date: '2026-11-20', commit: frozen, branches: ['one', 'gone'], wait: () => { throw new Error('no wait for a non-lock failure'); } });
    expect(made.merged).toEqual(['one']);
    expect(made.conflicted).toEqual([]);
    expect(made.failed).toEqual([{ branch: 'gone', error: expect.stringMatching(/gone/) }]);
    expect(leftOutWhy(made.failed[0])).toMatch(/^merge failed: .*gone/);
  });
});

describe('leftOut', () => {
  it('phrases each kind for the README, escaping pipes and shortening long path lists', () => {
    expect(leftOutWhy({ paths: ['a.ts', 'b.ts'] })).toBe('merge conflict in a.ts, b.ts');
    expect(leftOutWhy({ paths: ['1', '2', '3', '4', '5', '6', '7'] })).toBe('merge conflict in 1, 2, 3, 4, 5, and 2 more');
    expect(leftOutWhy({ error: 'fatal: x | y' })).toBe('merge failed: fatal: x \\| y');
  });

  it('keeps a left-out branch until main holds it or it is deleted', () => {
    const { git } = branched(['audit3-a', 'audit3-b', 'audit4-c']);
    const state = mkdtempSync(join(tmpdir(), 'skulkr-state-'));
    dirs.push(state);
    expect(leftOutIn(state)).toEqual([]);
    const entry = (branch: string, round: number) => ({ branch, round, why: 'merge conflict in x' });
    recordLeftOut(state, git, 'main', [entry('audit3-a', 3), entry('audit3-b', 3)]);
    expect(leftOutIn(state).map((e: { branch: string }) => e.branch)).toEqual(['audit3-a', 'audit3-b']);

    git('merge', '-q', '--no-edit', 'audit3-a');
    git('branch', '-q', '-D', 'audit3-b');
    const kept = recordLeftOut(state, git, 'main', [entry('audit4-c', 4)]);
    expect(kept).toEqual([entry('audit4-c', 4)]);
    expect(leftOutIn(state)).toEqual([entry('audit4-c', 4)]);
  });
});

describe('commitRecord', () => {
  it('writes the round under the config\'s record dir and appends to its ledger only when it names one', () => {
    const { dir, git } = repo('main.txt', 'batch.txt');
    mkdirSync(join(dir, 'src/x'), { recursive: true });
    writeFileSync(join(dir, 'src/x/a.ts'), 'x');
    git('add', '.');
    git('commit', '-q', '-m', 'src');
    const head = git('rev-parse', 'HEAD');
    const night = mkdtempSync(join(tmpdir(), 'skulkr-night-'));
    dirs.push(night);
    const plain = resolveConfig({ record: { dir: 'audit-log' } });
    commitRecord(plain, dir, { round: 3, commit: head, date: '2026-11-20', nightDir: night, areas: [area('x')], outcomes: {}, sweep: undefined });
    expect(readFileSync(join(dir, 'audit-log/round-3/README.md'), 'utf8')).toContain(`Blind pairs at \`${head}\` (2026-11-20)`);
    expect(existsSync(join(dir, 'audit-log/partition.json'))).toBe(true);
    expect(git('log', '-1', '--format=%B')).toBe("record audit round 3: 1 areas' raw findings, estimates and fixes");

    writeFileSync(join(dir, 'LEDGER.md'), '# L\n\n## Rounds\n\n| r |\n|---|\n');
    git('add', '.');
    git('commit', '-q', '-m', 'ledger');
    const ledgered = resolveConfig({ record: { ledger: { path: 'LEDGER.md', section: 'Rounds', row: ({ round }: { round: number }) => `| ${round} |` }, trailer: 'T: x' } });
    commitRecord(ledgered, dir, { round: 4, commit: head, date: '2026-11-20', nightDir: night, areas: [area('x')], outcomes: {}, sweep: undefined });
    expect(readFileSync(join(dir, 'LEDGER.md'), 'utf8')).toContain('|---|\n| 4 |');
    expect(git('log', '-1', '--format=%B')).toMatch(/\n\nT: x$/);
  });

  it("partitions the batch's tree as it lands, with what main gained after the round's commit", () => {
    const { dir, git } = repo('main.txt', 'batch.txt');
    mkdirSync(join(dir, 'src/x'), { recursive: true });
    writeFileSync(join(dir, 'src/x/a.ts'), 'x');
    git('add', '.');
    git('commit', '-q', '-m', 'src');
    const frozen = git('rev-parse', 'HEAD');
    mkdirSync(join(dir, 'src/y'), { recursive: true });
    writeFileSync(join(dir, 'src/y/b.ts'), 'y');
    git('add', '.');
    git('commit', '-q', '-m', 'landed meanwhile');
    const night = mkdtempSync(join(tmpdir(), 'skulkr-night-'));
    dirs.push(night);
    commitRecord(resolveConfig({ record: { dir: 'audit-log' } }), dir, { round: 3, commit: frozen, date: '2026-11-20', nightDir: night, areas: [area('x')], outcomes: {}, sweep: undefined });
    const files = JSON.parse(readFileSync(join(dir, 'audit-log/partition.json'), 'utf8')).flatMap((a: { files: string[] }) => a.files);
    expect(files).toContain('src/y/b.ts');
  });
});

describe('runGate', () => {
  it('runs the config\'s command with the batch branch for {ref}, in the batch\'s worktree or the main checkout', async () => {
    const { dir } = repo('main.txt', 'batch.txt');
    const log = join(dir, 'gate.log');
    const echo = (cwd: string) => resolveConfig({ gate: { command: ['sh', '-c', 'pwd; echo "$0"', '{ref}'], cwd } });
    expect(await runGate(echo('batch'), { root: '/', batch: { name: 'batch/x', tree: dir }, logPath: log })).toBe(0);
    expect(await runGate(resolveConfig({ gate: { command: ['false'] } }), { root: dir, batch: { name: 'b', tree: dir }, logPath: log })).toBe(1);
    expect(readFileSync(log, 'utf8')).toContain('batch/x');
  });
});
