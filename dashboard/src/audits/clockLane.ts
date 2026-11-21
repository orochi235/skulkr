/** The clock view of a lane: each stretch placed on the run's clock where and for as long as it ran. */
import type { SpanStripSpan } from '@weasel-js/ui/components/SpanStrip';
import { MIN, SPAN_STATE, ms, patchFillOf, tallyOf, withInk, withUnfixed } from './laneSpans';
import { STEPS_OF, TYPICAL_MINUTES, isFinished, partColor, partPhase, partsOf, phaseOf, stepOf, type AuditPhase, type PartState } from './phases';
import { minutesText, stepText } from './runData';
import type { AuditLane, AuditRun } from './skulkrMap.types';

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

