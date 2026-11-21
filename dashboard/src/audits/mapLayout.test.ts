import { describe, expect, it } from 'vitest';
import { ICON, iconBoxIn } from './mapLayout';

describe("an area's icon box", () => {
  it('is centered in its cell', () => {
    expect(iconBoxIn({ x: 10, y: 20, width: 100, height: 50 })).toEqual({ x: 48, y: 33, width: ICON.size, height: ICON.size });
  });

  it('is the same size in every cell that holds it, however large', () => {
    const sizes = [{ width: 40, height: 40 }, { width: 300, height: 90 }, { width: 33, height: 500 }]
      .map((c) => iconBoxIn({ x: 0, y: 0, ...c })?.width);
    expect(sizes).toEqual([ICON.size, ICON.size, ICON.size]);
  });

  it('is none in a cell without its margin to spare on both axes', () => {
    const least = ICON.size + 2 * ICON.margin;
    expect(iconBoxIn({ x: 0, y: 0, width: least, height: least })).not.toBeNull();
    expect(iconBoxIn({ x: 0, y: 0, width: least - 1, height: 400 })).toBeNull();
    expect(iconBoxIn({ x: 0, y: 0, width: 400, height: least - 1 })).toBeNull();
  });
});
