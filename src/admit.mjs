/** Which of a run's picked areas start, and when: README.md, "A run", under "Limits". */
import { nodesAt } from './config.mjs';
import { slotsPerNode } from './slots.mjs';
import { mayStartArea, usd } from './usage.mjs';

/** How many areas a run keeps going at once when each takes `jobsPerArea` jobs of `role` at a time. */
export const areasAtOnce = (cfg, args, role, jobsPerArea) => {
  const slots = args.places && !args.nodes ? slotsPerNode(cfg, role, cfg.concurrency) : (args.nodes ?? nodesAt(cfg, new Date())).length * slotsPerNode(cfg, role);
  return Math.max(1, Math.floor(slots / jobsPerArea));
};

/** How often a run waiting for a place asks `maxAreas` again, so a raised limit needs no area to finish first. */
const RECHECK_MS = 30_000;
/** A wait that keeps no process alive once the run is otherwise done. */
const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms).unref?.(); });

/**
 * Starts each of `picked` with `start(area, { reviewed })`, at most `maxAreas()` at once, asked again before each area
 * and every `recheckMs` while it waits, so a change to `limits.json` reaches a run already going, each only while the run has no stop
 * request, is before `deadline`, and has the dollars for one more area; resolves when every started one has finished,
 * its summary pushed to `results`. What a fixer outside any area (the sweep's) may still spend counts as spent. An area
 * holds its place until it finishes, or until it calls `reviewed()` where `releaseReviewed` is set: then the next area
 * starts while its fixer runs, the fix slots alone bounding the fixers.
 */
export const startAreas = async ({ ctx, picked, args, status, deadline, results, maxAreas, start, releaseReviewed = false, recheckMs = RECHECK_MS }) => {
  const inFlight = new Map();
  const holding = new Set();
  const cfg = ctx.cfg;
  for (const area of picked) {
    while (holding.size >= maxAreas()) await Promise.race([...holding, pause(recheckMs)]);
    const running = [...inFlight.values()].map((id) => ctx.spentOn?.(id) ?? 0);
    const affordable = mayStartArea({ used: status.costUsd + (ctx.reservedUsd?.() ?? 0), finished: results.map((r) => r.jobs.costUsd), running, cap: args.capUsd, guess: cfg.budget.areaGuessUsd });
    const why = ctx.stopped() ? 'stop requested'
      : new Date() >= deadline ? `past ${cfg.schedule.stopAt}`
        : !affordable ? `the next area would cross the ${usd(args.capUsd)} cap (${usd(status.costUsd)} used)` : '';
    if (why) {
      ctx.say(`not starting ${area.id}: ${why}`);
      continue;
    }
    let release = () => {};
    const hold = new Promise((resolve) => {
      release = resolve;
    }).then(() => {
      holding.delete(hold);
    });
    holding.add(hold);
    const job = start(area, { reviewed: releaseReviewed ? release : () => {} })
      .then((summary) => results.push(summary))
      .catch((error) => ctx.say(`area ${area.id} failed: ${error.stack ?? error}`))
      .finally(() => {
        inFlight.delete(job);
        release();
      });
    inFlight.set(job, area.id);
  }
  await Promise.all(inFlight.keys());
};
