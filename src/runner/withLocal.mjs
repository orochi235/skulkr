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
    refresh: (since) => fleet.refresh?.(since),
    // `onto top` takes seconds, so the fleet is asked only while one of the `running` jobs is on it.
    progress: (running) => new Map([
      ...(!running || running.some((j) => j.node !== LOCAL_NODE) ? fleet.progress?.() ?? [] : []),
      ...(local.progress?.() ?? []),
    ]),
    /** Whether a job can be sent to this machine by naming node `local`. */
    routesLocal: true,
  };
};
