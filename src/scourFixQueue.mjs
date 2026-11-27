/**
 * The fix queue (docs/scour.md "Fix queue"): areas waiting for `skulkr scour fix`, in order, kept in
 * `<state>/scour/fix-queue.json`. `scour queue add|drop|ls` edits and prints it; `scour fix --queue [--lanes N]` drains
 * it, starting the first area whenever fewer than N fix runs are live, any fix run counting, queued or not.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { liveScourOf } from './delveLive.mjs';
import { ledgerOf } from './ledger.mjs';
import { scourStateDirOf } from './scourPaths.mjs';
import { fixRunsIn, fixStatusesFor } from './scourFixStatus.mjs';
import { fixPlanFor } from './scourTriage.mjs';

const BIN = fileURLToPath(new URL('../bin/skulkr.mjs', import.meta.url));

/** Verdicts that take a defect out of a later fix run's hands. */
const SETTLED = new Set(['fixed', 'not a defect', 'duplicate']);

const queueFileOf = (cfg) => join(scourStateDirOf(cfg), 'fix-queue.json');

/** The queued area ids, first to start first. */
export const fixQueueOf = (cfg) => {
  try {
    const ids = JSON.parse(readFileSync(queueFileOf(cfg), 'utf8'));
    return Array.isArray(ids) ? ids.filter((x) => typeof x === 'string') : [];
  } catch { return []; }
};

/** Writes the queue whole, through a rename so a reader never sees half of it. */
export const writeFixQueue = (cfg, ids) => {
  mkdirSync(scourStateDirOf(cfg), { recursive: true });
  const tmp = `${queueFileOf(cfg)}.${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(ids)}\n`);
  renameSync(tmp, queueFileOf(cfg));
};

/** The queue with `ids` added at its end, those already queued left where they are. */
export const withQueued = (queue, ids) => [...queue, ...ids.filter((id, i) => !queue.includes(id) && ids.indexOf(id) === i)];

/** The queue less `ids`. */
export const withDropped = (queue, ids) => queue.filter((id) => !ids.includes(id));

/** What a fix run on ledger `id` would take on now: its defects no fix run has settled, and the batches triage makes of
 *  them; null with no ledger. */
export const fixWorkOf = (cfg, id, runs = fixRunsIn(cfg)) => {
  const ledger = ledgerOf(cfg, id);
  if (!ledger) return null;
  const statuses = fixStatusesFor(ledger.area, runs);
  const plan = fixPlanFor(ledger, { open: (d) => !SETTLED.has(statuses[d.id]?.status), recurrent: cfg.saturate.recurrent });
  return { open: plan.batches.reduce((n, b) => n + b.defects.length, 0) + plan.ask.length, batches: plan.batches.length };
};

/** What a fix batch's job is doing, from its step: `fixing`, `verifying`, `repairing`, or `starting` before its first log. */
export const phaseOf = (step) => (!step ? 'starting' : step.startsWith('verify') ? 'verifying' : step.startsWith('repair') ? 'repairing' : 'fixing');

/**
 * The fix queue as the Scour page shows it: each area a live fix run holds first (`running`, with its batches done of
 * its `max`, and its batch's `phase` and that step's `progress`), then the queued ones with `fixWorkOf`'s counts. `list` is `ledgerListOf`'s.
 */
export const fixQueueIn = (cfg, list, runs = fixRunsIn(cfg)) => {
  const running = list.filter((l) => l.id === l.area && l.running?.does === 'fix').map((l) => {
    const run = runs.find((r) => r.n === l.fix?.lastRun?.n);
    const job = l.running.jobs[0];
    return { area: l.area, running: true, done: run?.record?.batches?.length ?? 0, batches: l.running.max ?? null, open: null, phase: phaseOf(job?.step), progress: job?.progress ?? null };
  });
  const live = new Set(running.map((r) => r.area));
  const queued = fixQueueOf(cfg).filter((id) => !live.has(id)).map((id) => ({ area: id, running: false, done: 0, ...(fixWorkOf(cfg, id, runs) ?? { open: null, batches: null }) }));
  return [...running, ...queued];
};

/** The areas a live fix run holds now. */
export const liveFixesIn = (cfg) => {
  const dir = scourStateDirOf(cfg);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !/^fix-\d+$/.test(e.name))
    .map((e) => e.name).filter((id) => liveScourOf(cfg, id, 0)?.does === 'fix');
};

/** The queue as terminal lines, the numbers right-aligned. */
export const fixQueueLines = (rows) => {
  if (rows.length === 0) return ['the fix queue is empty'];
  const width = Math.max(4, ...rows.map((r) => r.area.length));
  const n = (x, w) => String(x ?? '–').padStart(w);
  return [
    `${'area'.padEnd(width)}  ${'open'.padStart(6)}  ${'batches'.padStart(7)}`,
    ...rows.map((r) => `${r.area.padEnd(width)}  ${r.running ? `${r.phase ?? 'fixing'} ${r.done + 1}/${r.batches ?? '?'}${r.progress ? ` · ${r.progress.done}/${r.progress.of}` : ''}`.padStart(15) : `${n(r.open, 6)}  ${n(r.batches, 7)}`}`),
  ];
};

/**
 * `skulkr scour fix --queue`: every 30 seconds, while fewer than `lanes` fix runs are live (as `liveFixes` counts them)
 * and the queue holds an area, takes the first off and starts `skulkr scour fix <area>` as its own process, detached,
 * its output in `<state>/scour/fix-<area>.log`. Ends once the queue is empty and the runs it started have ended.
 * @param {{ lanes?: number, ready?: boolean, liveFixes?: () => string[], root: string, say: (line: string) => void, pollMs?: number }} opts
 */
export const drainFixQueue = async (cfg, { lanes = 1, ready = false, liveFixes = () => liveFixesIn(cfg), root, say, pollMs = 30_000 }) => {
  if (!cfg.file) throw new Error('the fix queue starts its runs with --config, and this config has no file');
  const mine = new Map();
  for (;;) {
    const live = liveFixes();
    for (const [area, child] of mine) if (child.exitCode !== null && !live.includes(area)) mine.delete(area);
    const queue = fixQueueOf(cfg);
    if (queue.length === 0 && mine.size === 0) return;
    if (queue.length && live.length < lanes) {
      const area = queue[0];
      writeFixQueue(cfg, withDropped(fixQueueOf(cfg), [area]));
      if (live.includes(area)) { say(`fix queue: ${area} already has a live fix run; dropped`); continue; }
      const log = join(scourStateDirOf(cfg), `fix-${area}.log`);
      const out = openSync(log, 'w');
      const child = spawn(process.execPath, [BIN, 'scour', 'fix', area, '--config', cfg.file, ...(ready ? ['--ready'] : [])], { cwd: root, detached: true, stdio: ['ignore', out, out] });
      child.unref();
      mine.set(area, child);
      say(`fix queue: started ${area} (pid ${child.pid}, ${live.length + 1} of ${lanes} lanes); log ${log}`);
      // Its lease takes a moment; wait for it before counting lanes again.
      for (let i = 0; i < 20 && !liveFixes().includes(area) && child.exitCode === null; i++) await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
};

