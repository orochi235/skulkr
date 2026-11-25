/** What the audit page says about runs: each one's headline, its lanes, and the jobs its log reports. */
import type { AuditContinuous, AuditLeftOut, AuditRun, LaneStep, LaneStepKey } from './skulkrMap.types';

/** `m` minutes as a lane says them, `m:ss`, or `h:mm:ss` from an hour up. */
export function minutesText(m: number): string {
  const total = Math.max(0, Math.round(m * 60));
  const two = (n: number) => String(n).padStart(2, '0');
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  return hours ? `${hours}:${two(minutes)}:${two(total % 60)}` : `${minutes}:${two(total % 60)}`;
}

/** A label's closing duration, as {@link minutesText} writes it, with the separator before it. */
export const TRAILING_MINUTES = /(?: · )?(\d+(?::\d\d){1,2})$/;

/** Minutes since `iso`, as {@link minutesText} says them. */
export const minutesSince = (iso: string, now: number): string => minutesText(Math.max(0, (now - new Date(iso).getTime()) / 60_000));

export const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** What one step of an area's lane shows. */
/** Between a running step's node and how long it has run, in its label. */
export const NODE_SEP = ' · ';
/** What a bar's caption says for a check that passed and for one that failed: onto's own marks. */
export const PASS = '✓';
export const FAIL = '✗';
/** The mark for a defect the fixer found itself, beyond the reviewers' lists. */
export const EXTRA = '★';
/** A verdict's caption: its mark, then its word. */
export const PASSED = `${PASS} passed`;
export const FAILED = `${FAIL} failed`;

/** The least a lane shows a duration for: a step that took less says only what it did. */
const SHOWN_MINUTES = 10 / 60;

/** `text`, then `minutes` as {@link minutesText} says them where they reach {@link SHOWN_MINUTES}. */
const withMinutes = (text: string, minutes: number | null): string =>
  minutes !== null && Number.isFinite(minutes) && minutes >= SHOWN_MINUTES ? [text, minutesText(minutes)].filter(Boolean).join(NODE_SEP) : text;

export function stepText(step: LaneStepKey, s: LaneStep, now: number): string {
  if (s.state === 'running') {
    // A fixer's count is its commits; once all are made it says them as a finished fix does, through its checks.
    const count = !s.total ? '' : step !== 'fix' ? `${s.done ?? 0}/${s.total}`
      : (s.done ?? 0) >= s.total ? plural(s.total, 'commit') : `${s.done ?? 0}/${s.total} commits`;
    const ran = s.since ? Math.max(0, (now - Date.parse(s.since)) / 60_000) : null;
    return withMinutes([s.node ?? '', count].filter(Boolean).join(NODE_SEP), ran) || `${s.node ?? ''}${NODE_SEP}running`;
  }
  if (s.state === 'failed') return s.why ?? 'failed';
  if (s.state !== 'done') return step === 'patch' ? 'after fix' : 'waiting';
  if (step === 'A' || step === 'B') return withMinutes(`${s.findings ?? 0} found`, s.minutes ?? null);
  if (step === 'match') {
    const took = s.minutes ?? (s.started && s.ended ? (Date.parse(s.ended) - Date.parse(s.started)) / 60_000 : null);
    return withMinutes(matchText(s.shared ?? 0, s.a ?? 0, s.b ?? 0), took);
  }
  if (step === 'fix') return withMinutes(plural(s.commits ?? 0, 'commit'), s.minutes ?? null);
  if (step === 'repair') return s.outcome === 'timed out' ? 'timed out' : s.attempts ? `${plural(s.attempts, 'repair')} · ${PASSED}` : PASSED;
  return `${s.commits ?? 0} applied${s.resolved ? ` · ${s.resolved}` : ''}`;
}

/** What a running round's headline calls a step where it waits its turn. */
const WAITS: Readonly<Record<string, string>> = { 'merge-wait': 'waiting to merge', 'fleet-wait': 'waiting for the fleet' };

export function headlineOf(run: AuditRun): string {
  if (run.running) {
    const step = WAITS[run.step] ? `${WAITS[run.step]}${run.behind ? `, behind ${run.behind}` : ''}` : run.step;
    return `Round ${run.round} running · ${step} · ${plural(run.areas.length, 'area')}`;
  }
  const summary = run.report?.split(';')[0];
  return summary ? `Round ${run.round} finished · ${summary}` : `Round ${run.round} finished`;
}

