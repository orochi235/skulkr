import { describe, expect, it } from 'vitest';
import { agoReading, elapsedReading } from './liveTime';
import { startedText } from './runData';

const stamp = { asOf: Date.parse('2026-11-22T22:44:59.000Z'), arrived: 1000 };
const started = '2026-11-22T22:10:00.000Z';

describe('elapsedReading', () => {
  it('counts on from the service time while a run is live', () => {
    expect(elapsedReading(started, null, true, stamp)).toEqual({ value: 34 * 60 + 59, at: 1000, rate: 1 / 1000 });
  });

  it('stands at its end once over, whatever the service time', () => {
    expect(elapsedReading(started, '2026-11-23T01:05:00.000Z', false, stamp)).toEqual({ value: 2 * 3600 + 55 * 60, at: 1000, rate: 0 });
  });

  it('is null where a time it needs does not parse', () => {
    expect(elapsedReading(undefined, null, true, stamp)).toBeNull();
    expect(elapsedReading(started, null, false, stamp)).toBeNull();
  });
});

describe('agoReading', () => {
  it('reads a past time as a negative offset from the service time, falling a second a second', () => {
    expect(agoReading('2026-11-22T22:41:39.000Z', stamp)).toEqual({ value: -200, at: 1000, rate: -1 / 1000 });
    expect(agoReading('not a time', stamp)).toBeNull();
  });
});

describe('startedText', () => {
  it('gives the clock time today, and the date with it on another day', () => {
    const at = new Date(2026, 10, 22, 14, 32).toISOString();
    expect(startedText(at, new Date(2026, 10, 22, 18, 0).getTime())).toMatch(/^2:32\sPM$/);
    expect(startedText(at, new Date(2026, 10, 23, 9, 0).getTime())).toMatch(/^Nov 22, 2:32\sPM$/);
  });
});
