import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { commitSubject, createCommitProgress, createFindingsEcho, createProgress } from './progress.mjs';
import { claude } from './agent/claude.mjs';

const parseEnvelope = claude.resultOf;
import { weaselConfig } from '../test/weaselConfig.ts';
import { resolveConfig } from './config.mjs';

const SCRIPT = join(import.meta.dirname, 'progress.mjs');
const ROOT = '/nodes/trees/weasel-skulkr-r1';
const FILES = ['packages/core/src/a.ts', 'packages/core/src/b.ts', 'package.json'];
const read = (id: string, path: string) => JSON.stringify({
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Read', input: { file_path: path } }] },
});
const RESULT = JSON.stringify({
  type: 'result', subtype: 'success', is_error: false, duration_ms: 301234, num_turns: 9, result: 'done',
  total_cost_usd: 0.51, terminal_reason: 'completed',
  usage: { input_tokens: 24, output_tokens: 4399, cache_creation_input_tokens: 40594, cache_read_input_tokens: 490175 },
  modelUsage: { 'claude-opus-5-5': { costUSD: 0.51 } },
});
/** A recorded stream: init, reads (one repeated, one unlisted, one relative), a grep, and the result. */
const STREAM = [
  JSON.stringify({ type: 'system', subtype: 'init', cwd: ROOT, tools: ['Read', 'Grep'] }),
  read('t1', `${ROOT}/packages/core/src/a.ts`),
  JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '…' }] } }),
  read('t2', `${ROOT}/packages/core/src/a.ts`),
  read('t3', `${ROOT}/packages/core/package.json`),
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't4', name: 'Grep', input: { pattern: 'x', path: `${ROOT}/package.json` } }] } }),
  read('t5', 'packages/core/src/b.ts'),
  'not json',
  read('t6', `${ROOT}/package.json`),
  RESULT,
];

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('createProgress', () => {
  it('counts each listed file the first time Read asks for it, and hands the result line back verbatim', () => {
    const { start, feed } = createProgress(FILES, ROOT);
    const out = STREAM.map((line) => feed(line));
    expect(start).toBe('onto: progress 0/3');
    expect(out.flatMap((o) => (o.progress ? o.progress.split('\n').filter((l) => l.startsWith('onto:')) : []))).toEqual(['onto: progress 1/3', 'onto: progress 2/3', 'onto: progress 3/3']);
    expect(out.flatMap((o) => (o.result !== undefined ? [o.result] : []))).toEqual([RESULT]);
  });

  it('says what the reviewer says and each file it reads or searches, so a preloaded one shows it is working', () => {
    const { feed } = createProgress(FILES, ROOT);
    const say = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Checking the  layout\ncache.' }] } });
    const notes = [say, ...STREAM.slice(1, 6)].flatMap((line) => (feed(line).progress ?? '').split('\n').filter((l) => l.startsWith('skulkr:')));
    expect(notes).toEqual([
      'skulkr: says: Checking the layout cache.',
      'skulkr: reads packages/core/src/a.ts',
      'skulkr: reads packages/core/src/a.ts',
      'skulkr: reads packages/core/package.json',
      'skulkr: searches x in package.json',
    ]);
  });
});

const tool = (name: string, input: Record<string, unknown>) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't', name, input }] } });
const OUT = `${ROOT}/.skulkr/out/findings.md`;

