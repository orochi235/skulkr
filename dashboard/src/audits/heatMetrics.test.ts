import { describe, expect, it } from 'vitest';
import { HEAT_METRIC_SPECS, metricScaleOf, saturationOf } from './heatMetrics';
import type { AuditArea, AuditPass } from './skulkrMap.types';

const pass = (round: number, more: Partial<AuditPass> = {}): AuditPass =>
  ({ round, date: '2026-11-24', a: 3, b: 2, shared: 1, distinct: 4, est: 6, left: 2, ...more });
const area = (id: string, more: Partial<AuditArea> = {}): AuditArea =>
  ({ id, group: 'core', files: 20, status: 'audited', queue: null, passes: [], stage: null, ...more } as AuditArea);

describe('heat metrics', () => {
  const areas = [
    area('old', { passes: [pass(3, { fixed: 2 }), pass(7, { fixed: 3, share: 0.5 })], queue: 2, staleLines: 40 }),
    area('new', { queue: 1 }),
    area('done', { status: 'settled', passes: [pass(9, { left: 0, fixed: 1 })] }),
  ];
  const of = (metric: keyof typeof HEAT_METRIC_SPECS) => Object.fromEntries(HEAT_METRIC_SPECS[metric].valuesIn(areas));

  it('gives an area no value where the metric needs a pass it has not had', () => {
    expect(of('fixed')).toEqual({ old: 3.5, new: null, done: 1 });
    expect(of('rounds')).toEqual({ old: 2, new: null, done: 1 });
    expect(of('stale')).toEqual({ old: 40, new: null, done: 0 });
    expect(of('files')).toEqual({ old: 20, new: 20, done: 20 });
  });

  it('counts the rounds since each area\'s last pass from the latest round any area had', () => {
    expect(of('age')).toEqual({ old: 2, new: null, done: 0 });
  });

  it('puts the queue\'s first place at the hot end', () => {
    const values = HEAT_METRIC_SPECS.queue.valuesIn(areas);
    expect(Object.fromEntries(values)).toEqual({ old: 2, new: 1, done: null });
    const scale = metricScaleOf('queue', values);
    expect(scale.at(1)).toBeGreaterThan(scale.at(2));
  });
});

describe('saturation', () => {
  const s = (more: object) => ({ open: 0, unseen: null, distinct: 0, occasions: 3, nextNew: null, total: null, costUsd: 0, limitUsd: 1.5, goingUsd: 0.5, nextUsd: null, stopped: null, ...more });
  it("places the next defect's price between the going rate and the limit, a fresh ledger at 0, and a stop at 100", () => {
    expect(saturationOf(s({ nextUsd: 1 }))).toBeCloseTo(50);
    expect(saturationOf(s({}))).toBe(0);
    expect(saturationOf(s({ nextUsd: 0.3 }))).toBe(0);
    expect(saturationOf(s({ nextUsd: 0.3, stopped: 'ready to fix: 6.0 known defects per thousand lines, at least 5' }))).toBe(100);
    expect(saturationOf(s({ nextUsd: 3 }))).toBe(100);
    expect(saturationOf(undefined)).toBeNull();
    const scale = metricScaleOf('saturation', new Map([['ripe', 0], ['spent', 100]]));
    expect(scale.at(0)).toBeGreaterThan(scale.at(100));
  });
});
