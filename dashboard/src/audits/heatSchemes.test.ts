import { describe, expect, it } from 'vitest';
import { HEAT_SCHEMES, heatStopsOf } from './heatSchemes';

describe('heatStopsOf', () => {
  it('leaves thermal to the theme and gives every other scheme five oklch stops, darkest first', () => {
    expect(heatStopsOf('thermal')).toBeNull();
    for (const scheme of HEAT_SCHEMES.filter((s) => s !== 'thermal')) {
      const stops = heatStopsOf(scheme)!;
      expect(stops).toHaveLength(5);
      const lightness = stops.map((s) => Number(/^oklch\(([\d.]+) /.exec(s)![1]));
      expect(lightness[0]).toBeLessThan(lightness[4]!);
    }
    expect(heatStopsOf('whitehot')).toEqual(['oklch(0.0000 0.0000 0.00)', expect.any(String), expect.any(String), expect.any(String), 'oklch(1.0000 0.0000 0.00)']);
  });
});