describe('createFindingsEcho', () => {
  it('prints each finding once its section cites a where, following Write and Edit, and ignores other files', () => {
    const { see } = createFindingsEcho();
    expect(see(tool('Write', { file_path: OUT, content: '# Findings\n\n## Drops the second event\n' }))).toEqual([]);
    expect(see(tool('Edit', { file_path: OUT, old_string: '## Drops the second event\n', new_string: '## Drops the second event\n- where: src/a.ts:3\n\n## Leaks a timer\n- **where:** src/b.ts:9\n' })))
      .toEqual(['skulkr: finding {"claim":"Drops the second event","where":"src/a.ts:3"}', 'skulkr: finding {"claim":"Leaks a timer","where":"src/b.ts:9"}']);
    expect(see(tool('Edit', { file_path: OUT, old_string: 'Leaks a timer', new_string: 'Leaks a timer' }))).toEqual([]);
    expect(see(tool('Write', { file_path: `${ROOT}/notes.md`, content: '## Other\n- where: x.ts:1\n' }))).toEqual([]);
    expect(see(tool('Edit', { file_path: OUT, old_string: '<!-- nowhere -->', new_string: '## Files read\n- src/a.ts\n' }))).toEqual([]);
  });

  it("puts the reviewer's findings among its progress lines", () => {
    const { feed } = createProgress(FILES, ROOT);
    expect(feed(JSON.stringify(tool('Write', { file_path: OUT, content: '## Bad\n- where: src/a.ts:1\n' }))).progress)
      .toBe('skulkr: finding {"claim":"Bad","where":"src/a.ts:1"}');
  });
});

describe('progress.mjs', () => {
  it('prints progress and writes the envelope parseEnvelope reads, the same as --output-format json', () => {
    // The filter resolves against process.cwd(), which is the real path; macOS's tmpdir() is behind /var -> /private/var.
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'skulkr-progress-')));
    dirs.push(dir);
    writeFileSync(join(dir, 'files.txt'), `${FILES.join('\n')}\n`);
    const stream = STREAM.map((l) => l.replaceAll(ROOT, dir)).join('\n');
    const run = spawnSync(process.execPath, [SCRIPT, 'files.txt', 'claude.json'], { cwd: dir, input: stream, encoding: 'utf8' });
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(run.stdout.split('\n').filter((l) => l.startsWith('onto:'))).toEqual(['onto: progress 0/3', 'onto: progress 1/3', 'onto: progress 2/3', 'onto: progress 3/3']);
    const raw = readFileSync(join(dir, 'claude.json'), 'utf8');
    expect(raw).toBe(`${RESULT}\n`);
    expect(parseEnvelope(raw).record).toMatchObject({ terminalReason: 'completed', budgetHit: false, costUsd: 0.51, weightedTokens: 121779 });
  });

  it('leaves an empty result file when the stream ends without a result, as a killed json run does', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'skulkr-progress-')));
    dirs.push(dir);
    writeFileSync(join(dir, 'files.txt'), 'a.ts\n');
    const run = spawnSync(process.execPath, [SCRIPT, 'files.txt', 'claude.json'], { cwd: dir, input: '', encoding: 'utf8' });
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(readFileSync(join(dir, 'claude.json'), 'utf8')).toBe('');
    expect(parseEnvelope('').record.terminalReason).toBe('no envelope');
  });
});

