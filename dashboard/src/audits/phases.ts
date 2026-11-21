/** Where a run has an area: the phase it is in, the color that phase wears, and its lane as spans on the run's clock. */
import { getOwn } from '@weasel-js/registry';
import type { SpanState, SpanStripSpan } from '@weasel-js/ui/components/SpanStrip';
import { NODE_SEP, minutesText, stepText } from './runData';
import type { AuditArea, AuditLane, AuditRun, LaneStep, LaneStepKey } from './skulkrMap.types';
import palette from './palette.module.css';

/** Where every area goes, in order, `reviewed` once one of its two reviews is in: their colors run along one sweep,
 *  indigo to yellow, which the legend draws. The patch is off it, black outlined white, as a fixed area is. */
export const PIPELINE = ['review', 'reviewed', 'match', 'fix', 'patch'] as const;
export const SWEEP = ['review', 'reviewed', 'match', 'fix'] as const satisfies readonly AuditPhase[];

/** How the legend names each phase. */
export const PHASE_LABEL: Readonly<Record<AuditPhase, string>> = {
  review: 'review', reviewed: 'one review in', match: 'match', fix: 'fix', patch: 'patch', conflict: 'conflict', done: 'done',
};
/** Where an area can end up, off the sweep. */
export const OFF_PIPELINE = ['conflict', 'done'] as const;
export const AUDIT_PHASES = [...PIPELINE, ...OFF_PIPELINE] as const;
export type AuditPhase = typeof AUDIT_PHASES[number];

/** A lane's stretches, in order: the two reviewers run side by side, so they share one. A lane has a repair stretch
 *  only once skulkr has checked its fix. */
const PARTS = ['review', 'match', 'fix', 'repair', 'patch'] as const;
type Part = typeof PARTS[number];
const STEPS_OF: Readonly<Record<Part, readonly LaneStepKey[]>> = { review: ['A', 'B'], match: ['match'], fix: ['fix'], repair: ['repair'], patch: ['patch'] };

/** How long each stretch usually takes, in minutes: its width until it has a measured one. */
export const TYPICAL_MINUTES: Readonly<Record<Part, number>> = { review: 5, match: 0.5, fix: 18, repair: 10, patch: 0.5 };

const WAITING: LaneStep = { state: 'waiting' };
/** A lane's step by key; a lane not yet checked has no repair step, which reads as waiting. */
const stepOf = (lane: AuditLane, key: LaneStepKey): LaneStep => lane.steps[key] ?? WAITING;

/** How far past now a run's clock runs, in minutes: room for the steps still to come. */
export const CLOCK_AHEAD_MINUTES = 20;

const MIN = 60_000;

/** The phase's color, as the stylesheet defines it. */
export const phaseColor = (phase: AuditPhase): string => `var(--audit-phase-${phase})`;

/** The span fills light enough that a label's pulse rests dark on them: lightness 0.65 and up in `palette.module.css`. */
export const BRIGHT_FILLS: ReadonlySet<string> = new Set([phaseColor('match'), phaseColor('fix'), 'var(--audit-checks)']);

/** A lane label's ink where its span is filled in `phase`'s color: white on the patch's black, else the lanes' own. */
export const phaseInkOf = (phase: AuditPhase, fill: number | undefined): string | undefined =>
  (phase === 'patch' && (fill === undefined || fill > 0) ? 'var(--audit-phase-patch-ink)' : undefined);

/** The class that sets `--audit-phase` to the phase's color, for an element that wears it. */
export const phaseClass = (phase: AuditPhase): string => getOwn(palette, `phase-${phase}`) ?? '';

interface PartState {
  readonly part: Part;
  readonly state: LaneStep['state'];
  readonly steps: readonly LaneStep[];
}

function partState(lane: AuditLane, part: Part): PartState {
  const steps = STEPS_OF[part].map((name) => stepOf(lane, name));
  const state = steps.some((s) => s.state === 'failed') ? 'failed'
    : steps.every((s) => s.state === 'done') ? 'done'
    : steps.some((s) => s.state !== 'waiting') ? 'running'
    : 'waiting';
  return { part, state, steps };
}

const partsOf = (lane: AuditLane): PartState[] => PARTS.filter((part) => part !== 'repair' || lane.steps.repair).map((part) => partState(lane, part));

