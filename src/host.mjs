/**
 * One service hosting several tenants (projects), apart from its process and pipes so it can be tested. Each tenant
 * keeps its own schedule. Rounds of different tenants never do their model work at once, since they share the fleet's
 * slots, so a start (scheduled, continuous, or asked for) while another tenant's round is in its model steps waits in
 * a queue until that round reaches its patch step. Their gates take turns through the fleet queue (`fleet.mjs`).
 *
 * A tenant here is `{ name, readOnly, startAt, stopAt?, running(), modelBusy?(), lastStarted(), deps }`, and for continuous
 * mode `continuous?(now)` (`continuousOf`), `setContinuous?(on, now)` and `scheduledContinuous`: `deps` is `handle`'s
 * for that tenant, its `start(args, { continuous })` the raw start. A read-only tenant's runs count as busy, but
 * nothing starts it.
 */
import { inWindow } from './config.mjs';
import { buildOf, handle, msUntil, requestOf, shouldAutoStart } from './serviceCore.mjs';

/**
 * Which tenant a request means: the one its `tenant` names, or the only one. Throws when it names none there is, or
 * names none while there are several.
 */
/** What refuses a start or stop for tenant `name`, which is read-only on this host. */
export const readOnlyError = (name) => new Error(`${name} is read-only here: its rounds run under another service`);

export const tenantFor = (req, tenants) => {
  if (req.tenant !== undefined) {
    const found = tenants.find((t) => t.name === req.tenant);
    if (!found) throw new Error(`no tenant ${req.tenant}; this service hosts ${tenants.map((t) => t.name).join(', ') || 'none'}`);
    return found;
  }
  if (tenants.length === 1) return tenants[0];
  if (tenants.length === 0) throw new Error('this service hosts no tenant; register one with `skulkr tenants add`');
  throw new Error(`this service hosts several tenants (${tenants.map((t) => t.name).join(', ')}); name one with "tenant"`);
};

/**
 * The host: `tenants()` answers the tenants now (reread live), `now()` the time. `tick()` fires each tenant's
 * schedule and starts what the queue lets; `request(line)` answers one request line.
 */
/** A continuous round's arguments: the night's budget left, under the per-run cap, is its cap. */
/** `--scheduled`: its run stops starting areas at `schedule.stopAt`, as one started by hand does not. */
const continuousArgs = (next) => ['--cap-usd', String(next.capUsd), '--scheduled'];

/** What `status` says of continuous mode and the two queues. */
export const continuousStatus = ({ mode, next, budget, queues }) => ({
  continuous: {
    on: mode.on, by: mode.by, ...(mode.until ? { until: mode.until } : {}), ...(mode.why ? { why: mode.why } : {}),
    next: mode.on ? (next.start ? 'starts now' : next.why) : null,
    ...budget,
  },
  queues,
});