describe('createCommitProgress', () => {
  const bash = (command: string) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command } }] } });
  it('keeps the fixer\'s last report in its result when its final reply is about something else', () => {
    const say = (text: string) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
    const result = (text: string) => JSON.stringify({ type: 'result', subtype: 'success', result: text });
    const { feed } = createCommitProgress(1);
    feed(say('fixed 1a2b3c4d | a thing (A)\ntally: 1 of 1 fixed, 0 extra fixed'));
    feed(say('A background watcher hit its time limit; nothing was lost.'));
    const kept = feed(result('A background watcher hit its time limit; nothing was lost.')).result!;
    expect(parseEnvelope(kept).reply).toBe('fixed 1a2b3c4d | a thing (A)\ntally: 1 of 1 fixed, 0 extra fixed');
    const woken = createCommitProgress(1);
    woken.feed(say('[D2] a thing (scour): fixed 1a2b3c4d\ntally: 1 of 1 fixed, 0 extra fixed'));
    woken.feed(say('The exit code came from a broken cat, not a test; my report above holds.\n\ntally: 1 of 1 fixed, 0 extra fixed'));
    const again = woken.feed(result('The exit code came from a broken cat, not a test; my report above holds.\n\ntally: 1 of 1 fixed, 0 extra fixed')).result!;
    expect(parseEnvelope(again).reply).toMatch(/^\[D2\] a thing \(scour\): fixed 1a2b3c4d/);
    const plain = createCommitProgress(1);
    plain.feed(say('fixed 1a2b3c4d | a thing (A)'));
    expect(JSON.parse(plain.feed(result('fixed 1a2b3c4d | a thing (A)')).result!)).not.toHaveProperty('report');
  });

  it('passes on what the fixer says between tool calls, on one line, but not its report', () => {
    const say = (text: string) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
    const { feed } = createCommitProgress(1);
    expect(feed(say('The flip test fails because\nthe mirror ignores the parent.')).progress).toBe('skulkr: says: The flip test fails because the mirror ignores the parent.');
    expect(feed(say('x'.repeat(400))).progress).toHaveLength('skulkr: says: '.length + 240);
    expect(feed(say('fixed 1a2b3c4d | a thing (A)\ntally: 1 of 1 fixed, 0 extra fixed')).progress).toBeUndefined();
  });

  it('steps once per git commit the fixer runs, out of its findings, and holds there past them', () => {
    const { start, feed } = createCommitProgress(2);
    const counts = (line: string) => (feed(line).progress ?? '').split('\n').filter((l) => l.startsWith('onto:'));
    expect(start).toBe('onto: progress 0/2');
    expect(counts(bash('npx vitest run a.test.ts'))).toEqual([]);
    expect(counts(bash('git add -A && git commit -m one'))).toEqual(['onto: progress 1/2']);
    expect(counts(bash('git -c user.name=a commit -q -m two'))).toEqual(['onto: progress 2/2']);
    expect(counts(bash('git commit -m fixup'))).toEqual([]);
    expect(feed('{"type":"result","result":"ok"}').result).toBe('{"type":"result","result":"ok"}');
  });
});

