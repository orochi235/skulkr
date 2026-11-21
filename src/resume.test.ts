import { describe, expect, it } from 'vitest';
import { resumable } from './resume.mjs';

describe('resumable', () => {
  const summary = { planned: ['a', 'b', 'c', 'd'], areas: [{ id: 'a', patches: 2 }, { id: 'b', patches: 1 }], landed: { tip: 'abc', areas: ['a', 'b'] } };

  it("leaves out the areas the round's landing record names while main still holds that tip", () => {
    expect(resumable({ prior: summary, held: new Set(), inMain: (tip: string) => tip === 'abc' })).toEqual({ ids: ['c', 'd'], landed: ['a', 'b'], held: [] });
  });

  it('runs every planned area again when main no longer holds the landed tip, or nothing landed', () => {
    expect(resumable({ prior: summary, held: new Set(), inMain: () => false }).ids).toEqual(['a', 'b', 'c', 'd']);
    expect(resumable({ prior: { areas: ['a', 'b'] }, held: new Set(), inMain: () => true }).ids).toEqual(['a', 'b']);
  });

  it('leaves out the areas a live run holds, as a new plan does', () => {
    expect(resumable({ prior: summary, held: new Set(['c']), inMain: () => true })).toEqual({ ids: ['d'], landed: ['a', 'b'], held: ['c'] });
  });
});
