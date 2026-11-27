/** What the map can shade its areas by, besides the defects estimated left that it shades by first. */
import { foundIn, heatScaleFor, lastPassOf, roundCountOf, type HeatScale } from './areaData';
import type { HeatScheme } from './heatSchemes';
import type { AuditArea } from './skulkrMap.types';

export const HEAT_METRICS = ['left', 'density', 'fixed', 'found', 'queue', 'open', 'stale', 'age', 'rounds', 'files'] as const;
/** What the saturation page's map can shade by besides: its areas' saturation ledgers, which the audit map lacks. */
export const SATURATION_METRICS = ['saturation', 'saturationNextNew', 'saturationUnseen', 'saturationUnseenPerKloc', 'saturationOpen', 'saturationDefects', 'saturationDefectsPerKloc', 'saturationTotal', 'saturationReviews', 'saturationSpend', 'saturationSpendPerKloc'] as const;
export type HeatMetric = (typeof HEAT_METRICS)[number] | (typeof SATURATION_METRICS)[number];
/** Every metric, each with a ramp the viewer may choose. */
export const ALL_METRICS: readonly HeatMetric[] = [...SATURATION_METRICS, ...HEAT_METRICS];

/** One metric: its name in the menu, what the legend says before its bar, what an area with no value is called, the
 *  scheme it starts in, and its value for each area (null where it has none). */
export interface HeatMetricSpec {
  readonly name: string;
  readonly legend: string;
  readonly none: string;
  readonly scheme: HeatScheme;
  /** The least the scale's top may be, so a quiet map does not paint its few values hot. */
  readonly floor: number;
  /** A low value is the hot end: the queue's first place. */
  readonly reverse?: boolean;
  /** A percentage or any value whose steps all count alike: a straight scale, not the log one counts get. */
  readonly linear?: boolean;
  readonly valuesIn: (areas: readonly AuditArea[]) => ReadonlyMap<string, number | null>;
}

const each = (areas: readonly AuditArea[], valueOf: (area: AuditArea) => number | null) => new Map(areas.map((a) => [a.id, valueOf(a)]));

/**
 * How spent an area's scour is, in percent: where its next defect's price sits between the project's going rate (0, as
 * ripe as the cheapest areas) and its per-defect limit (100, where the delve stops). A ledger without a price of its own
 * yet (under two passes) is as ripe as a fresh area, and one that has stopped, for any reason, is 100.
 */
export const saturationOf = (s: AuditArea['saturation']): number | null => {
  if (!s || !s.limitUsd) return null;
  if (s.stopped) return 100;
  const going = s.goingUsd ?? 0;
  if (s.nextUsd == null || s.limitUsd <= going) return 0;
  return Math.min(100, Math.max(0, (100 * (s.nextUsd - going)) / (s.limitUsd - going)));
};

/** What an area's estimate says is left, 0 once it has settled; null with no pass. */
const leftOf = (area: AuditArea): number | null => (area.status === 'settled' ? 0 : lastPassOf(area)?.left ?? null);

