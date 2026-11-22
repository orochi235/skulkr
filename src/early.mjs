/**
 * Early landings: while a round's later areas are still fixing, its ready half batched, gated and landed on its own,
 * so a test failure among them surfaces, and its capstone repair starts, before the round's own batch. README.md,
 * "Early landings", is its documentation.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { sleep } from './after.mjs';
import { gitIn } from './batch.mjs';
import { fleetDir, readFleet } from './fleet.mjs';
import { batchAndTest, failedVerify, patchAreas } from './land.mjs';
import { heldAlive, leaseAt } from './lease.mjs';
import { mergeLock } from './runs.mjs';

const CHECK_MS = 60_000;
const POLL_MS = 5_000;

/** The finished areas whose fixes would make a branch: commits came home and their verify step did not fail. */
export const readyIn = (nightDir, results) => results.filter((r) => existsSync(join(nightDir, 'areas', r.id, 'fix.mbox')) && !failedVerify(r.verify));

/**
 * Why an early landing may not start now, or '' when it may: `early` the config's, `picked` how many areas the round
 * planned, `ready` and `finished` how many of them are ready (`readyIn`) and finished, `spare` the runner's
 * `{ coresFree, cores }`, `fleet` the fleet queue (`readFleet`), `mergeHeld` whether another run holds the merge lock.
 */
export const earlyRefusal = ({ early, picked, ready, finished, spare, fleet, mergeHeld }) => {
  if (!early) return 'off';
  if (ready < early.share * picked) return `${ready} of ${picked} areas ready`;
  if (picked - finished < early.left * picked) return `${picked - finished} of ${picked} areas left to finish`;
  if (!spare) return 'the runner cannot say how busy the fleet is';
  if (spare.coresFree < early.coresFree * spare.cores) return `${Math.round(spare.coresFree)} of ${spare.cores} cores free`;
  if (fleet.holder || fleet.waiting.length) return 'another gate holds or awaits the fleet';
  if (mergeHeld) return 'another run holds the merge lock';
  return '';
};

/**
 * Watches the round while its areas run, and lands its ready areas early once `earlyRefusal` allows, at most once.
 * `done()` says the areas have all finished, which ends the watch. Answers what the round's own batch needs to know:
 * `{ patched, landed, back }`, the ids it patched (landed or not), the ids that landed, and the branches it leaves for
 * the round's batch; or null when it never started. `land` is the landing's share of `batchAndTest`'s arguments.
 */
export const watchEarly = async ({ ctx, early, picked, results, done, land }) => {
  const { cfg, runner, nightDir, round, say } = ctx;
  let checked = 0;
  while (!done()) {
    await sleep(POLL_MS);
    if (done() || ctx.stopped() || Date.now() - checked < CHECK_MS) continue;
    checked = Date.now();
    const ready = readyIn(nightDir, results);
    const why = earlyRefusal({
      early, picked, ready: ready.length, finished: results.length, spare: runner.spare?.() ?? null,
      fleet: readFleet(fleetDir()), mergeHeld: heldAlive(leaseAt(mergeLock(cfg.state))),
    });
    if (why) continue;
    say(`early: landing ${ready.length} of ${picked} areas while the rest finish`);
    return landEarly({ ctx, ready, land, round });
  }
  return null;
};

const landEarly = async ({ ctx, ready, land, round }) => {
  const { cfg, root, say } = ctx;
  const idOf = cfg.names.idOf;
  const branches = patchAreas({ ...land, results: ready });
  const landed = new Set();
  let tip = '';
  const report = await batchAndTest({
    ...land, branches, results: ready, early: true,
    onLanded: (l) => {
      tip = l.tip;
      for (const id of l.areas) landed.add(id);
      land.onLanded(l);
    },
  });
  say(`early: ${report}`);
  const git = gitIn(root);
  const exists = (b) => git('branch', '--list', b) !== '';
  for (const id of landed) land.outcomes[id] = `\`${cfg.names.area(round, id)}\`, landed early at ${tip.slice(0, 10)}`;
  // A branch the capstone left out says so in its outcome; it goes now, as a landing would have deleted it.
  const out = branches.filter((b) => !landed.has(idOf(b)) && /left out/.test(land.outcomes[idOf(b)] ?? ''));
  for (const b of out) if (exists(b)) git('branch', '-D', b);
  const back = branches.filter((b) => !landed.has(idOf(b)) && !out.includes(b) && exists(b));
  return { patched: new Set(ready.map((r) => r.id)), landed, back };
};