/** Whether an area is through: patched, fixed with no commits to patch, or reviewed or matched with nothing to fix. */
export function isFinished(lane: AuditLane): boolean {
  const { A, B, match, fix, patch } = lane.steps;
  if (patch.state === 'done') return true;
  // Two reviews that found nothing leave nothing to match.
  if (A.state === 'done' && B.state === 'done' && (A.findings ?? 0) + (B.findings ?? 0) === 0) return true;
  // A fix that made no commits leaves no patch to apply.
  if (fix.state === 'done' && fix.commits === 0) return true;
  return match.state === 'done' && (match.a ?? 0) + (match.b ?? 0) - (match.shared ?? 0) === 0;
}

/** The phase an area is in: a conflict once any step fails, done once it is through, else the step running or next. */
export function phaseOf(lane: AuditLane): AuditPhase {
  const parts = partsOf(lane);
  if (parts.some((p) => p.state === 'failed')) return 'conflict';
  if (isFinished(lane)) return 'done';
  const part = parts.find((p) => p.state === 'running') ?? parts.find((p) => p.state === 'waiting');
  return part ? partPhase(part) : 'done';
}

/** The color of a span of `part` drawn in `phase`: the controller's verify and repair in magenta of their own, unless failed. */
const partColor = (part: Part, phase: AuditPhase): string => (part === 'repair' && phase !== 'conflict' ? 'var(--audit-repair)' : phaseColor(phase));

/** The phase a part's color stands for: a review with one of its two reports in has gone a step further. */
function partPhase(p: PartState): AuditPhase {
  if (p.state === 'failed') return 'conflict';
  if (p.part === 'review' && p.steps.some((s) => s.state === 'done')) return 'reviewed';
  return p.part === 'repair' ? 'fix' : p.part;
}

/** A round's areas counted by phase: how many are done of all of them, then how many sit in each phase that has any,
 *  in pipeline order, a conflict last. */
export function stageCountsOf(lanes: readonly AuditLane[]): { done: number; total: number; stages: { phase: AuditPhase; n: number }[] } {
  const by = new Map<AuditPhase, number>();
  for (const lane of lanes) {
    const phase = phaseOf(lane);
    by.set(phase, (by.get(phase) ?? 0) + 1);
  }
  const stages = [...PIPELINE, 'conflict' as const].flatMap((phase) => (by.get(phase) ? [{ phase, n: by.get(phase)! }] : []));
  return { done: by.get('done') ?? 0, total: lanes.length, stages };
}

/** Whether the round's pass over an area is done: it is through, or its fixer has finished, no repair is under way, and
 *  only its patch, which lands with the round's batch, is left. */
export const passDone = (lane: AuditLane): boolean =>
  isFinished(lane) || (lane.steps.fix.state === 'done' && lane.steps.repair?.state !== 'running');

/** Every area a live run holds, by id, and its phase on the map: `done` once its pass is. */
export function phasesOf(runs: readonly AuditRun[]): ReadonlyMap<string, AuditPhase> {
  return new Map(runs.filter((r) => r.running).flatMap((r) => r.lanes.map((lane) => [lane.id, passDone(lane) ? 'done' : phaseOf(lane)] as const)));
}

/** What a live run estimates each of its areas still holds once both reviews are matched, before the pass is done. */
export const liveEstimatesOf = (runs: readonly AuditRun[]): ReadonlyMap<string, number> =>
  new Map(runs.filter((r) => r.running).flatMap((r) => r.lanes.flatMap((l) => (l.pass ? [[l.id, l.pass.left] as const] : []))));

/** `areas`, each whose pass a live run has done carrying that pass, provisional until the round's record lands. */
export function withLivePasses(areas: readonly AuditArea[], runs: readonly AuditRun[]): readonly AuditArea[] {
  const live = new Map(runs.filter((r) => r.running).flatMap((r) => r.lanes.filter((l) => l.pass && passDone(l)).map((l) => [l.id, l.pass!] as const)));
  if (live.size === 0) return areas;
  return areas.map((a) => {
    const pass = live.get(a.id);
    return pass && !a.passes.some((p) => p.round === pass.round) ? { ...a, passes: [...a.passes, { ...pass, provisional: true }] } : a;
  });
}

