/**
 * The tenant's verify step (`checks.verify` in the config), run by skulkr itself over the files a fixer's commits
 * changed, never taken from the fixer's report. It runs at the end of every fixer and repair job, after the model
 * exits, and in a job of its own where it needs a GUI node (`gui`) or where a model job left no verdict. The
 * verdict is the command's exit status and the runner's file-level counts.
 */
import { join } from 'node:path';
import { CHECKS_PROOF, JOB_IN, JOB_OUT } from './config.mjs';
import { stripAnsi } from './ansi.mjs';
import { q, readIf } from './text.mjs';


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
 * is what the commits hold: a model job records them before. They expect `set +e`. With `fleet`, the project's name,
 * the command runs on the onto fleet ({@link fleetRunLines}), on a GUI node with `gui`, and here where it cannot.
 */
export const verifyLines = (verify, { command = verify.command, probe = verify.gui?.probe, fleet = /** @type {string | false} */ (false), gui = false } = {}) => [
  'git reset -q --hard HEAD && git clean -qfd -e .skulkr/',
  `VERIFY_FILES=$( { git diff --name-only --diff-filter=d "$BASE..HEAD"; for f in \${VERIFY_EXTRA:-}; do [ -e "$f" ] && echo "$f"; done; } | sort -u | tr '\\n' ' ' | sed 's/ *$//')`,
  'VERIFY_RELATED=$(for f in $VERIFY_FILES; do printf -- "--related=%s " "$f"; done)',
  // The fixer's own final check passed at this very commit, with nothing left uncommitted (`progress.mjs --proof`):
  // a verify command may skip running it again.
  `VERIFY_PROVEN=$( [ -s ${JOB_OUT}/${CHECKS_PROOF} ] && [ ! -s ${JOB_OUT}/uncommitted.txt ] && [ "$(cat ${JOB_OUT}/${CHECKS_PROOF})" = "$(git rev-parse HEAD)" ] && echo 1 )`,
  'export VERIFY_FILES VERIFY_RELATED VERIFY_PROVEN',
  `echo "$VERIFY_FILES" > ${JOB_OUT}/verify.files`,
  'if [ -z "$VERIFY_FILES" ]; then',
  `  echo "no files changed" > ${JOB_OUT}/verify.log; echo 0 > ${JOB_OUT}/verify.exit`,
  'else',
  ...(fleet ? fleetRunLines(filled(command), verify.timeoutMin ?? 20, { gui, project: fleet }) : [`  ${localRun(filled(command), verify.timeoutMin ?? 20)}`]),
  ...(probe ? [`  perl -e 'alarm shift; exec @ARGV' ${PROBE_SECONDS} bash -c ${q(filled(probe))} > ${JOB_OUT}/gui.txt 2> ${JOB_OUT}/gui.err; echo $? > ${JOB_OUT}/gui.exit`] : []),
  'fi',
];

/** `command` run here, killed after `minutes`, its output in `verify.log` and its exit in `verify.exit`. */
const localRun = (command, minutes) =>
  `perl -e 'alarm shift; exec @ARGV' ${minutes * 60} bash -c ${q(command)} > ${JOB_OUT}/verify.log 2>&1; echo $? > ${JOB_OUT}/verify.exit`;

/** What onto prints when the job it placed ended, as against onto itself failing to place or sync it. */
const ONTO_RAN = '^onto do: job (exited|timed out|was killed)';

/** The project's name where a check runs on the onto fleet (under the local runner, unless `local.fleetChecks` is
 *  false), else false. */
export const checksOnFleet = (cfg) => cfg.runner === 'local' && cfg.local?.fleetChecks !== false && cfg.name;

/** What a brief puts before a check's command to run it on the fleet where {@link checksOnFleet}, else nothing. */
export const onFleetPrefix = (cfg, kind, minutes, name) => (checksOnFleet(cfg) ? `${ON_FLEET} ${kind} ${minutes} ${name} -- ` : '');

/** Where a local runner's job keeps {@link onFleetScript}. */
export const ON_FLEET = `${JOB_IN}/on-fleet`;

/**
 * A script that runs its arguments on the onto fleet from a local runner's tree, `on-fleet <kind> <minutes> <name>
 * [--gui] -- <command…>`: under the project's `origin` URL, added to the tree as its `fleet` remote since onto syncs
 * only to a remote the tree names, so commits never pushed reach the node all the same; its task named
 * `<project>-<name>-<sha>`, and `VERIFY_*` passed along. Where `onto` is missing, `origin` is no URL, or onto fails
 * before its job runs, it runs the command here.
 */
export const onFleetScript = (project) => `#!/bin/bash
kind=$1 minutes=$2 name=$3; shift 3
gui=; [ "$1" = --gui ] && { gui=--gui; shift; }
[ "$1" = -- ] && shift
url=$(git -C "$(git remote get-url origin)" remote get-url origin 2>/dev/null); case "$url" in /*) url= ;; esac
if [ -n "$url" ] && command -v onto >/dev/null; then
  git remote get-url fleet >/dev/null 2>&1 || git remote add fleet "$url"
  out=$(mktemp)
  onto do --kind "$kind" --task "${project}-$name-$(git rev-parse --short=10 HEAD)" --expect "\${minutes}m" --timeout "\${minutes}m" \\
    --about "skulkr: ${project} $name, off the machine running the round" --repo "$url" $gui \\
    --env VERIFY_FILES="$VERIFY_FILES" --env VERIFY_RELATED="$VERIFY_RELATED" --env VERIFY_PROVEN="$VERIFY_PROVEN" -- "$@" 2>&1 | tee "$out"
  s=\${PIPESTATUS[0]}
  if [ "$s" = 0 ] || grep -qE ${q(ONTO_RAN)} "$out"; then rm -f "$out"; exit "$s"; fi
  rm -f "$out"; echo "skulkr: the fleet did not take $name; running it here"
fi
exec "$@"
`;

