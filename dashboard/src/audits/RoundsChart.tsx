import { niceDomain, stepTicks, tickStep } from '@weasel-js/scale';
import { useId, useRef } from 'react';
import { useElementSize } from '@weasel-js/routing/react';
import { Button, DialogTrigger } from 'react-aria-components';
import { Icon } from '@weasel-js/ui/components/Icon';
import { Popover, PopoverDialog } from '@weasel-js/ui/components/Popover';
import { icon } from '@dash/icons.gen';
import type { AuditArea, AuditRound } from './skulkrMap.types';
import s from './RoundsChart.module.css';

/** The chart's drawing size before its box is measured; it then draws at its box's width, so the bars take the room. */
const FALLBACK_W = 272, H = 190;
const PENDING_LABEL = { live: 'live', unmerged: 'unmerged' } as const;
const M = { top: 8, right: 6, bottom: 22, left: 40 };

/** Round ticks for a value axis from 0 to at least `max`: a step of 1, 2 or 5 times a power of ten. */
export function ticksFor(max: number, count = 4): number[] {
  if (!(max > 0)) return [0];
  const [, top] = niceDomain([0, max], count);
  return stepTicks(0, top, tickStep(0, top, count));
}

/** `n` of a round's defects per area it read, so a round of 8 areas and one of 16 stand on one scale. */
const perArea = (n: number, r: AuditRound) => (r.areas > 0 ? n / r.areas : 0);

/** A round fewer than half of whose areas finished: too few to estimate from, so it neither sets the scale nor draws
 *  an estimate, only what it found. */
export const isPartial = (r: AuditRound) => (r.incomplete ?? 0) > r.areas;

/** An area's passes as rounds of one area each, so the chart draws them on the same terms. */
export const areaRoundsOf = (area: AuditArea): AuditRound[] => area.passes.map((p) => ({
  round: p.round, date: p.date, areas: 1, files: area.files, distinct: p.distinct, est: p.est,
  ...(p.provisional ? { pending: 'live' as const } : {}),
}));

/** The fewest passes an area needs before the chart draws it alone rather than every round. */
export const AREA_CHART_PASSES = 2;

/** What an area's nth pass (index `n`) found on average across every area that has one: `{ mean, of }` for each n. */
export function nthPassAverages(areas: readonly AuditArea[]): { mean: number; of: number }[] {
  const out: { sum: number; of: number }[] = [];
  for (const a of areas) a.passes.forEach((p, n) => { out[n] ??= { sum: 0, of: 0 }; out[n]!.sum += p.distinct; out[n]!.of += 1; });
  return out.map(({ sum, of }) => ({ mean: of ? sum / of : 0, of }));
}

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
const passesText = (n: number) => (n === 0 ? 'has not been audited yet' : `has ${n === 1 ? 'one pass' : `${n} passes`}; every round shown`);

/** Each round's distinct defects found per area, against Chapman's estimate per area of what its areas held; or,
 *  given an `area` with at least {@link AREA_CHART_PASSES} passes, each of that area's passes, each beside what an
 *  area's pass in the same place found on average across `areas`. */
