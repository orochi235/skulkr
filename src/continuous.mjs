/**
 * Continuous rounds, as decisions apart from the disk and the clock so they can be tested: README.md "Continuous
 * rounds". A tenant's rounds come as two queues. The model queue holds at most one round per tenant in its model steps
 * (review, match, fix, and a capstone repair); once that round reaches its patch step the next may start, while the
 * night's budget allows. The fleet queue holds at most one gate run across every tenant (`fleet.mjs`); a round
 * reaching its gate while another's runs waits its turn.
 */
import { inWindow, nextClock } from './config.mjs';
import { usd } from './usage.mjs';

/** A run's steps whose jobs run a model: everything before its patch step, and the capstone repair after its gate. */
export const MODEL_STEPS = ['freeze', 'review', 'repair'];

/** Whether a live run is still in its model steps. A run with no step yet (started, not claimed) counts as one. */
export const inModelSteps = (run) => run.step === undefined || MODEL_STEPS.includes(run.step);

/**
 * The budget's night holding `now`: from one `stopAt` to the next, so a round started in the afternoon counts
 * against the coming night.
 */
export const budgetNight = (now, stopAt) => {
  const to = nextClock(now, stopAt);
  const from = new Date(to);
  from.setDate(from.getDate() - 1);
  return { from, to };
};

/** Dollars spent by the runs (live statuses and summaries, one per round) started at or after `from`. */
export const spentSince = (runs, from) =>
  runs.filter((r) => r.started && new Date(r.started) >= from).reduce((s, r) => s + (r.costUsd ?? 0), 0);

/** How many recent rounds the estimate is measured from. */
const RECENT = 5;

/**
 * What the next round is expected to cost: `areasPerRound` times the mean cost per finished area of the last few
 * rounds whose summaries say (`finished`), else `areasPerRound × areaGuessUsd`.
 */
export const roundEstimate = ({ finished, areasPerRound, areaGuessUsd }) => {
  const recent = finished.filter((s) => (s.areas?.length ?? 0) > 0 && (s.costUsd ?? 0) > 0)
    .sort((a, b) => (a.ended < b.ended ? -1 : 1)).slice(-RECENT);
  if (recent.length === 0) return { usd: areasPerRound * areaGuessUsd, perAreaUsd: areaGuessUsd, from: 'guess' };
  const perArea = recent.reduce((s, r) => s + r.costUsd, 0) / recent.reduce((s, r) => s + r.areas.length, 0);
  return { usd: perArea * areasPerRound, perAreaUsd: perArea, from: `${recent.length} recent round${recent.length === 1 ? '' : 's'}` };
};

/**
 * Whether continuous mode is on at `now`, and why. `override` is what a request left on disk (`{ on, until }`): on
 * until the night's stop time, or off after a `stop` until then. Without one, `schedule.continuous` turns it on
 * between `startAt` and `stopAt`. With no `nightUsd` there is no continuous mode.
 */
/** @param {{ now: Date, schedule: any, nightUsd?: number | null, override?: { on: boolean, until: string } }} input */
export const modeOf = ({ now, schedule, nightUsd, override }) => {
  const live = override && new Date(override.until) > now ? override : undefined;
  const asked = live ? live.on : Boolean(schedule.continuous) && inWindow(now, schedule.startAt, schedule.stopAt);
  if (!asked) return { on: false, by: live ? 'stop' : 'off', ...(live ? { until: live.until } : {}) };
  if (!(nightUsd > 0)) return { on: false, by: 'off', why: 'no budget.nightUsd' };
  return { on: true, by: live ? 'request' : 'config', until: live ? live.until : nextClock(now, schedule.stopAt).toISOString() };
};


/**
 * Whether tenant's next continuous round starts now, and with what cap; else why not. Inputs:
 * `mode` (`modeOf`), `readOnly`, `runs` (its live runs, each with its `step`), `pending` (rounds started but not yet
 * claimed), `spentUsd` tonight, `estimateUsd` for the next round, `nightUsd`, `capUsd` (the per-run cap), and
 * `idleUntil`, set when the last round it started found nothing to do or failed, and `held`, why stranded rounds hold
 * the next one back (`strandedHoldFor`), or null.
 * Answers `{ start, capUsd?, why?, behind? }`; `behind` is the round whose model steps it waits on.
 */
/**
 * @param {{ now: Date, mode: any, readOnly: boolean, runs: any[], pending?: number, spentUsd: number, estimateUsd: number,
 *   nightUsd: number | null, capUsd: number, idleUntil?: string, held?: string | null }} input
 */
export const nextContinuous = ({ now, mode, readOnly, runs, pending = 0, spentUsd, estimateUsd, nightUsd, capUsd, idleUntil, held = null }) => {
  if (readOnly) return { start: false, why: 'read-only here' };
  if (!mode.on) return { start: false, why: mode.why ?? (mode.by === 'stop' ? 'stopped for the night' : 'off') };
  if (held) return { start: false, why: held };
  if (idleUntil && now < new Date(idleUntil)) return { start: false, why: 'the last round it started found nothing to do or failed' };
  const model = runs.find(inModelSteps);
  if (model) return { start: false, why: `round ${model.round} is in its model steps`, behind: model.round };
  if (pending > 0) return { start: false, why: 'a round is starting' };
  const night = nightUsd ?? 0;
  const left = night - spentUsd;
  if (spentUsd + estimateUsd > night) {
    return { start: false, why: `the night's budget: ${usd(spentUsd)} of ${usd(night)} spent, and the next round is expected to cost ${usd(estimateUsd)}` };
  }
  return { start: true, capUsd: Math.floor(Math.min(capUsd, left) * 100) / 100 };
};

/**
 * What a tenant's status says of its queues: the round in its model steps (or null), and the fleet queue, every
 * tenant's: who holds the gate (`fleet.holder`, `{ tenant, round }`) and who waits behind it, oldest first.
 */
export const queuesOf = ({ runs, fleet }) => {
  const model = runs.find(inModelSteps);
  return {
    model: model ? { round: model.round, step: model.step ?? 'starting' } : null,
    fleet: { holder: fleet.holder ?? null, waiting: fleet.waiting ?? [] },
  };
};
