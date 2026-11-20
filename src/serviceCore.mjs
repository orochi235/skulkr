/** The service's decisions, apart from its process and its pipes, so they can be tested. */
import { nextClock } from './config.mjs';

/** Milliseconds from `now` to the next `hh:mm` local; 0 never, so a fire at the minute schedules tomorrow. */
export const msUntil = (now, hhmm) => nextClock(now, hhmm) - now;

/**
 * Whether the service should start a night by itself at `now`: past `startAt`, no run live, and no
 * night started since today's `startAt` (`lastStarted`, a Date or undefined). A night started after
 * midnight by hand does not stand in for that evening's.
 */
export const shouldAutoStart = ({ now, running, lastStarted, startAt }) => {
  if (running) return false;
  const [h, m] = startAt.split(':').map(Number);
  const at = new Date(now);
  at.setHours(h, m, 0, 0);
  if (now < at) return false;
  return !lastStarted || lastStarted < at;
};

const list = (v) => (Array.isArray(v) ? v.join(',') : String(v));

/** `skulkr night`'s arguments for a `start` request's fields. Throws on a field it does not know. */
export const startArgs = (req) => {
  const known = new Set(['id', 'start', 'resume', 'areas', 'only', 'nodes', 'capUsd', 'budget', 'merge', 'sweep']);
  const unknown = Object.keys(req).filter((k) => !known.has(k));
  if (unknown.length > 0) throw new Error(`start does not take ${unknown.join(', ')}`);
  const args = [];
  if (req.resume !== undefined) args.push('--resume', String(Number(req.resume)));
  if (req.areas !== undefined) args.push('--areas', String(req.areas));
  if (req.only !== undefined) args.push('--only', list(req.only));
  if (req.nodes !== undefined) args.push('--nodes', list(req.nodes));
  if (req.capUsd !== undefined) args.push('--cap-usd', String(req.capUsd));
  for (const [role, usd] of Object.entries(req.budget ?? {})) {
    if (!['review', 'match', 'fix'].includes(role)) throw new Error(`budget has no role ${role}`);
    args.push(`--budget-${role}`, String(usd));
  }
  if (req.merge === false) args.push('--no-merge');
  if (req.sweep === true) args.push('--sweep');
  return args;
};

/**
 * Answers one request line. `deps` is the service's live side: `status()`, `plan()`, `start(args)` (answering the args
 * it started with, or `{ started, waiting, behind, args }` when a host queues it),
 * `stop(rounds)`, `live()`, the rounds running now, and for continuous mode `continuous(on)` and `continuousOn()`.
 * `start` starts a run whatever else runs, or with `continuous` turns continuous mode on or off; `stop` stops the run
 * `round` names, or every one and continuous mode with them. Every reply echoes the request's `id`.
 */
export const handle = async (line, deps) => {
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    return { error: 'not a JSON object' };
  }
  const reply = (body) => ({ id: req.id, ...body });
  try {
    if (req.ping) return reply({ pong: true, build: deps.build });
    if (req.status) return reply(deps.status());
    if (req.plan) return reply({ plan: await deps.plan() });
    if (req.start && req.continuous !== undefined) {
      const extra = Object.keys(req).filter((k) => !['id', 'start', 'continuous'].includes(k));
      if (extra.length > 0) throw new Error(`a continuous start takes no ${extra.join(', ')}: its rounds take the config's settings`);
      if (!deps.continuous) throw new Error('this service has no continuous mode');
      return reply(deps.continuous(Boolean(req.continuous)));
    }
    if (req.start || req.resume !== undefined) {
      const started = deps.start(startArgs(req));
      return reply(Array.isArray(started) ? { started: true, args: started } : started);
    }
    if (req.stop) {
      const live = deps.live();
      const round = req.round === undefined ? undefined : Number(req.round);
      if (round !== undefined && !live.includes(round)) return reply({ error: `round ${req.round} is not running`, running: live });
      const rounds = round !== undefined ? [round] : live;
      // A bare stop ends continuous mode for the night too.
      const ended = round === undefined && deps.continuousOn?.() ? deps.continuous(false) : undefined;
      const off = ended ? { continuous: false, until: ended.until } : {};
      if (rounds.length === 0) return reply(ended ? { stopping: [], ...off } : { error: 'no run is running' });
      deps.stop(rounds);
      return reply({ stopping: rounds, ...off, note: 'no new jobs start; running jobs finish, then each run records and batches what completed' });
    }
    return reply({ error: 'unknown request; send ping, status, plan, start, resume or stop' });
  } catch (error) {
    return reply({ error: error.message });
  }
};
