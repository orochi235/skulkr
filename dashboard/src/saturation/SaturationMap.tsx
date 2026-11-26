import { useEffect, useMemo, useRef, useState } from 'react';
import { asNodeId } from '@weasel-js/core';
import { useSelection } from '@weasel-js/editing';
import { createAuditScene } from '@dash/audits/auditScene';
import { SATURATION_METRICS } from '@dash/audits/heatMetrics';
import { Treemap } from '@dash/audits/Treemap';
import { useAuditPalette } from '@dash/audits/useAuditPalette';
import type { AuditArea } from '@dash/audits/skulkrMap.types';
import type { AuditPhase } from '@dash/audits/phases';
import palette from '@dash/audits/palette.module.css';
import type { SaturationLedger } from './saturation.types';
import s from './SaturationMap.module.css';

/** Each area's saturation figures from its own ledger (not one set aside): its defects not yet resolved, by the
 *  registry where its ledger has landed, and its unseen estimate. */
export const saturationByArea = (ledgers: readonly SaturationLedger[]) => new Map(ledgers.filter((l) => l.id === l.area).map((l) => [l.area, {
  open: l.defects.filter((d) => (d.registry?.status ?? 'open') === 'open').length,
  unseen: l.unseen,
  distinct: l.distinct,
  occasions: l.occasions,
  nextNew: l.nextNew,
  total: l.total,
  costUsd: l.costUsd,
}]));

/** Each area a live scour process holds, in the phase its jobs are in: `match` while a ledger matcher runs, else
 *  `review`. */
export const scourPhasesOf = (ledgers: readonly SaturationLedger[]): ReadonlyMap<string, AuditPhase> => new Map(
  ledgers.filter((l) => l.id === l.area && l.running).map((l) => [l.area, l.running!.jobs.some((j) => j.step?.startsWith('match')) ? 'match' : 'review']),
);

/** The audit map's treemap, shaded by what each area's saturation ledger says; picking an area picks its ledger. */
export function SaturationMap({ areas, ledgers, picked, onPick }: {
  areas: readonly AuditArea[]; ledgers: readonly SaturationLedger[]; picked: string | null; onPick: (id: string | null) => void;
}) {
  const [scene] = useState(createAuditScene);
  const selection = useSelection({ scene, mode: 'single' });
  const { probes, palette: colors } = useAuditPalette();
  const phases = useMemo(() => scourPhasesOf(ledgers), [ledgers]);
  // The treemap outlines the areas a live run holds; here a live scour holds them.
  const shaded = useMemo(() => {
    const by = saturationByArea(ledgers);
    return areas.map((a) => {
      const shown = by.has(a.id) ? { ...a, saturation: by.get(a.id)! } : a;
      return phases.has(a.id) ? { ...shown, status: 'tonight' as const } : shown;
    });
  }, [areas, ledgers, phases]);
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
        colorByPref="saturation.colorBy" metrics={SATURATION_METRICS}
      />
    </div>
  );
}
