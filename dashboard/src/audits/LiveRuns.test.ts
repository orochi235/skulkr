import { describe, expect, it } from 'vitest';
import { dotsWidthFor } from './LiveRuns';

describe('dotsWidthFor', () => {
  it('reserves one row of dots up to five, and no more width for a second row stacked under it', () => {
    // Each dot 4px with 2px between, plus 4px of gap before and 8px after.
    expect(dotsWidthFor(0)).toBe(0);
    expect(dotsWidthFor(1)).toBe(4 + 12);
    expect(dotsWidthFor(5)).toBe(5 * 4 + 4 * 2 + 12);
    expect(dotsWidthFor(6)).toBe(dotsWidthFor(5));
    expect(dotsWidthFor(10)).toBe(dotsWidthFor(5));
  });

  it('spreads into a second column once two rows are full, sized by its first row', () => {
    expect(dotsWidthFor(11)).toBe(dotsWidthFor(5) + 5 + 4);
    expect(dotsWidthFor(13)).toBe(dotsWidthFor(5) + 5 + 3 * 4 + 2 * 2);
  });
});
