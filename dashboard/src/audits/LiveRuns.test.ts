import { describe, expect, it } from 'vitest';
import { dotsWidthFor } from './LiveRuns';

describe('dotsWidthFor', () => {
  it('reserves a pip for each five passes and each one left over, a row up to five pips, none for a second row', () => {
    // Each pip 4px with 2px between, plus 4px of gap before and 8px after.
    expect(dotsWidthFor(0)).toBe(0);
    expect(dotsWidthFor(1)).toBe(4 + 12);
    expect(dotsWidthFor(5)).toBe(dotsWidthFor(1));
    expect(dotsWidthFor(9)).toBe(5 * 4 + 4 * 2 + 12);
    expect(dotsWidthFor(29)).toBe(dotsWidthFor(9));
  });

  it('spreads into a second column once two rows of pips are full, sized by its first row', () => {
    expect(dotsWidthFor(50)).toBe(dotsWidthFor(9));
    expect(dotsWidthFor(51)).toBe(dotsWidthFor(9) + 5 + 4);
    expect(dotsWidthFor(58)).toBe(dotsWidthFor(9) + 5 + 4 * 4 + 3 * 2);
  });
});