export function RoundsChart({ rounds: all, area: picked, areas = [] }: {
  rounds: readonly AuditRound[]; area?: AuditArea | null; areas?: readonly AuditArea[];
}) {
  const box = useRef<HTMLDivElement>(null);
  const measured = useElementSize(box).width;
  const W = measured > 0 ? measured : FALLBACK_W;
  const area = picked && picked.passes.length >= AREA_CHART_PASSES ? picked : null;
  const rounds = area ? areaRoundsOf(area) : all;
  const averages = area ? nthPassAverages(areas) : [];
  const unit = area ? 'defects' : 'defects per area';
  const ticks = ticksFor(Math.max(0, ...rounds.filter((r) => !isPartial(r)).map((r) => perArea(Math.max(r.est, r.distinct), r)), ...rounds.map((_, i) => averages[i]?.mean ?? 0)));
  const top = ticks.at(-1) || 1;
  const y = (v: number) => H - M.bottom - ((H - M.top - M.bottom) * Math.min(v, top)) / top;
  const band = (W - M.left - M.right) / Math.max(1, rounds.length);
  // Beside an average, each of the area's bars takes half its share of the band, interlaced with the average's.
  const bar = area ? band * 0.4 : band * 0.75;
  const x = (i: number) => M.left + i * band + (area ? band * 0.08 : (band - bar) / 2);
  const hatch = useId();
  return (
    <>
      <div ref={box} className={s.box}>
      {rounds.length > 0 && (
        // Keyed by scope, so leaving an area's chart draws on a fresh svg rather than patching its bars in place.
        <svg key={area ? `area:${area.id}` : 'all'} className={s.chart} viewBox={`0 0 ${W} ${H}`} role="img"
          aria-label={area ? `Defects found and estimated in ${area.id}, by round` : 'Defects found and estimated per area, by round'}>
          <defs>
            <pattern id={hatch} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line className={s.hatch} x1="0" y1="0" x2="0" y2="4" />
            </pattern>
          </defs>
          <text className={s.title} transform={`translate(11 ${(M.top + H - M.bottom) / 2}) rotate(-90)`} textAnchor="middle">{unit}</text>
          {ticks.map((t) => (
            <g key={t}>
              <line className={s.grid} x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} />
              <text className={s.axis} x={M.left - 4} y={y(t) + 3} textAnchor="end">{t}</text>
            </g>
          ))}
          {rounds.map((r, i) => (
            <g key={r.round}>
              {!isPartial(r) && <rect className={s.est} x={x(i)} width={bar} y={y(perArea(r.est, r))} height={y(0) - y(perArea(r.est, r))} />}
              <rect className={r.pending || isPartial(r) ? s.pending : s.found} x={x(i)} width={bar} y={y(perArea(r.distinct, r))} height={y(0) - y(perArea(r.distinct, r))}
                fill={r.pending || isPartial(r) ? `url(#${hatch})` : undefined}>
                <title>{area
                  ? `round ${r.round}${r.pending ? ` (${PENDING_LABEL[r.pending]})` : ''}: ${r.distinct} found and ${r.est.toFixed(1)} estimated in ${area.id}`
                  : `round ${r.round}${r.pending ? ` (${PENDING_LABEL[r.pending]})` : ''}: ${perArea(r.distinct, r).toFixed(1)} found and ${perArea(r.est, r).toFixed(1)} estimated per area; ${r.distinct} and ${r.est} over ${r.areas} areas`}{r.incomplete ? `; ${r.incomplete} more came back incomplete and are not counted${isPartial(r) ? ', too many to estimate from' : ''}` : ''}</title>
              </rect>
              {averages[i] && (
                <rect className={s.avg} x={x(i) + bar + band * 0.04} width={bar} y={y(averages[i]!.mean)} height={y(0) - y(averages[i]!.mean)}>
                  <title>{`an area's ${ordinal(i + 1)} pass found ${averages[i]!.mean.toFixed(1)} on average, over ${averages[i]!.of} areas`}</title>
                </rect>
              )}
              {!r.pending && r.incomplete ? <text className={s.tag} x={x(i) + bar / 2} y={Math.max(M.top + 6, y(perArea(isPartial(r) ? r.distinct : Math.max(r.est, r.distinct), r)) - 3)} textAnchor="middle">{`${r.areas} of ${r.areas + r.incomplete}`}</text> : null}
              {r.pending && <text className={s.tag} x={x(i) + bar / 2} y={Math.max(M.top + 6, y(perArea(Math.max(r.est, r.distinct), r)) - 3)} textAnchor="middle">{PENDING_LABEL[r.pending]}</text>}
              <text className={s.axis} x={area ? M.left + (i + 0.5) * band : x(i) + bar / 2} y={H - 8} textAnchor="middle">{r.round}</text>
            </g>
          ))}
        </svg>
      )}
      </div>
      <div className={s.foot}>
        <span className={s.scope}>
          {area ? <><strong>{area.id}</strong>, each round that read it</>
            : picked ? <><strong>{picked.id}</strong> {passesText(picked.passes.length)}</> : 'per area the round read'}
        </span>
        <DialogTrigger>
          <Button className={s.about} aria-label="What the rounds chart shows"><Icon name={icon('ui:info')} size={14} /></Button>
          <Popover placement="bottom end" offset={6}>
            <PopoverDialog aria-label="What the rounds chart shows" className={s.aboutText}>
              {area ? <><strong>{area.id}</strong>, each round that read it.</> : 'Per area the round read.'} Solid: distinct defects
              found. Dashed: Chapman&apos;s estimate of what those areas held. Hatched: a round not merged yet, or still running,
              read from its run&apos;s own results.{area ? ' Gray: what an area\'s pass in the same place (its first, second, …) found on average, across every area.' : ''}
            </PopoverDialog>
          </Popover>
        </DialogTrigger>
      </div>
    </>
  );
}
