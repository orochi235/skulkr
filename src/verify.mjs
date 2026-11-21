/**
 * The tenant's verify step (`checks.verify` in the config), run by skulkr itself over the files a fixer's commits
 * changed, never taken from the fixer's report. It runs at the end of every fixer and repair job, after the model
 * exits, and in a job of its own where it needs a GUI node (`gui`) or where a model job left no verdict. The
 * verdict is the command's exit status and the runner's file-level counts.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JOB_OUT } from './config.mjs';
import { stripAnsi } from './ansi.mjs';

const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const readIf = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : '');

/** What a timed-out command exits with: perl's alarm is SIGALRM. */
export const TIMED_OUT = 142;
/** How long the GUI probe may take before it counts as saying a GUI job is needed. */
const PROBE_SECONDS = 300;

/** The config's verify step, or undefined when it names none. */
export const verifyOf = (cfg) => (cfg.checks?.verify?.command ? cfg.checks.verify : undefined);

/** `template` with `{files}` as the changed files and `{related}` as one `--related=<file>` each. */
const filled = (template) => template.replaceAll('{files}', '$VERIFY_FILES').replaceAll('{related}', '$VERIFY_RELATED');

/**
 * Shell lines that run `command` over the files changed since `$BASE` (and `$VERIFY_EXTRA`, files the caller adds),
 * writing `verify.log`, `verify.exit`, and `verify.files` under the job's output, then, when `probe` is given, the
 * probe's answer to `gui.txt` and its exit to `gui.exit`. Uncommitted changes are dropped first, so what is checked
 * is what the commits hold: a model job records them before. They expect `set +e`.
 */
export const verifyLines = (verify, { command = verify.command, probe = verify.gui?.probe } = {}) => [
  'git reset -q --hard HEAD && git clean -qfd -e .skulkr/',
  `VERIFY_FILES=$( { git diff --name-only --diff-filter=d "$BASE..HEAD"; for f in \${VERIFY_EXTRA:-}; do [ -e "$f" ] && echo "$f"; done; } | sort -u | tr '\\n' ' ' | sed 's/ *$//')`,
  'VERIFY_RELATED=$(for f in $VERIFY_FILES; do printf -- "--related=%s " "$f"; done)',
  'export VERIFY_FILES VERIFY_RELATED',
  `echo "$VERIFY_FILES" > ${JOB_OUT}/verify.files`,
  'if [ -z "$VERIFY_FILES" ]; then',
  `  echo "no files changed" > ${JOB_OUT}/verify.log; echo 0 > ${JOB_OUT}/verify.exit`,
  'else',
  `  perl -e 'alarm shift; exec @ARGV' ${(verify.timeoutMin ?? 20) * 60} bash -c ${q(filled(command))} > ${JOB_OUT}/verify.log 2>&1; echo $? > ${JOB_OUT}/verify.exit`,
  ...(probe ? [`  perl -e 'alarm shift; exec @ARGV' ${PROBE_SECONDS} bash -c ${q(filled(probe))} > ${JOB_OUT}/gui.txt 2> ${JOB_OUT}/gui.err; echo $? > ${JOB_OUT}/gui.exit`] : []),
  'fi',
];

/** A test file's path in a line of runner output. */
const TEST_PATH = /([\w@./-]+\.(?:test|spec)\.[cm]?[jt]sx?)\b/;

/** vitest's file-level counts in `text`: its last `Test Files  1 failed | 2 passed (3)` line, or undefined. */
export const fileCountsOf = (text) => {
  const line = stripAnsi(text).split('\n').filter((l) => /^\s*Test Files\s/.test(l)).at(-1);
  if (!line) return undefined;
  const n = (word) => Number(new RegExp(`(\\d+) ${word}`).exec(line)?.[1] ?? 0);
  const total = Number(/\((\d+)\)\s*$/.exec(line)?.[1] ?? n('failed') + n('passed'));
  return { failed: n('failed'), passed: n('passed'), total };
};

/** The test files `text` reports failing: each path on a `FAIL` line, once. */
export const failedFilesIn = (text) =>
  [...new Set(stripAnsi(text).split('\n').filter((l) => /\bFAIL\b/.test(l)).flatMap((l) => TEST_PATH.exec(l)?.[1] ?? []))];

