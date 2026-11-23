/** The clock view of a lane: each stretch placed on the run's clock where and for as long as it ran. */
import type { SpanStripSpan } from '@weasel-js/ui/components/SpanStrip';
import { MIN, SPAN_STATE, ms, patchFillOf, tallyOf, withInk, withUnfixed } from './laneSpans';
import { STEPS_OF, TYPICAL_MINUTES, isFinished, partColor, partPhase, partsOf, phaseOf, stepOf, type AuditPhase, type PartState } from './phases';
import { minutesText, stepText } from './runData';
import type { AuditLane, AuditRun, LaneStepKey } from './skulkrMap.types';

/** How far past now a run's clock runs, in minutes: room for the steps still to come. */
export const CLOCK_AHEAD_MINUTES = 20;


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

/** What a part shows in its segment: the node, what it found or made, and its minutes, never the phase's name; a
 *  reviewer leads with its letter, and the patch shows the area's tally unless it failed. */
function partLabel(lane: AuditLane, s: Stretch, now: number): string {
  const { p, id } = s;
  if (p.part === 'patch' && p.state !== 'failed') return tallyOf(lane);
  if (p.state === 'waiting') return '';
  const running = p.steps.find((step) => step.state === 'running');
  const text = stepText(id, running ?? p.steps[0]!, now);
  return id === 'A' || id === 'B' ? `${id} ${text}` : text;
}

/** One span of a lane: a part, except the review, which is a span per reviewer. */
interface Stretch {
  readonly id: LaneStepKey;
  readonly p: PartState;
  readonly phase: AuditPhase;
}

/** A lane's stretches in order. The reviewers start apart, B waiting on a slot, so each has its own span: A in the
 *  review's color, B in "one review in"'s, the stage it marks. */
function stretchesOf(lane: AuditLane): Stretch[] {
  return partsOf(lane).flatMap((p): Stretch[] => {
    if (p.part !== 'review') return [{ id: p.part, p, phase: partPhase(p) }];
    return (['A', 'B'] as const).map((key) => {
      const step = stepOf(lane, key);
      return { id: key, p: { part: 'review', state: step.state, steps: [step] }, phase: step.state === 'failed' ? 'conflict' : key === 'A' ? 'review' : 'reviewed' };
    });
  });
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
  const spans = stretchesOf(lane).map((stretch): SpanStripSpan => {
    const { p, id, phase } = stretch;
    const times = timesOf(p, now);
    // A patch waits from its fix's end for the round's batch, shaded by what the fix did; any other part not begun yet
    // can begin no earlier than now. B starts no earlier than A's span ends, so the two never overlap on one row.
    const waitsForBatch = p.part === 'patch' && p.state === 'waiting' && lane.steps.fix.state === 'done';
    const unbegun = p.state === 'waiting' && !waitsForBatch ? Math.max(cursor, now) : cursor;
    const start = id === 'B' ? Math.max(times.start ?? unbegun, cursor) : times.start ?? unbegun;
    const typical = TYPICAL_MINUTES[p.part] * MIN;
    const end = id === 'B' && p.state === 'running'
      ? Math.max(now, start + Math.max(0, typical - (now - (times.start ?? now))))
      : times.end ?? (waitsForBatch
        ? Math.max(now, start + TYPICAL_MINUTES.patch * MIN)
        : start + (p.state === 'done' ? (measuredOf(p) ?? TYPICAL_MINUTES[p.part]) * MIN : typical));
    if (p.state === 'running') elapsed = minutesText((now - (times.start ?? start)) / MIN);
    if (p.state === 'done' || p.state === 'failed') ended = Math.max(ended ?? end, end);
    cursor = end;
    const steps: readonly LaneStepKey[] = id === 'A' || id === 'B' ? [id] : STEPS_OF[p.part];
    const title = steps.map((name) => `${name}: ${stepText(name, stepOf(lane, name), now)}`).join('; ');
    return {
      id, label: partLabel(lane, stretch, now), start, ms: Math.max(0, end - start), color: partColor(p.part, phase), state: SPAN_STATE[p.state], title,
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

