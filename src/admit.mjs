/** Which of a run's picked areas start, and when: README.md, "A run", under "Limits". */
import { nodesAt } from './config.mjs';
import { slotsPerNode } from './slots.mjs';
import { mayStartArea, usd } from './usage.mjs';

/** How many areas a run keeps going at once when each takes `jobsPerArea` jobs of `role` at a time. */
export const areasAtOnce = (cfg, args, role, jobsPerArea) => {
  const slots = args.places && !args.nodes ? slotsPerNode(cfg, role, cfg.concurrency) : (args.nodes ?? nodesAt(cfg, new Date())).length * slotsPerNode(cfg, role);
  return Math.max(1, Math.floor(slots / jobsPerArea));
};

/**
 * Starts each of `picked` with `start(area)`, at most `maxAreas()` at once, asked again before each area so a change to
 * `limits.json` reaches a run already going, each only while the run has no stop
 * request, is before `deadline`, and has the dollars for one more area; resolves when every started one has finished,
 * its summary pushed to `results`.
 */
export const startAreas = async ({ ctx, picked, args, status, deadline, results, maxAreas, start }) => {
  const inFlight = new Map();
  const cfg = ctx.cfg;
  for (const area of picked) {
    while (inFlight.size >= maxAreas()) await Promise.race(inFlight.keys());
    const running = [...inFlight.values()].map((id) => ctx.spentOn?.(id) ?? 0);
    const affordable = mayStartArea({ used: status.costUsd, finished: results.map((r) => r.jobs.costUsd), running, cap: args.capUsd, guess: cfg.budget.areaGuessUsd });
    const why = ctx.stopped() ? 'stop requested'
      : new Date() >= deadline ? `past ${cfg.schedule.stopAt}`
        : !affordable ? `the next area would cross the ${usd(args.capUsd)} cap (${usd(status.costUsd)} used)` : '';
    if (why) {
      ctx.say(`not starting ${area.id}: ${why}`);
      continue;
    }
    const job = start(area)
      .then((summary) => results.push(summary))
      .catch((error) => ctx.say(`area ${area.id} failed: ${error.stack ?? error}`))
      .finally(() => inFlight.delete(job));
    inFlight.set(job, area.id);
  }
  await Promise.all(inFlight.keys());
};
