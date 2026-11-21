import { describe, expect, it } from 'vitest';
import { hashFor, readHash } from './hash';

describe('the URL hash', () => {
  it('names the tenant and, after an @, the past round the map is shown after', () => {
    expect(readHash('#weasel')).toEqual({ tenant: 'weasel', round: null });
    expect(readHash('#weasel@41')).toEqual({ tenant: 'weasel', round: 41 });
    expect(readHash('#weasel@soon')).toEqual({ tenant: 'weasel', round: null });
    expect(readHash('')).toEqual({ tenant: '', round: null });
    expect(readHash('#%E0%A4%A')).toEqual({ tenant: '', round: null });
  });

  it('reads back what it writes, a tenant holding an @ among them', () => {
    for (const state of [{ tenant: 'weasel', round: 41 }, { tenant: 'a@b', round: null }, { tenant: 'a@b', round: 7 }]) {
      expect(readHash(hashFor(state))).toEqual(state);
    }
    expect(hashFor({ tenant: 'weasel', round: null })).toBe('#weasel');
  });
});
