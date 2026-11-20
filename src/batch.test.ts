import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { catchUpWithMain, commitRecord, gitIn, makeBatch, runGate } from './batch.mjs';
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
    expect(made.conflicted).toEqual(['a-clash']);
    expect(gitIn(made.tree)('merge-base', '--is-ancestor', 'main', 'HEAD')).toBe('');
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
