import { useElementSize } from '@weasel-js/routing/react';
import { Icon } from '@weasel-js/ui/components/Icon';
import { Popover, PopoverDialog } from '@weasel-js/ui/components/Popover';
import { icon } from '@dash/icons.gen';
import { useRef } from 'react';
import { Button, DialogTrigger } from 'react-aria-components';
import { CHART_ROUNDS, ticksFor } from './RoundsChart';
import type { AuditCalibration, CalibrationFactor } from './skulkrMap.types';
import s from './CalibrationChart.module.css';

const FALLBACK_W = 272, FALLBACK_H = 190;
const M = { top: 8, right: 30, bottom: 22, left: 40 };

const factorText = (f: number | null) => (f === null ? '–' : `${f.toFixed(2)}×`);

/** The overall factor and its pair count, as the caption reads it. */
export const captionOf = (cal: AuditCalibration): string => {
  const { factor, pairs } = cal.factors.overall;
  return factor === null ? `no factor yet, over ${pairs} pairs` : `later passes found ${factorText(factor)} the left predicted, over ${pairs} pairs`;
};

function BucketTable({ cal }: { cal: AuditCalibration }) {
  const rows: [string, CalibrationFactor][] = [...Object.entries(cal.factors.byShared), ['all', cal.factors.overall]];
  return (
    <table className={s.table}>
      <thead><tr><th className={s.label}>shared</th><th>pairs</th><th>predicted</th><th>found</th><th>factor</th></tr></thead>
      <tbody>
        {rows.map(([bucket, f]) => (
          <tr key={bucket}>
            <td className={s.label}>{bucket}</td><td>{f.pairs}</td><td>{f.predicted.toFixed(1)}</td><td>{f.found.toFixed(1)}</td><td>{factorText(f.factor)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Per round, the defects its passes predicted were left beside what their areas' next passes found, with the
 *  factor pooled over that round and every earlier one. */
export function CalibrationChart({ calibration: cal }: { calibration?: AuditCalibration | undefined }) {
  const box = useRef<HTMLDivElement>(null);
  const measured = useElementSize(box);
  const W = measured.width > 0 ? measured.width : FALLBACK_W;
  const H = measured.height > 0 ? measured.height : FALLBACK_H;
  const series = (cal?.series ?? []).slice(-CHART_ROUNDS);
  const ticks = ticksFor(Math.max(0, ...series.map((p) => Math.max(p.predicted, p.found))));
  const top = ticks.at(-1) || 1;
  const fTicks = ticksFor(Math.max(1, ...series.map((p) => p.factor ?? 0)), 3);
  const fTop = fTicks.at(-1) || 1;
  const yAt = (v: number, max: number) => H - M.bottom - ((H - M.top - M.bottom) * Math.min(v, max)) / max;
  const y = (v: number) => yAt(v, top);
  const fy = (v: number) => yAt(v, fTop);
  const band = (W - M.left - M.right) / Math.max(1, series.length);
  const bar = band * 0.36;
  const x = (i: number) => M.left + i * band + band * 0.12;
  const mid = (i: number) => M.left + (i + 0.5) * band;
  const line = series.flatMap((p, i) => (p.factor === null ? [] : [`${mid(i)},${fy(p.factor)}`])).join(' ');
  return (
    <div className={s.frame}>
      <div ref={box} className={s.box}>
        {series.length === 0 ? <p className={s.hint}>No area has had two passes yet.</p> : (
          <svg className={s.chart} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Defects predicted left against found by the next pass, by round">
            <text className={s.title} transform={`translate(11 ${(M.top + H - M.bottom) / 2}) rotate(-90)`} textAnchor="middle">defects</text>
            {ticks.map((t) => (
              <g key={t}>
                <line className={s.grid} x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} />
                <text className={s.axis} x={M.left - 4} y={y(t) + 3} textAnchor="end">{t}</text>
              </g>
            ))}
            {fTicks.map((t) => <text key={t} className={s.factorAxis} x={W - M.right + 4} y={fy(t) + 3} textAnchor="start">{`${t}×`}</text>)}
            {series.map((p, i) => (
              <g key={p.round}>
                <rect className={s.predicted} x={x(i)} width={bar} y={y(p.predicted)} height={y(0) - y(p.predicted)} />
                <rect className={s.found} x={x(i) + bar + band * 0.04} width={bar} y={y(p.found)} height={y(0) - y(p.found)}>
                  <title>{`round ${p.round}: ${p.predicted.toFixed(1)} predicted left over ${p.pairs} ${p.pairs === 1 ? 'area' : 'areas'}, ${p.found.toFixed(1)} found by their next pass; ${factorText(p.factor)} pooled to here`}</title>
                </rect>
                <text className={s.axis} x={mid(i)} y={H - 8} textAnchor="middle">{p.round}</text>
              </g>
            ))}
            {line && <polyline className={s.factor} points={line} />}
            {series.map((p, i) => (p.factor === null ? null : <circle key={p.round} className={s.factorDot} cx={mid(i)} cy={fy(p.factor)} r={2.5} />))}
          </svg>
        )}
      </div>
      <div className={s.foot}>
        <span className={s.scope}>{cal ? captionOf(cal) : 'no calibration in this map'}</span>
        {cal && (
          <DialogTrigger>
            <Button className={s.about} aria-label="What the calibration chart shows"><Icon name={icon('ui:info')} size={14} /></Button>
            <Popover placement="bottom end" offset={6}>
              <PopoverDialog aria-label="What the calibration chart shows" className={s.aboutText}>
                <p className={s.para}>
                  Dashed: the defects a round&apos;s passes estimated were left. Solid: the distinct defects the next pass
                  of each of those areas found. Line: found over predicted, pooled over that round and every earlier one.
                  The next pass came after the fixes and counts defects added since, so it is only a rough check.
                </p>
                <BucketTable cal={cal} />
                <p className={s.para}>
                  A pass&apos;s corrected left is its left times its shared bucket&apos;s factor, or the overall one under{' '}
                  {cal.minPairs} pairs, never under 1×.
                </p>
              </PopoverDialog>
            </Popover>
          </DialogTrigger>
        )}
      </div>
    </div>
  );
}