export const createHost = ({ tenants, now = () => new Date(), log = () => {}, build }) => {
  /** Starts waiting for the fleet, oldest first: `{ tenant, args, auto, since }`. */
  const queue = [];
  /** Each tenant's next scheduled start, armed when it is first seen, so a restart never starts a round by itself. */
  const fireAt = new Map();
  /** Set after the first tick, which only arms: a restart never starts a continuous round by itself either. */
  let ticked = false;

  /** Another tenant whose round is in its model steps now, by name, or undefined. */
  const busyBeside = (name, list) => list.find((t) => t.name !== name && (t.modelBusy ? t.modelBusy() : t.running()))?.name;
  /** What tenant `name`'s start waits on: another tenant's round in its model steps, else one queued ahead of it. */
  const behindOf = (name, list) => busyBeside(name, list) ?? queue.find((q) => q.tenant !== name)?.tenant ?? null;
  /** Whether `entry` may start: no other tenant runs, and no other tenant's start has waited longer. */
  const free = (entry, list) => !busyBeside(entry.tenant, list) && !queue.slice(0, queue.indexOf(entry)).some((q) => q.tenant !== entry.tenant);

  const drain = (list) => {
    for (const entry of [...queue]) {
      const t = list.find((x) => x.name === entry.tenant);
      if (!t || t.readOnly) {
        queue.splice(queue.indexOf(entry), 1);
        continue;
      }
      // A scheduled start held past its night's stopAt would audit all day.
      if (entry.auto && t.stopAt && t.stopAt !== t.startAt && !inWindow(now(), t.startAt, t.stopAt)) {
        queue.splice(queue.indexOf(entry), 1);
        log(`${t.name}: its scheduled round waited past ${t.stopAt}; skipped until the next ${t.startAt}`);
        continue;
      }
      if (!free(entry, list)) continue;
      queue.splice(queue.indexOf(entry), 1);
      // A round started by hand meanwhile stands in for a scheduled one.
      if (entry.auto && t.running()) continue;
      let args = entry.args;
      if (entry.continuous) {
        // The queue may have held it while its own rounds moved or its budget went: decide again.
        const next = t.continuous?.(now()).next;
        if (!next?.start) continue;
        args = continuousArgs(next);
      }
      log(`${t.name}: starting${entry.auto ? ' its scheduled round' : entry.continuous ? ' its next continuous round' : ''}${args.length ? ` (${args.join(' ')})` : ''}`);
      try {
        t.deps.start(args, { continuous: Boolean(entry.continuous) });
      } catch (error) {
        entry.error = error.message;
        log(`${t.name}: ${error.message}`);
      }
    }
  };

  /** Queues tenant `t`'s next continuous round when its decision says it may start. */
  const offerContinuous = (t, at) => {
    if (t.readOnly || !t.continuous || queue.some((q) => q.tenant === t.name && q.continuous)) return;
    const next = t.continuous(at).next;
    if (next.start) queue.push({ tenant: t.name, args: continuousArgs(next), auto: false, continuous: true, since: at.toISOString() });
  };

  const tick = () => {
    const list = tenants();
    const at = now();
    for (const name of [...fireAt.keys()]) if (!list.some((t) => t.name === name)) fireAt.delete(name);
    for (const t of list) {
      if (t.readOnly) continue;
      const armed = fireAt.get(t.name);
      if (!armed || armed.startAt !== t.startAt) {
        fireAt.set(t.name, { startAt: t.startAt, at: new Date(at.getTime() + msUntil(at, t.startAt)) });
        continue;
      }
      if (at < armed.at) continue;
      fireAt.set(t.name, { startAt: t.startAt, at: new Date(at.getTime() + msUntil(at, t.startAt)) });
      // Continuous mode from the config starts the night's first round itself, under the budget.
      if (t.scheduledContinuous) continue;
      const due = shouldAutoStart({ now: at, running: t.running(), lastStarted: t.lastStarted(), startAt: t.startAt });
      if (due && !queue.some((q) => q.tenant === t.name && q.auto)) queue.push({ tenant: t.name, args: ['--scheduled'], auto: true, since: at.toISOString() });
    }
    if (ticked) for (const t of list) offerContinuous(t, at);
    ticked = true;
    drain(list);
  };

  /** A start for tenant `t`: now when the fleet is free, else queued. Answers what `handle` replies with. */
  const startFor = (t, list) => (args) => {
    if (t.readOnly) throw readOnlyError(t.name);
    const entry = { tenant: t.name, args, auto: false, since: now().toISOString() };
    queue.push(entry);
    drain(list);
    if (entry.error) return { started: false, error: entry.error, args };
    if (!queue.includes(entry)) return { started: true, args };
    return { started: false, waiting: true, behind: behindOf(t.name, list), args };
  };

  /** What tenant `t` is waiting on: each of its queued starts and what holds it. */
  const waitingOf = (t, list) => queue.filter((q) => q.tenant === t.name).map((q) => ({
    since: q.since, scheduled: q.auto, ...(q.continuous ? { continuous: true } : {}), args: q.args,
    behind: behindOf(t.name, list),
  }));

  /** Turns tenant `t`'s continuous mode on (`on`) until the night's stop time, or off, and says what follows. */
  const continuousFor = (t, list) => (on) => {
    if (t.readOnly) throw readOnlyError(t.name);
    if (!t.setContinuous) throw new Error(`${t.name} has no continuous mode`);
    const at = now();
    const was = t.continuous(at).mode;
    if (on && !(t.continuous(at).budget.nightUsd > 0)) throw new Error(`continuous mode needs budget.nightUsd in ${t.name}'s config`);
    t.setContinuous(on, at);
    if (!on) {
      for (const q of queue.filter((e) => e.tenant === t.name && e.continuous)) queue.splice(queue.indexOf(q), 1);
      return { continuous: false, was: was.on, until: t.continuous(at).mode.until };
    }
    offerContinuous(t, at);
    const entry = queue.find((q) => q.tenant === t.name && q.continuous);
    drain(list);
    const state = t.continuous(at);
    if (entry?.error) return { continuous: true, until: state.mode.until, started: false, error: entry.error };
    if (entry && !queue.includes(entry)) return { continuous: true, until: state.mode.until, started: true };
    return {
      continuous: true, until: state.mode.until, started: false,
      ...(entry ? { waiting: true, behind: behindOf(t.name, list) } : { why: state.next.why }),
    };
  };

  const request = async (line) => {
    const req = requestOf(line);
    if (!req) return { error: 'not a JSON object' };
    const list = tenants();
    if (req.ping && req.tenant === undefined) {
      return { id: req.id, pong: true, build: buildOf(build), tenants: list.map((t) => t.name), ...(list.length === 1 ? { project: buildOf(list[0].deps.build) } : {}) };
    }
    let t;
    try {
      t = tenantFor(req, list);
    } catch (error) {
      return { id: req.id, error: error.message };
    }
    const { tenant: _named, ...rest } = req;
    const deps = {
      ...t.deps,
      start: startFor(t, list),
      ...(t.continuous ? { continuous: continuousFor(t, list), continuousOn: () => t.continuous(now()).mode.on } : {}),
      status: () => {
        const waiting = waitingOf(t, list);
        const next = fireAt.get(t.name)?.at;
        return {
          ...t.deps.status(), ...(waiting.length ? { waiting } : {}), ...(next && !t.scheduledContinuous && !t.readOnly ? { nextStart: next.toISOString() } : {}),
          ...(t.readOnly ? { readOnly: true } : {}), ...(t.continuous ? continuousStatus(t.continuous(now())) : {}),
        };
      },
    };
    return { tenant: t.name, ...(await handle(JSON.stringify(rest), deps)) };
  };

  return { tick, request, queue };
};
