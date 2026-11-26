/** The heat ramp's color at a place along it, between the stops the palette reads off the theme. */
import { lerp } from '@weasel-js/geom';

type Oklch = readonly [number, number, number];

/** An `oklch(l c h)` color's coordinates, as a browser writes the computed value; null for any other form. */
function oklchOf(color: string): Oklch | null {
  const m = /^oklch\(\s*([\d.]+)%?\s+([\d.]+)\s+([\d.]+)/.exec(color.trim());
  if (!m) return null;
  const l = Number(m[1]);
  return [color.includes('%') && l > 1 ? l / 100 : l, Number(m[2]), Number(m[3])];
}

/** The hue between `a` and `b` at `t`, the short way round. */
function hueBetween(a: number, b: number, t: number): number {
  const d = ((b - a + 540) % 360) - 180;
  return (a + d * t + 360) % 360;
}

/**
 * The color at `f` (0 to 1) along `stops`, spaced evenly, mixed in oklch between the two stops it falls between.
 * Stops the browser did not hand over as oklch (a fallback hex) give the nearer stop instead.
 */
export function rampAt(stops: readonly string[], f: number): string {
  if (stops.length === 0) return 'transparent';
  const at = Math.min(1, Math.max(0, f)) * (stops.length - 1);
  const lo = Math.floor(at);
  const hi = Math.min(lo + 1, stops.length - 1);
  const t = at - lo;
  return mixOf(stops[lo]!, stops[hi]!, t) ?? stops[t < 0.5 ? lo : hi]!;
}

/** `color` moved `t` (0 to 1) of the way to black, or to white when it is dark, so a shade of it shows against it;
 *  null when it is not in oklch. */
export function shadeOf(color: string, t: number): string | null {
  const c = oklchOf(color);
  if (!c) return null;
  return mixOf(color, c[0] < 0.45 ? 'oklch(1 0 0)' : 'oklch(0 0 0)', t);
}

/** `a` and `b` mixed in oklch, `t` (0 to 1) of the way to `b`; null when either is not in oklch. */
export function mixOf(a: string, b: string, t: number): string | null {
  const x = oklchOf(a);
  const y = oklchOf(b);
  if (!x || !y) return null;
  const mix = (p: number, q: number) => lerp(p, q, t);
  return `oklch(${mix(x[0], y[0]).toFixed(4)} ${mix(x[1], y[1]).toFixed(4)} ${hueBetween(x[2], y[2], t).toFixed(2)})`;
}

/** `color` with `amount` (0 to 1) of its chroma taken out, for an area the map sets aside; a color not in oklch stays
 *  as it is. */
export function grayOf(color: string, amount = 1): string {
  const c = oklchOf(color);
  return c ? `oklch(${c[0].toFixed(4)} ${(c[1] * (1 - Math.min(1, Math.max(0, amount)))).toFixed(4)} ${c[2].toFixed(2)})` : color;
}

/** The treemap's fill for an area with `left` defects estimated left, on the heat scale `at` sets, along `depth`. */
export const heatColorOf = (depth: readonly string[], at: (left: number) => number, left: number): string => rampAt(depth, at(left));