/** When a round began: its clock time, and its date too when that was not today. */
export function startedText(iso: string, now: number): string {
  const at = new Date(iso);
  const time = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (at.toDateString() === new Date(now).toDateString()) return time;
  return `${at.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}

/** How long a run has gone, to now while it runs and to its end once over, as `hh:mm elapsed`; null where its start or
 *  end does not parse. */
export function elapsedText(run: Pick<AuditRun, 'started' | 'ended' | 'running'>, now: number): string | null {
  const from = run.started ? Date.parse(run.started) : NaN;
  const to = run.running ? now : run.ended ? Date.parse(run.ended) : NaN;
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  const minutes = Math.max(0, Math.floor((to - from) / 60_000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)} elapsed`;
}

/** The lanes header's word on continuous mode: on, and the night's budget left; null while it is off. */
export function continuousText(continuous: AuditContinuous | undefined): string | null {
  if (!continuous) return null;
  return `continuous · $${Math.round(continuous.leftUsd)} of $${Math.round(continuous.nightUsd)} left tonight`;
}

export function spendOf(run: AuditRun): string {
  const cost = `$${run.costUsd.toFixed(2)}`;
  const spend = run.capUsd ? `${cost} of $${run.capUsd}` : cost;
  return run.usdPerArea == null ? spend : `${spend} · $${run.usdPerArea.toFixed(2)}/area · $${(run.usdPerFile ?? 0).toFixed(3)}/file`;
}

export function lastLineOf(run: AuditRun): string {
  return run.lastLine ?? (run.running ? 'Started; no job has finished yet.' : '');
}

export type JobKind = 'review' | 'match' | 'fix' | 'patch' | 'batch' | 'sweep' | 'fleet' | 'night';

/** One job a run's log reports finished. */
export interface Job {
  readonly kind: JobKind;
  readonly label: string;
  readonly area: string;
  readonly what: string;
  readonly node?: string;
  readonly minutes?: number;
  readonly tokens?: number;
  /** Its place among the round's jobs of its kind, `3/16`. */
  readonly of?: string;
  /** Whether it went wrong: a review that skipped files or did not finish, a patch that did not apply, a conflict, a failed fleet run. */
  readonly bad: boolean;
}

/** A match's result: how many findings both reviews made, then how many only one did. */
export const matchText = (shared: number, a: number, b: number) => `${a + b - shared} total (${shared} shared)`;

/** The job a `night.log` line reports, or null for a line that reports none. */
export function parseJob(line: string): Job | null {
  let m: RegExpExecArray | null;
  if ((m = /^review (\d+)\/(\d+) (\S+) ([AB]) on (\S+): (\d+) findings, (\d+)\/(\d+) files read, ([\d.]+) min, ([\d.]+)M (?:weighted )?tokens(.*)$/.exec(line))) {
    const tail = m[11]!;
    return {
      kind: 'review', label: `review ${m[4]}`, area: m[3]!, what: `${plural(Number(m[6]), 'finding')}, read ${m[7]} of ${m[8]} files${tail}`,
      node: m[5], minutes: Number(m[9]), tokens: Number(m[10]), of: `${m[1]}/${m[2]}`, bad: m[7] !== m[8] || tail.includes('unfinished'),
    };
  }
  if ((m = /^match (\d+)\/(\d+) (\S+): (\d+) shared of (\d+) \+ (\d+)/.exec(line))) {
    return { kind: 'match', label: 'match', area: m[3]!, what: matchText(Number(m[4]), Number(m[5]), Number(m[6])), of: `${m[1]}/${m[2]}`, bad: false };
  }
  if ((m = /^fix (\d+)\/(\d+) (\S+) on (\S+): (\d+) commits, ([\d.]+) min, ([\d.]+)M (?:weighted )?tokens/.exec(line))) {
    return {
      kind: 'fix', label: 'fix', area: m[3]!, what: plural(Number(m[5]), 'commit'),
      node: m[4], minutes: Number(m[6]), tokens: Number(m[7]), of: `${m[1]}/${m[2]}`, bad: false,
    };
  }
  if ((m = /^patch (\S+): (\d+) commits on (\S+)/.exec(line))) {
    return { kind: 'patch', label: 'patch', area: m[1]!, what: `${m[2]} commits on ${m[3]}`, bad: false };
  }
  if ((m = /^patch (\S+): ((?:did not apply|left out): .*)$/.exec(line))) {
    return { kind: 'patch', label: 'patch', area: m[1]!, what: m[2]!, bad: true };
  }
  // skulkr's own check of a fix, and each repair of one (`repair.mjs`).
  if ((m = /^verify ([^\s:]+): (passed.*|failed.*|still failing.*|timed out.*)$/.exec(line))) {
    return { kind: 'fix', label: 'verify', area: m[1]!, what: m[2]!, bad: !m[2]!.startsWith('passed') };
  }
  if ((m = /^repair (\S+) (\S+) on (\S+): (\d+) commits, ([\d.]+) min; verify (.*)$/.exec(line))) {
    return { kind: 'fix', label: `repair ${m[2]}`, area: m[1]!, what: `${plural(Number(m[4]), 'commit')}; verify ${m[6]}`, node: m[3], minutes: Number(m[5]), bad: m[6] !== 'passed' };
  }
  // The plan's own `control sweep:` line, printed at start-up, reports no job; only a count or a failure does.
  if ((m = /^control sweep: (\d+ dead.*|did not run.*)$/.exec(line))) {
    return { kind: 'sweep', label: 'sweep', area: '', what: m[1]!.replace(/; see \S+/, ''), bad: m[1]!.startsWith('did not run') };
  }
  if (line.startsWith('fleet:')) return { kind: 'fleet', label: 'fleet', area: '', what: line.replace(/^fleet: /, ''), bad: line.includes('fail') };
  if ((m = /^(night|record|batch|capstone): (.*)$/.exec(line))) return { kind: 'night', label: m[1]!, area: '', what: m[2]!, bad: false };
  return null;
}