/** Shell lines that write {@link onFleetScript} for `project` into the job's tree. */
export const onFleetLines = (project) => [`mkdir -p ${JOB_IN} && cat > ${ON_FLEET} <<'SKULKR_ON_FLEET'`, ...onFleetScript(project).trimEnd().split('\n'), 'SKULKR_ON_FLEET', `chmod +x ${ON_FLEET}`];

/** `command` on the fleet through {@link onFleetScript}, its output in `verify.log` and its exit in `verify.exit`. */
const fleetRunLines = (command, minutes, { gui = false, project = 'skulkr' } = {}) => [
  ...onFleetLines(project),
  `  perl -e 'alarm shift; exec @ARGV' ${(minutes + 15) * 60} ${ON_FLEET} test ${minutes} verify${gui ? '-gui --gui' : ''} -- bash -c ${q(command)} > ${JOB_OUT}/verify.log 2>&1; echo $? > ${JOB_OUT}/verify.exit`,
];

/** A test file's path in a line of runner output. */
const TEST_PATH = /([\w@./-]+\.(?:test|spec)\.[cm]?[jt]sx?)\b/;
/** Whether `path` is a test file's path, rather than a step's name or another file. */
export const isTestPath = (path) => TEST_PATH.exec(path)?.[1] === path;

/**
 * vitest's file-level counts in `text`, summed over every `Test Files  1 failed | 2 passed (3)` line, one per vitest
 * run the command made; undefined with none.
 */
export const fileCountsOf = (text) => {
  const lines = stripAnsi(text).split('\n').filter((l) => /^\s*Test Files\s/.test(l));
  if (!lines.length) return undefined;
  const one = (line) => {
    const n = (word) => Number(new RegExp(`(\\d+) ${word}`).exec(line)?.[1] ?? 0);
    const total = Number(/\((\d+)\)\s*$/.exec(line)?.[1] ?? n('failed') + n('passed'));
    return { failed: n('failed'), passed: n('passed'), total };
  };
  return lines.map(one).reduce((a, b) => ({ failed: a.failed + b.failed, passed: a.passed + b.passed, total: a.total + b.total }));
};

/** A script's path as the first token after `FAIL` gives it: a file vitest runs, whatever it is named. */
const SCRIPT_PATH = /^[\w@./-]+\.[cm]?[jt]sx?$/;

/**
 * Each failing file `text` reports, with the tests failing in it, from vitest's `FAIL <project> <file> > <test>`
 * lines: the file is a test file's path or else the first script path after `FAIL`, and a file failing whole names
 * no test. Answers `Map<file, Set<test>>`.
 */
export const failedTestsIn = (text) => {
  const out = new Map();
  for (const line of stripAnsi(text).split('\n')) {
    const at = /\bFAIL\b/.exec(line);
    if (!at) continue;
    const rest = line.slice(at.index + 4);
    const cut = rest.indexOf(' > ');
    const file = TEST_PATH.exec(line)?.[1] ?? (cut < 0 ? rest : rest.slice(0, cut)).trim().split(/\s+/).find((t) => SCRIPT_PATH.test(t));
    if (!file) continue;
    const tests = out.get(file) ?? new Set();
    if (cut >= 0) tests.add(rest.slice(cut + 3).trim());
    out.set(file, tests);
  }
  return out;
};

/** The files `text` reports failing (`failedTestsIn`), once each. */
export const failedFilesIn = (text) => [...failedTestsIn(text).keys()];

/** Whether `text` holds vitest's report of errors outside any test file (`Unhandled Errors`, ` Errors  2 errors`). */
export const unhandledIn = (text) => /Unhandled Errors?\b|^\s*Errors\s+\d+ errors?\b/m.test(stripAnsi(text));

/**
 * The verdict of one verify run from its exit status and log: `{ ok, exit, counts, failedFiles, why, timedOut? }`. It
 * passes only on exit 0 with no failed file counted; a run that left no exit status is `{ ok: false, unrun: true }`.
 */
export const verdictOf = (exitText, log) => {
  const exit = Number.parseInt(String(exitText).trim(), 10);
  if (!Number.isInteger(exit)) return { ok: false, unrun: true, exit: undefined, counts: undefined, failedFiles: [], why: 'no verdict came home' };
  const counts = fileCountsOf(log);
  const failedFiles = failedFilesIn(log);
  const ok = exit === 0 && !(counts?.failed > 0);
  const why = ok ? '' : exit === TIMED_OUT ? 'timed out'
    : counts?.failed ? `${counts.failed} of ${counts.total} test files failed`
      : `exited ${exit}`;
  return { ok, exit, counts, failedFiles, why, ...(exit === TIMED_OUT ? { timedOut: true } : {}), ...(unhandledIn(log) ? { unhandled: true } : {}) };
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
  const some = (list) => `${list.slice(0, 3).join(', ')}${list.length > 3 ? ', …' : ''}`;
  const baseline = v.baseline?.length ? `; ${v.baseline.length} failing on the frozen tree too, set aside (${some(v.baseline)})` : '';
  if (v.ok) return `passed${v.counts ? ` (${v.counts.total} test files)` : ''}${baseline}`;
  const files = v.failedFiles?.length ? ` (${some(v.failedFiles)})` : '';
  return `failed: ${v.why}${files}${baseline}`;
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
