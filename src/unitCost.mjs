/**
 * A round's cost per area and per file: `costUsd`, the round's whole spend (capstone and sweep included), over the
 * areas that spent anything and over their files. `spent` maps an area to its spend, `files` an area to its file count.
 * Both are null until an area has spent.
 */
/** @param {{ costUsd: number, spent: Iterable<[string, number]>, files: Record<string, number> }} input */
export const unitCostOf = ({ costUsd, spent, files }) => {
  const ran = [...spent].filter(([id, usd]) => usd > 0 && files[id] !== undefined).map(([id]) => id);
  const fileCount = ran.reduce((s, id) => s + files[id], 0);
  const cents = (n, places) => Math.round(n * 10 ** places) / 10 ** places;
  return {
    usdPerArea: ran.length ? cents(costUsd / ran.length, 2) : null,
    usdPerFile: fileCount ? cents(costUsd / fileCount, 3) : null,
  };
};