const ms = (iso: string | undefined): number | null => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : null;
};

/** When a part's steps began and ended, as far as onto's records say: a running step ends now. */
function timesOf(p: PartState, now: number): { start: number | null; end: number | null } {
  const starts = p.steps.flatMap((s) => [ms(s.state === 'running' ? s.since : s.started)].filter((t): t is number => t !== null));
  const ends = p.steps.flatMap((s) => (s.state === 'running' ? [now] : [ms(s.ended)].filter((t): t is number => t !== null)));
  return {
    start: starts.length ? Math.min(...starts) : null,
    end: p.state === 'running' ? now : p.state === 'done' && ends.length === p.steps.length ? Math.max(...ends) : null,
  };
}

/** A finished part's measured minutes, where its steps report them. */
function measuredOf(p: PartState): number | null {
  const minutes = p.steps.flatMap((s) => (s.minutes === undefined ? [] : [s.minutes]));
  return minutes.length === p.steps.length ? Math.max(...minutes) : null;
}

const SPAN_STATE: Readonly<Record<LaneStep['state'], SpanState>> = { waiting: 'pending', running: 'active', done: 'done', failed: 'failed' };

/** Of the findings a done fixer answered, how many it left for later, and the share it settled, fixed or found sound;
 *  null before it reports or where it gives no tally. */
function settledOf(fix: LaneStep): { left: number; share: number } | null {
  if (fix.state !== 'done' || fix.fixed === undefined) return null;
  if (!fix.of) return { left: 0, share: 1 };
  // A report with only a tally line says nothing of why a finding went unfixed, so all of them count as left.
  const left = Math.max(0, fix.deferred ?? fix.of - fix.fixed);
  return { left, share: Math.max(0, 1 - left / fix.of) };
}

/** How much of the patch to shade once the fixer reports: the share it settled, all of it once the patch is applied,
 *  and none before the fixer reports or where it gives no tally. */
export function patchFillOf(lane: AuditLane): number {
  if (lane.steps.patch.state === 'done') return 1;
  return settledOf(lane.steps.fix)?.share ?? 0;
}

/**
 * A patch span split by what its fixer left: the share it settled shaded as the patch is, then the share it left for
 * later, filed or waiting on a question, hatched dark gray. Whole where it left nothing, has not reported, or gave no
 * tally.
 */
export function withUnfixed(span: SpanStripSpan, lane: AuditLane): SpanStripSpan[] {
  const { fix } = lane.steps;
  const settled = settledOf(fix);
  if (!settled || settled.left === 0) return [span];
  const { left, share } = settled;
  return [
    { ...span, ms: span.ms * share, fill: 1 },
    {
      ...span, id: `${span.id}-unfixed`, label: '', start: undefined, ms: span.ms * (1 - share), fill: 1, state: 'failed',
      color: 'var(--audit-filed)', title: `${left} of ${fix.of} left for later`, content: undefined,
    },
  ];
}

/** A patch span with its ink, white on its black wherever it is filled. */
function withInk(span: SpanStripSpan): SpanStripSpan {
  const ink = span.id === 'patch' ? phaseInkOf('patch', span.fill) : undefined;
  return ink ? { ...span, ink } : span;
}

/** The area's tally, its patch segment's caption: how many of the findings its fixer answered it fixed, and the
 *  extras it fixed besides; before the fixer reports, or where its report gives no tally, what the reviews found. */
export function tallyOf(lane: AuditLane): string {
  const { match, fix } = lane.steps;
  if (fix.state === 'done' && fix.fixed !== undefined) {
    const also = [fix.dismissed ? `${fix.dismissed} FP` : '', fix.deferred ? `${fix.deferred} filed` : ''].filter(Boolean);
    return `${fix.fixed} of ${fix.of ?? fix.fixed} fixed${also.map((a) => ` · ${a}`).join('')}${fix.extra ? ` +${fix.extra} extra` : ''}`;
  }
  return match.state === 'done' ? `${(match.a ?? 0) + (match.b ?? 0) - (match.shared ?? 0)} found` : '';
}

/** What a part shows in its segment: the node, what it found or made, and its minutes, never the phase's name; the
 *  patch shows the area's tally unless it failed. */
