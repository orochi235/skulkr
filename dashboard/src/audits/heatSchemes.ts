/**
 * The heat ramps the prefs offer: the theme's own thermal ramp, and pezlie's sequential ramps (its `wall/src/tint.ts`,
 * copied 2026-11-22, since pezlie is no dependency). Each is resampled to the map's five stops in oklch, the form the
 * map mixes between.
 */
const MAGMA = ['#000004', '#1c1044', '#4f127b', '#812581', '#b5367a', '#e55964', '#fb8761', '#fec287'] as const;

export const HEAT_RAMPS = {
  ember: ['#3a3a3f', '#e8c478'],
  ice: ['#12233a', '#a9e2f3'],
  moss: ['#16281c', '#b7e07a'],
  viridis: ['#440154', '#472d7b', '#3b528b', '#2c728e', '#21918c', '#28ae80', '#5ec962', '#addc30'],
  magma: MAGMA,
  // Magma without its near-black end, for a lens whose far end should still read as a color.
  dusk: MAGMA.slice(1),
  inferno: ['#000004', '#1b0c41', '#4a0c6b', '#781c6d', '#a52c60', '#cf4446', '#ed6925', '#fcffa4'],
  ironbow: ['#00000a', '#1a0a52', '#4a0a7a', '#8a1a6a', '#c43e2f', '#e8721a', '#f9b70a', '#ffffe0'],
  whitehot: ['#000000', '#ffffff'],
} as const;

/** `thermal` is the theme's ramp, `palette.module.css`'s `--audit-depth-*`. */
export const HEAT_SCHEMES = ['thermal', ...Object.keys(HEAT_RAMPS)] as readonly HeatScheme[];
export type HeatScheme = 'thermal' | keyof typeof HEAT_RAMPS;

const STOPS = 5;

const rgbOf = (hex: string): [number, number, number] =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];

/** sRGB (0 to 1) as an `oklch()` string, by Björn Ottosson's matrices. */
function oklchOf([r, g, b]: [number, number, number]): string {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const Bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(A, Bb);
  const H = C < 1e-4 ? 0 : ((Math.atan2(Bb, A) * 180) / Math.PI + 360) % 360;
  return `oklch(${L.toFixed(4)} ${C.toFixed(4)} ${H.toFixed(2)})`;
}

/** The scheme's five stops, oklch strings, darkest first; null for `thermal`, which the theme's CSS holds. */
export type HeatStops = readonly [string, string, string, string, string];

export function heatStopsOf(scheme: HeatScheme): HeatStops | null {
  if (scheme === 'thermal') return null;
  const ramp = HEAT_RAMPS[scheme].map(rgbOf);
  return Array.from({ length: STOPS }, (_, k) => {
    const at = (k / (STOPS - 1)) * (ramp.length - 1);
    const lo = Math.floor(at);
    const hi = Math.min(lo + 1, ramp.length - 1);
    const t = at - lo;
    return oklchOf(ramp[lo]!.map((v, i) => v + (ramp[hi]![i]! - v) * t) as [number, number, number]);
  }) as unknown as HeatStops;
}