describe('createCommitProgress checks', () => {
  const bash = (id: string, command: string) => JSON.stringify({
    type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] },
  });
  const result = (id: string, text: string) => JSON.stringify({
    type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: text }] },
  });

  it('records the commit its final check passed at with --proof, and drops it once that check fails', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'skulkr-progress-')));
    dirs.push(dir);
    const git = (...args: string[]) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' }).stdout.trim();
    git('init', '-q', '-b', 'main');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'base');
    writeFileSync(join(dir, 'checks.json'), JSON.stringify(weaselConfig().checks.tally));
    const run = (...lines: string[]) => spawnSync(process.execPath, [SCRIPT, '--commits', '1', '--checks', 'checks.json', '--proof', 'proof', 'claude.json'], { cwd: dir, input: lines.join('\n'), encoding: 'utf8' });
    const failed = JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'g2', is_error: true, content: 'checks:gate: 1 failed' }] } });
    expect(run(bash('g1', 'npm run checks:gate'), result('g1', 'checks:gate: all 33 passed')).status).toBe(0);
    expect(readFileSync(join(dir, 'proof'), 'utf8').trim()).toBe(git('rev-parse', 'HEAD'));
    run(bash('g2', 'npm run checks:gate'), failed);
    expect(existsSync(join(dir, 'proof'))).toBe(false);
  });

  it('reports the checks a fixer runs, of those its commits call for, and their tests, in onto\'s protocol', () => {
    const { feed } = createCommitProgress(1, weaselConfig().checks.tally);
    const lines = [
      bash('c1', 'git commit -m "fix" -- packages/geom/src/a.ts packages/geom/src/a.test.ts'),
      result('c1', '[main abc1234] fix'),
      bash('t1', 'npx vitest run --maxWorkers=1 packages/geom/src/a.test.ts'),
      JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: ' Test Files  1 failed (1)\n      Tests  1 failed | 22 passed (23)\n' }] } }),
      bash('t2', 'npx vitest run --maxWorkers=1 packages/geom/src/a.test.ts'),
      result('t2', '      Tests  23 passed (23)\n'),
      bash('l1', 'npm run lint -w @weasel-js/geom'),
      result('l1', 'lint ok'),
      bash('g1', 'npm run checks:gate'),
      result('g1', 'all 32 passed'),
    ].flatMap((line) => (feed(line).progress ?? '').split('\n').filter((l) => l.startsWith('onto:')));
    expect(lines).toEqual([
      'onto: progress 1/1',
      'onto: progress 23/23 tests', 'onto: failed 1/23 tests',
      'onto: progress 1/3 checks', 'onto: failed 1/3 checks',
      // The rerun replaces the failing run rather than adding to it.
      'onto: progress 23/23 tests', 'onto: failed 0/23 tests',
      'onto: progress 1/3 checks', 'onto: failed 0/3 checks',
      'onto: progress 2/3 checks', 'onto: failed 0/3 checks',
      'onto: progress 3/3 checks', 'onto: failed 0/3 checks',
    ]);
  });

  it('tallies the default checks: a test file, and the typecheck as the final one', () => {
    const { feed } = createCommitProgress(1, resolveConfig().checks.tally);
    const lines = [
      bash('c1', 'git commit -m "fix" -- src/a.ts src/a.test.ts'),
      result('c1', 'ok'),
      bash('t1', 'npm test -- src/a.test.ts'),
      result('t1', '      Tests  4 passed (4)\n'),
      bash('g1', 'npm run typecheck --if-present'),
      result('g1', ''),
    ].flatMap((line) => (feed(line).progress ?? '').split('\n').filter(Boolean));
    expect(lines.filter((l) => l.endsWith('checks'))).toEqual([
      'onto: progress 1/2 checks', 'onto: failed 0/2 checks', 'onto: progress 2/2 checks', 'onto: failed 0/2 checks',
    ]);
  });

  it('reports only commits without a tally', () => {
    const { feed } = createCommitProgress(2);
    expect(feed(bash('t1', 'npx vitest run a.test.ts')).progress).toBe('skulkr: running: npx vitest run a.test.ts');
  });

  it('names what the fixer runs, each commit by its subject, and each check by how it went', () => {
    const { feed } = createCommitProgress(1, weaselConfig().checks.tally);
    const notes = [
      bash('c1', 'git add -A && git commit -q -m "fix the arc\'s winding" -- packages/geom/src/a.ts packages/geom/src/a.test.ts'),
      result('c1', ''),
      bash('t1', 'npx vitest run --maxWorkers=1 packages/geom/src/a.test.ts'),
      JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content:
        ' FAIL  packages/geom/src/a.test.ts > arc > winds clockwise\n FAIL  packages/geom/src/a.test.ts > arc > closes\n      Tests  2 failed | 21 passed (23)\n' }] } }),
      bash('c2', "git commit -m 'fixup'"),
      bash('l1', 'npm run lint -w @weasel-js/geom'),
      result('l1', 'lint ok'),
    ].flatMap((line) => (feed(line).progress ?? '').split('\n').filter((l) => l.startsWith('skulkr:')));
    expect(notes).toEqual([
      'skulkr: commit 1/1: fix the arc\'s winding',
      'skulkr: running: npx vitest run --maxWorkers=1 packages/geom/src/a.test.ts',
      'skulkr: test packages/geom/src/a.test.ts: 2 failed of 23 (packages/geom/src/a.test.ts > arc > winds clockwise; packages/geom/src/a.test.ts > arc > closes)',
      'skulkr: fixup commit: fixup',
      'skulkr: running: npm run lint -w @weasel-js/geom',
      'skulkr: lint geom: passed',
    ]);
  });

  it('names the defects a commit trailer gives, and nothing more where it gives none', () => {
    const { feed } = createCommitProgress(2);
    const notes = [bash('c1', 'git commit -q -m "clamp the key" -m "Defect: D3, D7"'), bash('c2', 'git commit -m "lint"')]
      .flatMap((line) => (feed(line).progress ?? '').split('\n').filter((l) => l.startsWith('skulkr:')));
    expect(notes).toEqual(['skulkr: commit 1/2 for D3 D7: clamp the key', 'skulkr: commit 2/2: lint']);
  });

  it('reads a commit subject from each way a message is quoted', () => {
    expect(commitSubject('git commit -m "a b"')).toBe('a b');
    expect(commitSubject("git commit -qm 'a b' -- x")).toBe('a b');
    expect(commitSubject("git commit -m $'a b\\nbody'")).toBe('a b');
    expect(commitSubject('git commit -F msg.txt')).toBe('');
  });
});
