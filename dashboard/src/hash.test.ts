import { describe, expect, it } from 'vitest';
import { hashFor, readHash } from './hash';

const audits = { view: 'audits', area: null } as const;

describe('the URL hash', () => {
  it('names the tenant and, after an @, the past round the map is shown after', () => {
    expect(readHash('#weasel')).toEqual({ tenant: 'weasel', round: null, ...audits });
    expect(readHash('#weasel@41')).toEqual({ tenant: 'weasel', round: 41, ...audits });
    expect(readHash('#weasel@soon')).toEqual({ tenant: 'weasel', round: null, ...audits });
    expect(readHash('')).toEqual({ tenant: '', round: null, ...audits });
    expect(readHash('#%E0%A4%A')).toEqual({ tenant: '', round: null, ...audits });
  });

  it('names the saturation page after a slash, and the area picked on it after another', () => {
    expect(readHash('#weasel/saturation')).toEqual({ tenant: 'weasel', round: null, view: 'saturation', area: null });
    expect(readHash('#weasel/saturation/core.animation')).toEqual({ tenant: 'weasel', round: null, view: 'saturation', area: 'core.animation' });
    expect(readHash('#weasel/elsewhere/x')).toEqual({ tenant: 'weasel', round: null, ...audits });
  });

  it('reads back what it writes, a tenant holding an @ or a slash among them', () => {
    for (const state of [
      { tenant: 'weasel', round: 41, ...audits }, { tenant: 'a@b', round: null, ...audits }, { tenant: 'a@b', round: 7, ...audits },
      { tenant: 'a/b', round: null, view: 'saturation', area: 'x.y' }, { tenant: 'weasel', round: null, view: 'saturation', area: null },
    ] as const) {
      expect(readHash(hashFor(state))).toEqual(state);
    }
    expect(hashFor({ tenant: 'weasel', round: null })).toBe('#weasel');
    expect(hashFor({ tenant: 'weasel', round: null, view: 'saturation', area: 'core.animation' })).toBe('#weasel/scour/core.animation');
    expect(readHash('#weasel/scour/x').view).toBe('saturation');
  });
});
