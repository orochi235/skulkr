/** What both views of a lane share: a step's span state, a time read from the map, and the patch span's shading, split,
 *  ink and caption. */
import type { SpanState, SpanStripSpan } from '@weasel-js/ui/components/SpanStrip';
import { phaseInkOf } from './phases';
import type { AuditLane, LaneStep } from './skulkrMap.types';

export const MIN = 60_000;

/** An ISO time from the map in epoch ms, or null for none or one that does not parse. */
export const ms =(iso: string | undefined): number | null => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : null;
};

export const SPAN_STATE: Readonly<Record<LaneStep['state'], SpanState>> = { waiting: 'pending', running: 'active', done: 'done', failed: 'failed' };

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
export function withInk(span: SpanStripSpan): SpanStripSpan {
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
