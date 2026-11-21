/**
 * Runs on disk. A run is one round with its parameters, and its id is its round number: it claims
 * `<state>/runs/<N>/` by creating it, keeps `status.json` there while it runs, and leaves `summary.json`
 * when it ends. Any number of runs may be live at once; one whose pid has died is not.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readJson, writeJson as writeJsonAt } from './json.mjs';
import { heldAlive } from './lease.mjs';

export const runsDir = (state) => join(state, 'runs');
export const runDir = (round, state) => join(runsDir(state), String(round));
/** Held from the batch's gate run through `main`'s fast-forward, so two runs never land at once. */
export const mergeLock = (state) => join(state, 'merge.lock');
/** Held from reading what other runs hold through writing this run's status, so two plans never pick one area. */
export const planLock = (state) => join(state, 'plan.lock');

const writeJson = (path, value) => writeJsonAt(path, value, 1);

/** The round numbers claimed on disk, as directory names, for `nextRound`. */
export const claimedRounds = (state) =>
  (existsSync(runsDir(state)) ? readdirSync(runsDir(state)).filter((n) => /^\d+$/.test(n)) : []);

/** Claims the first round from `from` up that no process has claimed, and answers it. */
export const claimRound = (from, state) => {
  mkdirSync(runsDir(state), { recursive: true });
  for (let round = from; ; round++) {
    try {
      mkdirSync(runDir(round, state));
      return round;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
};

/** `at`, when it was written, tells a live run from one whose pid a reboot handed to another process (`heldAlive`). */
export const writeStatus = (round, status, state) =>
  writeJson(join(runDir(round, state), 'status.json'), { ...status, pid: process.pid, at: new Date().toISOString() });
export const writeSummary = (round, summary, state) => writeJson(join(runDir(round, state), 'summary.json'), summary);
/** A finished run's status goes, so nothing reads it as live while its pid is reused. */
export const clearStatus = (round, state) => rmSync(join(runDir(round, state), 'status.json'), { force: true });

const rounds = (state) => claimedRounds(state).map(Number).sort((a, b) => a - b);

/** Every live run's status, by round. */
export const liveRuns = (state) =>
  rounds(state).flatMap((round) => {
    const status = readJson(join(runDir(round, state), 'status.json'));
    return heldAlive(status) ? [{ ...status, round }] : [];
  });

/** The summary of the run that ended last, or `undefined`. */
export const lastFinished = (state) => {
  let last;
  for (const round of rounds(state)) {
    const summary = readJson(join(runDir(round, state), 'summary.json'));
    if (summary && (!last || summary.ended > last.ended)) last = summary;
  }
  return last;
};

/** When the most recent run, live or finished, started, or `undefined`. */
export const lastStartedAt = (state) => {
  // A stopping or crashed run has left the live list and written no summary yet; its status still says when it started.
  const times = [...liveRuns(state), ...rounds(state).flatMap((r) => ['summary.json', 'status.json'].map((f) => readJson(join(runDir(r, state), f))))]
    .flatMap((s) => (s?.started ? [new Date(s.started)] : []));
  return times.length ? new Date(Math.max(...times)) : undefined;
};

/** The areas any live run holds. */
export const areasHeld = (state) => new Set(liveRuns(state).flatMap((r) => r.areas ?? []));

const stopFile = (round, state) => join(runDir(round, state), 'stop');
export const requestStop = (round, state) => writeFileSync(stopFile(round, state), new Date().toISOString());
export const stopRequested = (round, state) => existsSync(stopFile(round, state));
export const clearStop = (round, state) => rmSync(stopFile(round, state), { force: true });

/** Every finished run's summary, by round. */
export const finishedRuns = (state) => rounds(state).flatMap((round) => {
  const summary = readJson(join(runDir(round, state), 'summary.json'));
  return summary ? [{ ...summary, round }] : [];
});

/**
 * Every run's last word on itself, by round: its summary once it ended, else its status, whether it still runs or died
 * without a summary. What a night's spend is summed from, so a crashed round still counts at its last `costUsd`.
 */
export const lastWords = (state) => rounds(state).flatMap((round) => {
  const dir = runDir(round, state);
  const last = readJson(join(dir, 'summary.json')) ?? readJson(join(dir, 'status.json'));
  return last ? [{ ...last, round }] : [];
});

const DAY_MS = 24 * 3_600_000;

/**
 * Deletes the oldest run directories past the newest `keep`, never a live one, nor one started in the last day, whose
 * spend the night's budget still counts.
 */
export const pruneRuns = (keep, state, now = new Date()) => {
  const live = new Set(liveRuns(state).map((r) => r.round));
  const all = rounds(state);
  const recent = (round) => {
    const dir = runDir(round, state);
    const started = (readJson(join(dir, 'summary.json')) ?? readJson(join(dir, 'status.json')))?.started;
    return started && now - new Date(started) < DAY_MS;
  };
  for (const round of all.slice(0, Math.max(0, all.length - keep))) {
    if (!live.has(round) && !recent(round)) rmSync(runDir(round, state), { recursive: true, force: true });
  }
};

/** What a `start` with `continuous` or a `stop` left for continuous mode: `{ on, until, at }`, or undefined. */
const continuousFile = (state) => join(state, 'continuous.json');
export const readContinuous = (state) => readJson(continuousFile(state));
export const writeContinuous = (state, value) => writeJson(continuousFile(state), value);

/** The night directories of every other run at `commit`, newest first, from each run's status or summary. */
export const nightsAt = (commit, state, except) => rounds(state).filter((r) => r !== except).reverse().flatMap((r) => {
  const run = readJson(join(runDir(r, state), 'status.json')) ?? readJson(join(runDir(r, state), 'summary.json'));
  return run?.commit === commit && run.nightDir ? [run.nightDir] : [];
});