export const HEAT_METRIC_SPECS: Readonly<Record<HeatMetric, HeatMetricSpec>> = {
  left: { name: 'defects left', legend: 'estimated defects left', none: 'never audited', scheme: 'thermal', floor: 8, valuesIn: (areas) => each(areas, leftOf) },
  density: {
    name: 'defects left per 10 files', legend: 'estimated defects left per 10 files', none: 'never audited', scheme: 'magma', floor: 2,
    valuesIn: (areas) => each(areas, (a) => { const left = leftOf(a); return left === null ? null : (left / Math.max(1, a.files)) * 10; }),
  },
  fixed: {
    name: 'defects fixed', legend: 'defects fixed, every round', none: 'never audited', scheme: 'moss', floor: 8,
    valuesIn: (areas) => each(areas, (a) => (a.passes.length ? a.passes.reduce((n, p) => n + (p.fixed ?? 0) * (p.share ?? 1), 0) : null)),
  },
  found: {
    name: 'defects found', legend: 'defects found, every round', none: 'never audited', scheme: 'ember', floor: 8,
    valuesIn: (areas) => each(areas, (a) => (a.passes.length ? foundIn(a) : null)),
  },
  queue: {
    name: 'priority next', legend: 'place in the queue, first hottest', none: 'not queued', scheme: 'inferno', floor: 16, reverse: true,
    valuesIn: (areas) => each(areas, (a) => (a.queue !== null && a.status !== 'tonight' ? a.queue : null)),
  },
  open: {
    name: 'open findings', legend: 'findings no fixer has acted on', none: 'never audited', scheme: 'ironbow', floor: 3,
    valuesIn: (areas) => each(areas, (a) => (a.passes.length ? a.openFindings ?? 0 : null)),
  },
  stale: {
    name: 'lines changed since', legend: 'lines changed since the last pass', none: 'never audited', scheme: 'ice', floor: 100,
    valuesIn: (areas) => each(areas, (a) => (a.passes.length ? a.staleLines ?? 0 : null)),
  },
  age: {
    name: 'rounds since a pass', legend: 'rounds since its last pass', none: 'never audited', scheme: 'whitehot', floor: 10,
    valuesIn: (areas) => {
      const latest = Math.max(0, ...areas.flatMap((a) => a.passes.map((p) => p.round)));
      return each(areas, (a) => { const last = lastPassOf(a); return last ? latest - last.round : null; });
    },
  },
  rounds: { name: 'rounds read', legend: 'rounds that read it', none: 'never audited', scheme: 'viridis', floor: 5, valuesIn: (areas) => each(areas, (a) => (a.passes.length ? roundCountOf(a) : null)) },
  files: { name: 'files', legend: 'source files', none: 'no files', scheme: 'ice', floor: 20, valuesIn: (areas) => each(areas, (a) => a.files) },
  saturationOpen: {
    name: 'defects open', legend: 'scour defects no fixer has resolved', none: 'no scour ledger', scheme: 'ember', floor: 5,
    valuesIn: (areas) => each(areas, (a) => a.saturation?.open ?? null),
  },
  saturationUnseen: {
    name: 'defects not found yet (est.)', legend: 'defects the scour estimates no review has found yet', none: 'no estimate yet', scheme: 'magma', floor: 5,
    valuesIn: (areas) => each(areas, (a) => a.saturation?.unseen ?? null),
  },
  saturationUnseenPerKloc: {
    name: 'defects not found yet per 1,000 lines (est.)', legend: 'defects the scour estimates no review has found yet, per thousand lines', none: 'no estimate yet', scheme: 'magma', floor: 5,
    valuesIn: (areas) => each(areas, (a) => a.saturation?.unseenPerKloc ?? null),
  },
  saturationDefectsPerKloc: {
    name: 'defects found per 1,000 lines', legend: 'distinct defects its scour reviews found, per thousand lines', none: 'no scour ledger', scheme: 'ember', floor: 10,
    valuesIn: (areas) => each(areas, (a) => a.saturation?.defectsPerKloc ?? null),
  },
  saturationSpendPerKloc: {
    name: 'spend per 1,000 lines', legend: 'dollars its scour cost, per thousand lines', none: 'no scour ledger', scheme: 'viridis', floor: 5,
    valuesIn: (areas) => each(areas, (a) => a.saturation?.usdPerKloc ?? null),
  },
  saturationDefects: {
    name: 'defects found', legend: 'distinct defects its scour reviews found', none: 'no scour ledger', scheme: 'ember', floor: 8,
    valuesIn: (areas) => each(areas, (a) => a.saturation?.distinct ?? null),
  },
  saturationReviews: {
    name: 'reviews', legend: 'scour reviews of it, every source', none: 'no scour ledger', scheme: 'viridis', floor: 5,
    valuesIn: (areas) => each(areas, (a) => a.saturation?.occasions ?? null),
  },
  saturation: {
    name: 'saturation', legend: "next defect's price, from the going rate (0%) to the limit where a delve stops (100%)", none: 'no scour ledger', scheme: 'dusk', floor: 100, linear: true, reverse: true,
    valuesIn: (areas) => each(areas, (a) => saturationOf(a.saturation)),
  },
  saturationNextNew: {
    name: 'chance next review finds a new defect', legend: "percent chance the next review's finding is new", none: 'no estimate yet', scheme: 'inferno', floor: 50,
    valuesIn: (areas) => each(areas, (a) => (a.saturation?.nextNew == null ? null : a.saturation.nextNew * 100)),
  },
  saturationTotal: {
    name: 'defects it holds (est.)', legend: 'defects the scour estimates the area holds, found or not', none: 'no estimate yet', scheme: 'ember', floor: 10,
    valuesIn: (areas) => each(areas, (a) => a.saturation?.total ?? null),
  },
  saturationSpend: {
    name: 'spend', legend: 'dollars its scour reviews and matchers cost', none: 'no scour ledger', scheme: 'viridis', floor: 20,
    valuesIn: (areas) => each(areas, (a) => a.saturation?.costUsd ?? null),
  },
};

/** The scale metric `metric` shades `values` on. */
export const metricScaleOf = (metric: HeatMetric, values: ReadonlyMap<string, number | null>): HeatScale => {
  const spec = HEAT_METRIC_SPECS[metric];
  return heatScaleFor([...values.values()].filter((v): v is number => v !== null), { floor: spec.floor, reverse: spec.reverse ?? false, linear: spec.linear ?? false });
};
