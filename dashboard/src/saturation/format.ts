/** Dollars to the cent. */
export const usd = (n: number): string => `$${n.toFixed(2)}`;

/** Dollars to the cent, or a dash where there is no figure. */
export const usdOrDash = (n: number | null): string => (n === null ? '–' : usd(n));

/** An estimate to one decimal, or a dash where there is none yet. */
export const estimate = (n: number | null): string => (n === null ? '–' : n.toFixed(1));

/** A chance as a percent to one decimal, or a dash. */
export const percent = (n: number | null): string => (n === null ? '–' : `${(n * 100).toFixed(1)}%`);

const SEVERITY_RANK: Readonly<Record<string, number>> = { critical: 4, high: 3, medium: 2, low: 1 };

/** A severity's rank for sorting, highest first; an unknown or missing one ranks last. */
export const severityRank = (severity: string): number => SEVERITY_RANK[severity.toLowerCase()] ?? 0;

/** Occasions by source as prose: `claude 22, codex 1`. */
export const sourcesText = (sources: Readonly<Record<string, number>>): string =>
  Object.entries(sources).map(([source, n]) => `${source} ${n}`).join(', ');
