import { useEffect, useMemo, useRef, useState } from 'react';
import { asNodeId } from '@weasel-js/core';
import { useSelection } from '@weasel-js/editing';
import { createAuditScene } from '@dash/audits/auditScene';
import { useDashPref, type HeightMetric } from '@dash/audits/dashPrefs';
import { HEAT_METRIC_SPECS, SATURATION_METRICS } from '@dash/audits/heatMetrics';
import { Treemap } from '@dash/audits/Treemap';
import { useAuditPalette } from '@dash/audits/useAuditPalette';
import type { AuditArea } from '@dash/audits/skulkrMap.types';
import type { AuditPhase } from '@dash/audits/phases';
import palette from '@dash/audits/palette.module.css';
import { heroCountsOf } from './LedgerHero';
import type { SaturationLedger } from './saturation.types';
import s from './SaturationMap.module.css';

/** Hours since fix run `run` ended at `now`: 0 while it runs, null with no run. */
export const fixHoursOf = (run: { readonly finished: string | null } | null | undefined, now: number): number | null => {
  if (!run) return null;
  if (!run.finished) return 0;
  return Math.max(0, (now - Date.parse(run.finished)) / 3_600_000);
};

/** Each area's saturation figures from its own ledger (not one set aside): its defects open and fixed as its hero counts
 *  them (open: not fixed, fixing or closed by a fix run or the registry), its hours since a fix run, and its unseen estimate. */
export const saturationByArea = (ledgers: readonly SaturationLedger[], now: number = Date.now()) => new Map(ledgers.filter((l) => l.id === l.area).map((l) => [l, heroCountsOf(l)] as const).map(([l, counts]) => [l.area, {
  open: counts.open,
  fixed: counts.fixed,
  fixedPerKloc: l.lines ? (1000 * counts.fixed) / l.lines : null,
  fixHours: fixHoursOf(l.fix?.lastRun, now),
  unseen: l.unseen,
  distinct: l.distinct,
  occasions: l.occasions,
  nextNew: l.nextNew,
  total: l.total,
  costUsd: l.costUsd,
  unseenPerKloc: l.unseenPerKloc,
  defectsPerKloc: l.defectsPerKloc,
  usdPerKloc: l.usdPerKloc,
  nextUsd: l.nextUsd,
  limitUsd: l.limit.usd,
  goingUsd: l.limit.goingUsd,
  stopped: l.stopped,
}]));

/** Each area a live scour process holds, in the phase its jobs are in: `fix` for a fix run, `match` while a ledger
 *  matcher runs, else `review`. */
export const scourPhasesOf = (ledgers: readonly SaturationLedger[]): ReadonlyMap<string, AuditPhase> => new Map(
  ledgers.filter((l) => l.id === l.area && l.running).map((l) => [l.area, l.running!.does === 'fix' ? 'fix' : l.running!.jobs.some((j) => j.step?.startsWith('match')) ? 'match' : 'review']),
);

/** The map's areas as the Scour page shows them: each with its own ledger's figures, its place in `queue` (the rounds'
 *  place dropped), and outlined as live (`tonight`) where a live scour holds it. */
export const mapAreasFor = (areas: readonly AuditArea[], ledgers: readonly SaturationLedger[], queue: readonly string[], phases: ReadonlyMap<string, AuditPhase>): AuditArea[] => {
  const by = saturationByArea(ledgers);
  const place = new Map(queue.map((id, i) => [id, i + 1]));
  return areas.map((a) => {
    const shown = { ...a, queue: place.get(a.id) ?? null, ...(by.has(a.id) ? { saturation: by.get(a.id)! } : {}) };
    return phases.has(a.id) ? { ...shown, status: 'tonight' as const } : shown;
  });
};

/** The most pixels a cell stands off the map: the area highest on the metric stands this high. */
const MAX_RISE = 28;

/** How high each area stands on `metric`, in proportion to its value, the highest `MAX_RISE`; null for flat. */
export const risesFor = (areas: readonly AuditArea[], metric: HeightMetric): ReadonlyMap<string, number> | null => {
  if (metric === 'flat') return null;
  const values = [...HEAT_METRIC_SPECS[metric].valuesIn(areas)].filter((e): e is [string, number] => e[1] !== null && e[1] > 0);
  const most = Math.max(0, ...values.map(([, v]) => v));
  return most > 0 ? new Map(values.map(([id, v]) => [id, (v / most) * MAX_RISE])) : null;
};

/** The audit map's treemap, shaded by what each area's saturation ledger says and numbered by `queue`, the order
 *  `scour run` would delve them in (not the rounds' queue); picking an area picks its ledger. */
export function SaturationMap({ areas, icons, ledgers, queue, picked, onPick }: {
  areas: readonly AuditArea[]; icons?: Readonly<Record<string, string>>; ledgers: readonly SaturationLedger[]; queue: readonly string[];
  picked: string | null; onPick: (id: string | null) => void;
}) {
  const [scene] = useState(createAuditScene);
  const selection = useSelection({ scene, mode: 'single' });
  const { probes, palette: colors } = useAuditPalette();
  const phases = useMemo(() => scourPhasesOf(ledgers), [ledgers]);
  // The treemap outlines the areas a live run holds; here a live scour holds them.
  const shaded = useMemo(() => mapAreasFor(areas, ledgers, queue, phases), [areas, ledgers, queue, phases]);
  const [heightBy, setHeightBy] = useDashPref('saturation.heightBy');
  const rises = useMemo(() => risesFor(shaded, heightBy), [heightBy, shaded]);
  const selected = selection.current[0] ?? null;
  // The page's pick and the map's selection follow each other. A change the map's own clicks make picks (or unpicks);
  // one this component makes to follow the pick is noted first, so it never picks back.
  const lastSelected = useRef<string | null>(selected);
  useEffect(() => {
    if (selected === lastSelected.current) return;
    lastSelected.current = selected;
    if (selected !== picked) onPick(selected);
  }, [selected, picked, onPick]);
  useEffect(() => {
    const target = picked && shaded.some((a) => a.id === picked) ? picked : null;
    if (target === (selection.get()[0] ?? null)) return;
    lastSelected.current = target;
    if (target) selection.set([asNodeId(target)]);
    else selection.clear();
  }, [picked, selection, shaded]);
  return (
    <div className={`${palette.palette} ${s.map}`}>
      {probes}
      <Treemap
        scene={scene} selection={selection} areas={shaded} palette={colors} phases={phases} onHover={() => {}}
        colorByPref="saturation.colorBy" metrics={SATURATION_METRICS} bare numbered byOnes rises={rises} {...(icons ? { glyphs: icons } : {})}
        legendExtra={(
          <select className={s.heightBy} aria-label="Raise the map by" value={heightBy} onChange={(e) => setHeightBy(e.currentTarget.value as HeightMetric)}>
            <option value="flat">flat</option>
            {SATURATION_METRICS.map((m) => <option key={m} value={m}>height: {HEAT_METRIC_SPECS[m].name}</option>)}
          </select>
        )}
      />
    </div>
  );
}
