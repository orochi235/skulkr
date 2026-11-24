/** The steps view of a lane: one column per step, filled by how far it has got. */
import type { SpanStripSpan } from '@weasel-js/ui/components/SpanStrip';
import { MIN, SPAN_STATE, ms, patchFillOf, tallyOf, withInk, withUnfixed } from './laneSpans';
import { TYPICAL_MINUTES, checkingOf, partColor, stepOf, type AuditPhase, type Part } from './phases';
import { NODE_SEP, stepText } from './runData';
import type { AuditLane, LaneStep, LaneStepKey } from './skulkrMap.types';

/** The steps view's columns, one stripe: the two blind reviews one after the other, as B starts once A's prompt is
 *  cached and often once a slot frees, then every later step. */
const STEP_COLUMNS: readonly { step: LaneStepKey; part: Part; phase: AuditPhase; start: number; width: number }[] = [
  { step: 'A', part: 'review', phase: 'review', start: 0, width: 1 },
  { step: 'B', part: 'review', phase: 'reviewed', start: 1, width: 1 },
  { step: 'match', part: 'match', phase: 'match', start: 2, width: 1 },
  { step: 'fix', part: 'fix', phase: 'fix', start: 3, width: 1 },
  // The fix's checking: its fixer's own checks, then a verify or repair job of the controller's, in one column.
  { step: 'repair', part: 'repair', phase: 'fix', start: 4, width: 0.5 },
  // Applying a patch takes no time to speak of; its column is wide enough for its tally.
  { step: 'patch', part: 'patch', phase: 'patch', start: 4.5, width: 0.6 },
];

/** The column after the fix's own: lit while its fixer runs its checks past its last commit, until a verify or
 *  repair job of the controller's takes it over. */
const CHECKS_COLUMN = { start: 4, width: 0.5 } as const;


/** A running fixer's checks as words, `6/7 · 2 failing`, or '' where none are counted. */
const checksText = (fix: LaneStep): string =>
  (fix.checks && fix.checks.total ? `${fix.checks.done}/${fix.checks.total}${fix.checks.failed ? ` · ${fix.checks.failed} failing` : ''}` : '');

/** The fixer's checks: lit while it runs them, carrying the node doing it, and filled once it ends. */
function checksSpan(fix: LaneStep): SpanStripSpan {
  const checking = checkingOf(fix);
  const state = fix.state === 'done' ? 'done' : fix.state === 'failed' ? 'failed' : checking ? 'active' : 'pending';
  return {
    id: 'checks', start: CHECKS_COLUMN.start, ms: CHECKS_COLUMN.width, title: ['the fixer\'s checks', checksText(fix), fix.now?.text ?? ''].filter(Boolean).join('\n'),
    label: checking ? [fix.node ?? '', checksText(fix)].filter(Boolean).join(NODE_SEP) : '', state, fill: state === 'pending' ? 0 : 1, color: 'var(--audit-checks)',
  };
}

/** The fix span while its fixer runs its checks: no longer active, its node moved onto the checks column. */
const fixWhileChecking = (span: SpanStripSpan, fix: LaneStep): SpanStripSpan =>
  (checkingOf(fix) ? { ...span, state: 'done', label: span.label.slice(span.label.indexOf(NODE_SEP) + NODE_SEP.length) } : span);

/** A finished step's span, other than the patch's, in dark gray with white ink, so what is still moving stands out. */
function withDone(span: SpanStripSpan): SpanStripSpan {
  return span.state === 'done' && !span.id.startsWith('patch') ? { ...span, color: 'var(--audit-stage-done)', ink: 'var(--audit-stage-done-ink)' } : span;
}

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
  return STEP_COLUMNS.filter((c) => c.step !== 'repair' || repairing(lane)).map(({ step, part, phase, start, width }): SpanStripSpan => {
    const s = stepOf(lane, step);
    const since = s.state === 'running' ? ms(s.since) : null;
    const fill = s.state === 'done' || s.state === 'failed' ? 1
      : step === 'patch' ? patchFillOf(lane)
      // Its count runs to full: the checks after its last commit light a column of their own.
      : s.state === 'running' && s.total ? Math.min(1, (s.done ?? 0) / s.total)
      : since !== null ? Math.min(RUNNING_FILL_CAP, (now - since) / (TYPICAL_MINUTES[part] * MIN))
      : 0;
    return {
      id: step, start, ms: width, fill, state: SPAN_STATE[s.state], title: [`${step}: ${stepText(step, s, now)}`, s.state === 'running' ? s.now?.text ?? '' : ''].filter(Boolean).join('\n'),
      label: step === 'patch' && s.state !== 'failed' ? tallyOf(lane) : s.state === 'waiting' ? '' : stepText(step, s, now),
      color: partColor(part, s.state === 'failed' ? 'conflict' : phase),
    };
  }).flatMap((span) => (span.id === 'patch' && span.state !== 'failed' ? withUnfixed(span, lane) : span.id === 'fix' ? [fixWhileChecking(span, lane.steps.fix), ...(repairing(lane) ? [] : [checksSpan(lane.steps.fix)])] : [span]))
    .map((span) => withDone(withInk(span)));
}
