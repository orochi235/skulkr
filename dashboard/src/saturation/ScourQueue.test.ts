import { describe, expect, it } from 'vitest';
import { fixingText } from './ScourQueue';

describe('fixingText', () => {
  const row = { area: 'a', running: true, batches: 3, open: null, phase: 'verifying' };

  it('names the batch under way as an index, never past the last', () => {
    expect(fixingText({ ...row, done: 1 })).toBe('verifying 2/3');
    expect(fixingText({ ...row, done: 3 })).toBe('verifying 3/3');
  });

  it('counts on from the batches done when the total is unknown', () => {
    expect(fixingText({ ...row, batches: null, done: 1 })).toBe('verifying 2/?');
  });
});
