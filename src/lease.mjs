/**
 * Leases on disk, shared by every process that runs a round: a file created with `wx` holds a thing for
 * one process, and a lease whose process has died is taken back. Node tree slots, the merge lock and the
 * plan lock are all leases.
 */
import { linkSync, mkdirSync, openSync, renameSync, rmSync, writeSync, closeSync } from 'node:fs';
import { uptime } from 'node:os';
import { dirname } from 'node:path';
import { sleep } from './after.mjs';
import { readJson, writeJson } from './json.mjs';

/** When this machine booted, in ms since the epoch. */
export const bootedAt = () => Date.now() - uptime() * 1000;

/** Leeway for the boot time against a record's own clock reading. */
const BOOT_SLACK_MS = 60_000;

/**
 * Whether process `pid` is alive. EPERM means it is, owned by someone else. `since`, when given, is when the record
 * naming `pid` was written: one written before this machine booted names a pid that may since have been reused, and is dead.
 */
export const pidAlive = (pid, since, booted = bootedAt()) => Number.isInteger(pid) && pid > 0 && sinceBoot(since, booted) && answers(pid);

const sinceBoot = (since, booted) => !(Date.parse(since) < booted - BOOT_SLACK_MS);

/** Whether `target` (a pid, or a negated process group id) takes a signal. EPERM means it is alive, someone else's. */
const answers = (target) => {
  try {
    process.kill(target, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
};

/** What a lease file says, or `undefined` when it is gone or unreadable. */
export const leaseAt = readJson;

/**
 * Whether what a record (a lease, a ticket, a run's status) names is alive: its `pid`, or its process `group` (a job
 * that outlives the process that started it), written at its `at` or `started`.
 */
export const heldAlive = (record) => {
  if (!record) return false;
  const since = record.at ?? record.started;
  const { group } = record;
  return pidAlive(record.pid, since) || (Number.isInteger(group) && group > 0 && sinceBoot(since, bootedAt()) && answers(-group));
};

const create = (path, holder) => {
  const fd = openSync(path, 'wx');
  try {
    writeSync(fd, JSON.stringify(holder));
  } finally {
    closeSync(fd);
  }
};

/**
 * Takes the lease back when its holder is dead. Renaming moves exactly one file away even when two
 * processes race; if what moved turns out to be a live holder's new lease, it is linked back.
 */
const reclaim = (path) => {
  const held = leaseAt(path);
  // A half-written file reads as undefined; only a lease naming a dead pid is taken back.
  if (!held || heldAlive(held)) return false;
  const aside = `${path}.stale-${process.pid}-${Date.now()}`;
  try {
    renameSync(path, aside);
  } catch {
    return false;
  }
  const moved = leaseAt(aside);
  if (moved && heldAlive(moved)) {
    try {
      linkSync(aside, path);
    } catch { /* someone holds it again either way */ }
    rmSync(aside, { force: true });
    return false;
  }
  rmSync(aside, { force: true });
  return true;
};

/**
 * Takes the lease at `path` for this process, recording `{ pid, at, ...about }`. Answers a `release`
 * function, or `undefined` when a live process holds it.
 */
export const takeLease = (path, about = {}) => {
  mkdirSync(dirname(path), { recursive: true });
  const holder = { pid: process.pid, at: new Date().toISOString(), ...about };
  for (let tries = 0; tries < 2; tries++) {
    try {
      create(path, holder);
      let held = true;
      return () => {
        if (!held) return;
        held = false;
        if (leaseAt(path)?.pid === process.pid) rmSync(path, { force: true });
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (!reclaim(path)) return undefined;
    }
  }
  return undefined;
};

/** Adds `about` to the lease at `path` while this process holds it. */
export const amendLease = (path, about) => {
  const held = leaseAt(path);
  if (held?.pid === process.pid) writeJson(path, { ...held, ...about });
};

/** Waits for the lease at `path`, polling every `pollMs`, and answers its `release`. `onWait(holder)` hears once that it waits. */
/** @param {string} path @param {object} [about] @param {{ pollMs?: number, onWait?: (holder: any) => void }} [opts] */
export const waitForLease = async (path, about = {}, { pollMs = 15_000, onWait } = {}) => {
  for (let waited = false; ; waited = true) {
    const release = takeLease(path, about);
    if (release) return release;
    if (!waited) onWait?.(leaseAt(path));
    await sleep(pollMs);
  }
};
