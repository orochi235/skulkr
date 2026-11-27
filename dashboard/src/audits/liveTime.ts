/**
 * Times the page shows that keep moving between snapshots. Each snapshot carries the service's own clock when it was
 * built (`asOf`), and the page notes when it arrived; a time is read from those two alone, so no clock skew between
 * the fleet's nodes, the service and this browser reaches what it shows.
 */
import type { Reading } from '@weasel-js/clock';

/** A snapshot's service time, epoch ms, and the `performance.now()` it reached this page at. */
export interface Stamp {
  readonly asOf: number;
  readonly arrived: number;
}

/** The stamp of a snapshot built at `asOf` and arriving now. */
export const stampOf = (asOf: string): Stamp => ({ asOf: Date.parse(asOf), arrived: performance.now() });

const PER_MS = 1 / 1000;

/** Seconds from `from`, running on while `running`, else to `to`; null where a time it needs does not parse. */
export function elapsedReading(from: string | null | undefined, to: string | null | undefined, running: boolean, stamp: Stamp): Reading | null {
  const start = from ? Date.parse(from) : NaN;
  const end = running ? stamp.asOf : to ? Date.parse(to) : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return { value: Math.max(0, (end - start) / 1000), at: stamp.arrived, rate: running ? PER_MS : 0 };
}

/** `iso`'s offset from now in seconds, negative for the past, falling a second a second: what `relative()` reads. */
export function agoReading(iso: string, stamp: Stamp): Reading | null {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  return { value: (at - stamp.asOf) / 1000, at: stamp.arrived, rate: -PER_MS };
}
