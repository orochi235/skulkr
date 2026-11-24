/**
 * A runner (the fleet's) with the local runner beside it: a job naming node `local` (a local fixer's, README "Local
 * fixers") runs on this machine, every other job on the fleet, and the job listing and progress are both runners'.
 */
import { LOCAL_NODE } from '../slots.mjs';

export const withLocal = (fleet, local) => {
  const both = (method, ...args) => [...(fleet[method]?.(...args) ?? []), ...(local[method]?.(...args) ?? [])];
  return {
    ...fleet,
    run: (job, opts) => (job.node === LOCAL_NODE ? local.run({ ...job, node: undefined }, opts) : fleet.run(job, opts)),
    jobs: (since) => both('jobs', since),
    progress: () => new Map(both('progress')),
    /** Whether a job can be sent to this machine by naming node `local`. */
    routesLocal: true,
  };
};
