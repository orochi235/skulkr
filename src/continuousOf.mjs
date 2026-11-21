/** A tenant's continuous mode as its state on disk says now: what the service decides from, and what status shows. */
import { budgetNight, modeOf, nextContinuous, queuesOf, roundEstimate, spentSince } from './continuous.mjs';
import { readFleet } from './fleet.mjs';
import { finishedRuns, lastWords, liveRuns, readContinuous } from './runs.mjs';

const cents = (n) => Math.round(n * 100) / 100;

/**
 * `cfg`'s continuous mode at `now`: `mode` (`modeOf`), `next` (`nextContinuous`: whether its next round starts, with
 * what cap, or why not), the night's budget and spend, and `queues` (`queuesOf`). `pending` counts rounds the service
 * started that have not claimed one; `idleUntil` is set when the last one it started found nothing to do or failed.
 */
/** @param {any} cfg @param {{ now?: Date, pending?: number, idleUntil?: string, readOnly?: boolean, fleet?: any }} [opts] */
export const continuousOf = (cfg, { now = new Date(), pending = 0, idleUntil, readOnly = false, fleet } = {}) => {
  const live = liveRuns(cfg.state);
  const finished = finishedRuns(cfg.state);
  const night = budgetNight(now, cfg.schedule.stopAt);
  const spentUsd = spentSince(lastWords(cfg.state), night.from);
  const estimate = roundEstimate({ finished, areasPerRound: cfg.areasPerRound, areaGuessUsd: cfg.budget.areaGuessUsd });
  const nightUsd = cfg.budget.nightUsd ?? null;
  const mode = modeOf({ now, schedule: cfg.schedule, nightUsd, override: readContinuous(cfg.state) });
  const next = nextContinuous({
    now, mode, readOnly, runs: live, pending, spentUsd, estimateUsd: estimate.usd, nightUsd, capUsd: cfg.budget.capUsd, idleUntil,
  });
  return {
    mode, next,
    budget: {
      nightUsd, spentUsd: cents(spentUsd), leftUsd: nightUsd === null ? null : cents(Math.max(0, nightUsd - spentUsd)),
      estimateUsd: cents(estimate.usd), estimateFrom: estimate.from, since: night.from.toISOString(),
    },
    queues: queuesOf({ runs: live, fleet: fleet ?? readFleet() }),
  };
};