function partLabel(lane: AuditLane, p: PartState, now: number): string {
  if (p.part === 'patch' && p.state !== 'failed') return tallyOf(lane);
  if (p.state === 'waiting') return '';
  const running = p.steps.find((s) => s.state === 'running');
  if (running) return stepText(p.part === 'review' ? 'A' : p.part, running, now);
  if (p.part === 'review' && p.state === 'done') {
    const minutes = measuredOf(p);
    const found = `${p.steps.map((s) => s.findings ?? 0).join('+')} found`;
    return minutes === null ? found : `${found} · ${minutesText(minutes)}`;
  }
  return stepText(p.part === 'review' ? 'A' : p.part, p.steps[0]!, now);
}

/** An area's lane as the page draws it. */
export interface LaneView {
  readonly phase: AuditPhase;
  readonly finished: boolean;
  /** On the run's clock, in epoch ms. */
  readonly spans: SpanStripSpan[];
  /** How long the part under way has run, `12m`, or null with none under way. */
  readonly elapsed: string | null;
  /** When its last part ended, where known. */
  readonly ended: number | null;
}

/**
 * An area's lane on the run's clock: a part placed at its real start for its real minutes, a running one running to
 * `now`, one with no record of when it ran right after the part before it, and one not begun its typical minutes
 * from the later of that and now, dimmed and unfilled. The first part with no record starts at `roundStart`.
 */
export function laneViewOf(lane: AuditLane, now: number, roundStart: number): LaneView {
  let cursor = roundStart;
  let elapsed: string | null = null;
  let ended: number | null = null;
  const spans = partsOf(lane).map((p): SpanStripSpan => {
    const phase = partPhase(p);
    const times = timesOf(p, now);
    // A patch waits from its fix's end for the round's batch, shaded by what the fix did; any other part not begun yet
    // can begin no earlier than now.
    const waitsForBatch = p.part === 'patch' && p.state === 'waiting' && lane.steps.fix.state === 'done';
    const start = times.start ?? (p.state === 'waiting' && !waitsForBatch ? Math.max(cursor, now) : cursor);
    const end = times.end ?? (waitsForBatch
      ? Math.max(now, start + TYPICAL_MINUTES.patch * MIN)
      : start + (p.state === 'done' ? measuredOf(p) ?? TYPICAL_MINUTES[p.part] : TYPICAL_MINUTES[p.part]) * MIN);
    if (p.state === 'running') elapsed = minutesText((now - start) / MIN);
    if (p.state === 'done' || p.state === 'failed') ended = Math.max(ended ?? end, end);
    cursor = end;
    const title = STEPS_OF[p.part].map((name) => `${name}: ${stepText(name, stepOf(lane, name), now)}`).join('; ');
    return {
      id: p.part, label: partLabel(lane, p, now), start, ms: Math.max(0, end - start), color: partColor(p.part, phase), state: SPAN_STATE[p.state], title,
      ...(waitsForBatch ? { fill: patchFillOf(lane) } : p.state === 'waiting' ? { fill: 0 } : {}),
    };
  }).flatMap((span) => (span.id === 'patch' ? withUnfixed(span, lane) : [span]))
    .map((span) => withInk(span));
  return { phase: phaseOf(lane), finished: isFinished(lane), spans, elapsed, ended };
}

/** The clock a run's lanes share: from its start to `now`, and room ahead. Steady whichever lanes are shown. */
export function runClockOf(run: AuditRun, now: number): { from: number; to: number } {
  const from = ms(run.started) ?? now;
  const until = run.running ? now : ms(run.ended ?? undefined) ?? now;
  return { from, to: until + (run.running ? CLOCK_AHEAD_MINUTES * MIN : 0) };
}

/** The steps view's columns, one per step, each the color of the phase it stands for. */
/** The steps view's columns: the two blind reviews run side by side, A over B, in the first, and every later step
 *  covers both stripes. */
