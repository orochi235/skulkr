/**
 * Launching one job of an area: on whichever slot frees first, moving to another node when one turns it away, waiting
 * while no node has room, and reusing a resumed round's result that already came home.
 */
import { cpSync, existsSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { sleep } from './after.mjs';
import { isFinished, reviewText } from './findings.mjs';
import { STARTED, runJob } from './jobs.mjs';
import { readIf } from './text.mjs';
import { agentFor } from './agent/index.mjs';

const minutesSince = (t0) => (Date.now() - t0) / 60_000;
/** How many times a job that never reached its node is launched before its area is recorded incomplete. */
const LAUNCHES = 3;
const RELAUNCH_WAIT_MS = 60_000;
/** How many minutes a job waits, one launch a minute, for a node to make room for its tree: a refusal for room
 *  never counts toward {@link LAUNCHES}, since no node being free is not the job failing. */
const ROOM_WAITS = 120;
/** How many times a placing runner may turn a job away, one launch a minute, before it is recorded not launched. */
const REFUSALS = 120;

/** Roles that run in fixer slots, never on a node that takes no fixers: each runs the project's code. */
const FIX_ROLES = new Set(['fix', 'repair', 'verify']);
/** Roles whose job hands back commits as `fix.mbox`. */
const COMMITTING = new Set(['fix', 'repair']);

/** The slots `role`'s job takes: a fixer or repair under `--local-fix` takes this machine's (`localFix`). */
export const poolFor = (ctx, role) => (ctx.localFix && COMMITTING.has(role) ? 'localFix' : FIX_ROLES.has(role) ? 'fix' : 'review');

/** The budget role a job's `--max-budget-usd` came from. */
const budgetRole = (role) => (role.startsWith('review') ? 'review' : role === 'repair' ? 'fix' : role);

/**
 * A job's earlier result, when a resumed round finds one that came home whole: an exit code, a reply that is
 * not an error (a usage-limit refusal is), and for a committing job its mbox; for a verify job, its verdict.
 * Answers undefined to run it again.
 */
export const cameHome = (spec, role, cfg) => {
  if (role === 'verify') {
    const exit = readIf(join(spec.to, 'verify.exit')).trim();
    return exit === '' ? undefined : { exit, raw: '' };
  }
  const exit = readIf(join(spec.to, 'exit')).trim();
  if (exit === '' || (COMMITTING.has(role) && !existsSync(join(spec.to, 'fix.mbox')))) return undefined;
  const agent = agentFor(cfg, role);
  const raw = readIf(join(spec.to, agent.resultFile));
  if (!raw.trim()) return undefined;
  const result = agent.resultOf(raw, { cfg, role });
  if (result.error) return undefined;
  if (role.startsWith('review') && !isFinished(reviewText(readIf(join(spec.to, 'findings.md')), result.reply))) return undefined;
  return { exit, raw };
};

/**
 * A finished review of `area` from an earlier run at this round's commit (`ctx.earlierNights`), over the same files,
 * copied into `spec.to`: a stopped round's reviews are not paid for twice. Answers it as {@link cameHome} does.
 */
export const earlierReview = (ctx, area, role, spec) => {
  if (!role.startsWith('review') || !area.files) return undefined;
  const files = `${area.files.join('\n')}\n`;
  for (const night of ctx.earlierNights ?? []) {
    if (readIf(join(night, 'areas', area.id, 'files.txt')) !== files) continue;
    const to = join(night, relative(ctx.nightDir, spec.to));
    const found = cameHome({ to }, role, ctx.cfg);
    if (!found) continue;
    cpSync(to, spec.to, { recursive: true, preserveTimestamps: true });
    ctx.say?.(`${role} ${area.id}: reusing the finished review from ${night}`);
    return found;
  }
  return undefined;
};

/**
 * How long a job that came home took when it ran: from its `started` stamp to when its `exit` was written, or 0 where
 * either is missing (a verify job writes no stamp). A reused job reports these, so a resumed round's log and record
 * keep the minutes it first took.
 */
export const earlierMinutes = (dir) => {
  const started = Date.parse(readIf(join(dir, STARTED)).trim());
  const exit = join(dir, existsSync(join(dir, 'exit')) ? 'exit' : 'verify.exit');
  if (!Number.isFinite(started) || !existsSync(exit)) return 0;
  return Math.max(0, (statSync(exit).mtimeMs - started) / 60_000);
};

/**
 * Runs one job of `area` as `role`. Answers where it ran, how long it took, the model's reply, and the job's usage
 * record (also passed to `ctx.usage`, which counts it against the night and logs it); a verify job runs no model
 * and has no usage.
 */
export const dispatch = async (ctx, area, role, spec) => {
  const model = role !== 'verify';
  const earlier = cameHome(spec, role, ctx.cfg) ?? earlierReview(ctx, area, role, spec);
  if (earlier) {
    const { reply, record } = agentFor(ctx.cfg, role).resultOf(earlier.raw, { cfg: ctx.cfg, role });
    const usage = model ? { area: area.id, role, node: 'earlier', ...record, exit: earlier.exit, reused: true } : undefined;
    if (usage) ctx.usage(usage);
    return { status: 0, launched: true, node: 'earlier', minutes: earlierMinutes(spec.to), reply, usage };
  }
  let roomWaits = 0;
  let refusals = 0;
  let firstRefused;
  for (let launches = 1; ; launches++) {
    const slot = await ctx.acquire(poolFor(ctx, role));
    // Under the local runner a model job also holds one of the machine's agents, whatever its role.
    const agentSlot = model && ctx.cfg.runner === 'local' ? await ctx.acquire('agent') : null;
    const t0 = Date.now();
    // What an earlier launch left would otherwise read as this one's answer if this one never runs.
    if (model) for (const f of [STARTED, 'exit', agentFor(ctx.cfg, role).resultFile, 'fix.mbox']) rmSync(join(spec.to, f), { force: true });
    let result;
    try {
      result = await runJob({ ...spec, cfg: ctx.cfg, runner: ctx.runner, frozen: ctx.frozen, base: ctx.base, slot });
    } finally {
      agentSlot?.release();
      slot.release();
    }
    let gaveUp = false;
    if (result.refused) {
      ctx.refuse(slot.node);
      refusals += 1;
      firstRefused ??= Date.now();
      const stopped = Boolean(ctx.stopped?.());
      // A placing runner relaunches each minute, up to REFUSALS times; a pinned run waits out each node's cooldown
      // instead, so it gets the same span of time, after which every node it may use has gone on refusing.
      gaveUp = stopped || (slot.placed ? refusals >= REFUSALS : Date.now() - firstRefused >= REFUSALS * RELAUNCH_WAIT_MS);
      if (!gaveUp) {
        ctx.say(`${role} ${area.id} refused by ${result.node ?? slot.node}, trying ${slot.placed ? 'again' : 'another node'}`);
        if (slot.placed) await sleep(RELAUNCH_WAIT_MS);
        // A refusal has its own limit, REFUSALS; it spends none of the launches a failed launch may retry with.
        launches -= 1;
        continue;
      }
      ctx.say(`${role} ${area.id} refused by ${result.node ?? slot.node}; ${stopped ? 'stop requested' : `refused ${refusals} times over ${Math.round((Date.now() - firstRefused) / 60_000)} min`}, so not launched`);
    }
    const node = result.node ?? slot.node;
    const exit = readIf(join(spec.to, model ? 'exit' : 'verify.exit')).trim();
    // A model that started and left no exit was cut off, by a timeout or a kill: it ran (and was paid for), so it is
    // never launched again.
    const ran = Boolean(exit) || (model && existsSync(join(spec.to, STARTED)));
    // Neither: the job never ran on the node, so there is no reply to read, only another launch to try.
    if (!gaveUp && result.status !== 0 && !ran && roomWaits < ROOM_WAITS && result.noRoom) {
      roomWaits += 1;
      launches -= 1;
      if (roomWaits === 1 || roomWaits % 10 === 0) ctx.say(`${role} ${area.id}: no node has room for its tree (${roomWaits} min waited); waiting`);
      await sleep(RELAUNCH_WAIT_MS);
      continue;
    }
    if (!gaveUp && result.status !== 0 && !ran && launches < LAUNCHES) {
      ctx.say(`${role} ${area.id} did not launch${slot.placed ? '' : ` on ${slot.node}`} (launch ${launches} of ${LAUNCHES}); trying again`);
      await sleep(RELAUNCH_WAIT_MS);
      continue;
    }
    if (!model) return { status: result.status, launched: Boolean(exit), node, minutes: minutesSince(t0), reply: '' };
    const agent = agentFor(ctx.cfg, role);
    const { reply, record } = agent.resultOf(readIf(join(spec.to, agent.resultFile)), { cfg: ctx.cfg, role });
    const usage = { area: area.id, role, node, ...record, exit };
    ctx.usage(usage);
    if (usage.budgetHit) ctx.say(`${role} ${area.id} stopped at its $${ctx.budget[budgetRole(role)]} ceiling`);
    return { status: result.status, launched: ran, node, minutes: minutesSince(t0), reply, usage };
  }
};
