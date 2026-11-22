import { describe, expect, it } from 'vitest';
import { earlyRefusal } from './early.mjs';
import { spareOfTop } from './runner/onto.mjs';

describe('earlyRefusal', () => {
  const early = { share: 0.5, left: 0.25, coresFree: 0.5 };
  const idle = { early, picked: 16, ready: 8, finished: 9, spare: { coresFree: 40, cores: 62 }, fleet: { holder: null, waiting: [] }, mergeHeld: false };

  it('lets half a round land while a quarter is still fixing on a half-idle fleet nobody else is waiting for', () => {
    expect(earlyRefusal(idle)).toBe('');
  });

  it('waits for enough ready, refuses near the end, and needs an idle fleet and a free gate', () => {
    expect(earlyRefusal({ ...idle, early: null })).toBe('off');
    expect(earlyRefusal({ ...idle, ready: 7 })).toBe('7 of 16 areas ready');
    expect(earlyRefusal({ ...idle, finished: 13 })).toBe('3 of 16 areas left to finish');
    expect(earlyRefusal({ ...idle, spare: null })).toBe('the runner cannot say how busy the fleet is');
    expect(earlyRefusal({ ...idle, spare: { coresFree: 30.5, cores: 62 } })).toBe('31 of 62 cores free');
    expect(earlyRefusal({ ...idle, fleet: { holder: { tenant: 'blits', round: 4 }, waiting: [] } })).toBe('another gate holds or awaits the fleet');
    expect(earlyRefusal({ ...idle, fleet: { holder: null, waiting: [{ tenant: 'blits', round: 4 }] } })).toBe('another gate holds or awaits the fleet');
    expect(earlyRefusal({ ...idle, mergeHeld: true })).toBe('another run holds the merge lock');
  });
});

describe('spareOfTop', () => {
  it("reads onto top's fleet totals", () => {
    expect(spareOfTop({ fleet: { cores: 62, cores_free: 30.5 } })).toEqual({ coresFree: 30.5, cores: 62 });
    expect(spareOfTop({})).toBeNull();
  });
});