const STEP_COLUMNS: readonly { step: LaneStepKey; part: Part; phase: AuditPhase; start: number; width: number; track?: number; trackSpan?: number }[] = [
  { step: 'A', part: 'review', phase: 'review', start: 0, width: 1 },
  { step: 'B', part: 'review', phase: 'reviewed', start: 0, width: 1, track: 1 },
  { step: 'match', part: 'match', phase: 'match', start: 1, width: 1, trackSpan: 2 },
  { step: 'fix', part: 'fix', phase: 'fix', start: 2, width: 1, trackSpan: 2 },
  // The fix's checking: its fixer's own checks, then a verify or repair job of the controller's, in one column.
  { step: 'repair', part: 'repair', phase: 'fix', start: 3, width: 0.5, trackSpan: 2 },
  // Applying a patch takes no time to speak of; its column is wide enough for its tally.
  { step: 'patch', part: 'patch', phase: 'patch', start: 3.5, width: 0.6, trackSpan: 2 },
];

/** The column after the fix's own: lit while its fixer runs its checks past its last commit, until a verify or
 *  repair job of the controller's takes it over. */
const CHECKS_COLUMN = { start: 3, width: 0.5 } as const;

/** Whether a fixer has made every commit it set out to and is still running: its checks. */
const checkingOf = (fix: LaneStep): boolean => fix.state === 'running' && !!fix.total && (fix.done ?? 0) >= fix.total;

/** The fixer's checks: lit while it runs them, carrying the node doing it, and filled once it ends. */
function checksSpan(fix: LaneStep): SpanStripSpan {
  const checking = checkingOf(fix);
  const state = fix.state === 'done' ? 'done' : fix.state === 'failed' ? 'failed' : checking ? 'active' : 'pending';
  return {
    id: 'checks', start: CHECKS_COLUMN.start, ms: CHECKS_COLUMN.width, trackSpan: 2, title: 'the fixer\'s checks',
    label: checking ? fix.node ?? '' : '', state, fill: state === 'pending' ? 0 : 1, color: 'var(--audit-checks)',
  };
}

/** The fix span while its fixer runs its checks: no longer active, its node moved onto the checks track. */
const fixWhileChecking = (span: SpanStripSpan, fix: LaneStep): SpanStripSpan =>
  (checkingOf(fix) ? { ...span, state: 'done', label: span.label.slice(span.label.indexOf(NODE_SEP) + NODE_SEP.length) } : span);

/** How wide the steps view's window is, in columns. */
export const STEP_COLUMN_COUNT = Math.max(...STEP_COLUMNS.map((c) => c.start + c.width));

/** Whether the controller has taken over a lane's checking column with a verify or repair job of its own. */
const repairing = (lane: AuditLane): boolean => !!lane.steps.repair && lane.steps.repair.state !== 'waiting';

/** How full a running step is drawn at most, until it finishes. */
const RUNNING_FILL_CAP = 0.9;

/**
 * An area's lane as the steps view draws it: a column of one length per step, filled by its state, a running one by its
 * own count where onto reports one (a fixer's commits of its findings), else as far as its minutes so far go into its
 * typical minutes, short of full until it finishes.
 */
export function laneStepsOf(lane: AuditLane, now: number): SpanStripSpan[] {
  return STEP_COLUMNS.filter((c) => c.step !== 'repair' || repairing(lane)).map(({ step, part, phase, start, width, track, trackSpan }): SpanStripSpan => {
    const s = stepOf(lane, step);
    const since = s.state === 'running' ? ms(s.since) : null;
    const fill = s.state === 'done' || s.state === 'failed' ? 1
      : step === 'patch' ? patchFillOf(lane)
      // Its count runs to full: the checks after its last commit light a track of their own.
      : s.state === 'running' && s.total ? Math.min(1, (s.done ?? 0) / s.total)
      : since !== null ? Math.min(RUNNING_FILL_CAP, (now - since) / (TYPICAL_MINUTES[part] * MIN))
      : 0;
    return {
      id: step, start, ms: width, track, trackSpan, fill, state: SPAN_STATE[s.state], title: `${step}: ${stepText(step, s, now)}`,
      label: step === 'patch' && s.state !== 'failed' ? tallyOf(lane) : s.state === 'waiting' ? '' : stepText(step, s, now),
      color: partColor(part, s.state === 'failed' ? 'conflict' : phase),
    };
  }).flatMap((span) => (span.id === 'patch' && span.state !== 'failed' ? withUnfixed(span, lane) : span.id === 'fix' ? [fixWhileChecking(span, lane.steps.fix), ...(repairing(lane) ? [] : [checksSpan(lane.steps.fix)])] : [span]))
    .map((span) => withInk(span));
}
