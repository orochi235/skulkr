/** What the map can shade its areas by, besides the defects estimated left that it shades by first. */
import { foundIn, heatScaleFor, lastPassOf, roundCountOf, type HeatScale } from './areaData';
import type { HeatScheme } from './heatSchemes';
import type { AuditArea } from './skulkrMap.types';

export const HEAT_METRICS = ['left', 'density', 'fixed', 'found', 'queue', 'open', 'stale', 'age', 'rounds', 'files'] as const;
export type HeatMetric = (typeof HEAT_METRICS)[number];

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
  readonly valuesIn: (areas: readonly AuditArea[]) => ReadonlyMap<string, number | null>;
}

const each = (areas: readonly AuditArea[], valueOf: (area: AuditArea) => number | null) => new Map(areas.map((a) => [a.id, valueOf(a)]));

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
};

/** The scale metric `metric` shades `values` on. */
export const metricScaleOf = (metric: HeatMetric, values: ReadonlyMap<string, number | null>): HeatScale => {
  const spec = HEAT_METRIC_SPECS[metric];
  return heatScaleFor([...values.values()].filter((v): v is number => v !== null), { floor: spec.floor, reverse: spec.reverse ?? false });
};