/**
 * The verdict of one verify run from its exit status and log: `{ ok, exit, counts, failedFiles, why, timedOut? }`. It
 * passes only on exit 0 with no failed file counted; a run that left no exit status is `{ ok: false, unrun: true }`.
 */
export const verdictOf = (exitText, log) => {
  const exit = Number.parseInt(String(exitText).trim(), 10);
  if (!Number.isInteger(exit)) return { ok: false, unrun: true, why: 'no verdict came home' };
  const counts = fileCountsOf(log);
  const failedFiles = failedFilesIn(log);
  const ok = exit === 0 && !(counts?.failed > 0);
  const why = ok ? '' : exit === TIMED_OUT ? 'timed out'
    : counts?.failed ? `${counts.failed} of ${counts.total} test files failed`
      : `exited ${exit}`;
  return { ok, exit, counts, failedFiles, why, ...(exit === TIMED_OUT ? { timedOut: true } : {}) };
};

/** The verdict a job left in `dir`, with its log and the files it checked. */
export const verdictIn = (dir) => {
  const log = readIf(join(dir, 'verify.log'));
  return { ...verdictOf(readIf(join(dir, 'verify.exit')), log), log, files: readIf(join(dir, 'verify.files')).split(/\s+/).filter(Boolean) };
};

/**
 * Whether the job in `dir` says the changes need the GUI step: its probe listed a test file or failed. Without a
 * probe configured, any changed file does.
 */
export const needsGui = (verify, dir) => {
  if (!verify.gui?.command) return false;
  if (!verify.gui.probe) return readIf(join(dir, 'verify.files')).trim() !== '';
  const exit = readIf(join(dir, 'gui.exit')).trim();
  if (exit === '') return readIf(join(dir, 'verify.files')).trim() !== '';
  return exit !== '0' || readIf(join(dir, 'gui.txt')).split('\n').some((l) => TEST_PATH.test(l));
};

/** How many lines of a failing run's output a repair is given in its brief; the whole log is beside it. */
const EXCERPT_LINES = 300;

/**
 * The part of a failing run's output a repair needs, verbatim: from its first failure report to the end, the
 * middle cut when it runs past {@link EXCERPT_LINES}.
 */
export const failureExcerpt = (log) => {
  const lines = stripAnsi(log).split('\n');
  const first = lines.findIndex((l) => /\bFAIL\b|Failed Tests|Unhandled Error|Error:/.test(l));
  const tail = lines.slice(first < 0 ? Math.max(0, lines.length - EXCERPT_LINES) : first);
  if (tail.length <= EXCERPT_LINES) return tail.join('\n').trim();
  const half = EXCERPT_LINES / 2;
  return [...tail.slice(0, half), `… ${tail.length - EXCERPT_LINES} lines cut …`, ...tail.slice(-half)].join('\n').trim();
};

/** One verdict's few words for the log: `passed (12 test files)` or `failed: 1 of 12 test files failed (a.test.ts)`. */
export const verdictText = (v) => {
  if (v.ok) return `passed${v.counts ? ` (${v.counts.total} test files)` : ''}`;
  const files = v.failedFiles?.length ? ` (${v.failedFiles.slice(0, 3).join(', ')}${v.failedFiles.length > 3 ? ', …' : ''})` : '';
  return `failed: ${v.why}${files}`;
};

/**
 * The round's verify results in one clause for its closing line: how many areas passed at once, passed after a
 * repair, timed out unverified, or were left out still failing, naming all but the first. Empty with none checked.
 */
export const verifyLine = (areas) => {
  const checked = areas.filter((a) => a.verify);
  if (!checked.length) return '';
  const group = (test) => checked.filter((a) => test(a.verify)).map((a) => a.id);
  const parts = [
    [group((v) => v.ok && !v.repairs).length, 'passed', []],
    ...[[group((v) => v.ok && v.repairs > 0), 'passed after repair'], [group((v) => v.timedOut), 'timed out unverified'], [group((v) => !v.ok && !v.timedOut), 'left out failing']]
      .map(([ids, what]) => [ids.length, what, ids]),
  ].filter(([n]) => n > 0);
  return `verify: ${parts.map(([n, what, ids]) => `${n} ${what}${ids.length ? ` (${ids.join(', ')})` : ''}`).join(', ')}`;
};