/** A job and the round whose log it came from, keyed by its line's place in the whole log, as far as the polls so far
 *  have followed it, and its text. */
export interface RunJob {
  readonly key: string;
  readonly line: string;
  readonly round: number;
  readonly job: Job;
}

/**
 * The entry of the map's `leftOut` a `batch:` line reports, found by matching the line against the list rather than
 * parsing it: the branch, whatever the project's prefix, ends `<round>-<area>`. Logs before 2026-11-21 said
 * `<branch> conflicts`. A map without `leftOut` matches nothing, and the line reads as any other batch line.
 */
function leftOutAt(line: string, run: AuditRun): AuditLeftOut | undefined {
  if (!line.startsWith('batch: ')) return undefined;
  return run.leftOut?.find((e) => {
    const branch = `${e.round}-${e.area}`;
    return line.endsWith(`${branch} left out: ${e.why}`) || line.endsWith(`${branch} (round ${e.round}) left out: ${e.why}`) || line.includes(`${branch} conflicts`);
  });
}

const leftOutJob = (e: AuditLeftOut): Job => ({ kind: 'batch', label: 'batch', area: e.area, what: `left out: ${e.why}`, bad: true });

/** A run's log tail as last seen, and how many lines of the log came before its first. */
export interface LogTail {
  readonly lines: readonly string[];
  readonly base: number;
}

/** How many lines scrolled off the front of a log's tail between `before` and `after`: the fewest whose removal
 *  leaves `before` a prefix of `after`, or all of it where they share nothing. */
export function scrolledOf(before: readonly string[], after: readonly string[]): number {
  for (let d = 0; d < before.length; d++) {
    if (before.length - d <= after.length && before.every((line, i) => i < d || line === after[i - d])) return d;
  }
  return before.length;
}

/** Each run's tail now, by round, its base carried on from `was`, the tails as the last poll left them. */
export function logTailsOf(was: ReadonlyMap<number, LogTail>, runs: readonly AuditRun[]): ReadonlyMap<number, LogTail> {
  return new Map(runs.map((run) => {
    const prev = was.get(run.round);
    return [run.round, { lines: run.lines, base: prev ? prev.base + scrolledOf(prev.lines, run.lines) : 0 }];
  }));
}

/** Each run's jobs, newest first, live runs before the finished one, at most `perRun` from each. `tails` places each
 *  run's lines in its whole log, so a job keeps its key while its line moves up the tail. */
export function recentJobsOf(runs: readonly AuditRun[], perRun = 14, tails: ReadonlyMap<number, LogTail> = new Map()): RunJob[] {
  return runs.flatMap((run) => {
    const base = tails.get(run.round)?.base ?? 0;
    return run.lines
      .map((line, i) => {
        const out = leftOutAt(line, run);
        return { key: `${run.round}:${base + i}:${line}`, line, round: out?.round ?? run.round, job: out ? leftOutJob(out) : parseJob(line) };
      })
      .filter((r): r is RunJob => r.job !== null)
      .reverse()
      .slice(0, perRun);
  });
}
