/**
 * The fleet queue: one batch gate at a time across every tenant this host serves, and every run started by hand,
 * since a gate is a suite-sized fleet run. A lease (`lease.mjs`) holds the gate; a run waiting for it leaves a ticket,
 * and the oldest live ticket takes the lease next, so rounds take the fleet in the order they reached it.
 *
 *   <dir>/gate.lease            the holder: { pid, at, tenant, round }
 *   <dir>/waiting/<ticket>.json  each waiting run, named so they sort oldest first; a dead pid's is cleared
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { leaseAt, pidAlive, takeLease } from './lease.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The fleet queue's directory: `SKULKR_FLEET`, else `~/.local/state/skulkr/fleet`, beside the tenants' own state. */
export const fleetDir = (env = process.env) => env.SKULKR_FLEET ?? join(homedir(), '.local', 'state', 'skulkr', 'fleet');

const leasePath = (dir) => join(dir, 'gate.lease');
const waitingDir = (dir) => join(dir, 'waiting');

/** The live tickets, oldest first, as `{ file, pid, at, ...about }`; a dead holder's ticket is deleted. */
const tickets = (dir) => {
  let names;
  try {
    names = readdirSync(waitingDir(dir)).filter((n) => n.endsWith('.json')).sort();
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    const file = join(waitingDir(dir), name);
    const t = leaseAt(file);
    if (t && pidAlive(t.pid)) return [{ file, ...t }];
    // A half-written ticket reads as undefined; only one naming a dead pid is cleared.
    if (t) rmSync(file, { force: true });
    return [];
  });
};

const about = ({ file: _file, pid: _pid, ...rest }) => rest;

/** Who holds the gate (`{ tenant, round, at }` or null) and who waits for it, oldest first. */
export const readFleet = (dir = fleetDir()) => {
  const held = leaseAt(leasePath(dir));
  return { holder: held && pidAlive(held.pid) ? about(held) : null, waiting: tickets(dir).map(about) };
};

/**
 * Waits for the gate, in turn, and answers its `release`. `who` (`{ tenant, round }`) is recorded in the ticket and
 * the lease. `onWait({ holder, ahead })` hears that it waits, with what is ahead of it, and again whenever the holder
 * changes.
 */
/** @param {string} dir @param {object} who @param {{ pollMs?: number, onWait?: (q: { holder: any, ahead: any[] }) => void }} [opts] */
export const waitForFleet = async (dir, who, { pollMs = 15_000, onWait } = {}) => {
  const at = new Date();
  const mine = join(waitingDir(dir), `${String(at.getTime()).padStart(15, '0')}-${process.pid}-${Math.random().toString(36).slice(2, 8)}.json`);
  const ticket = JSON.stringify({ pid: process.pid, at: at.toISOString(), ...who });
  let heard;
  try {
    for (;;) {
      let queue = tickets(dir);
      if (!queue.some((t) => t.file === mine)) {
        mkdirSync(waitingDir(dir), { recursive: true });
        writeFileSync(mine, ticket);
        queue = tickets(dir);
      }
      const release = queue[0]?.file === mine ? takeLease(leasePath(dir), who) : undefined;
      if (release) return release;
      const holder = readFleet(dir).holder;
      const key = JSON.stringify(holder);
      if (key !== heard) {
        heard = key;
        onWait?.({ holder, ahead: queue.slice(0, queue.findIndex((t) => t.file === mine)).map(about) });
      }
      await sleep(pollMs);
    }
  } finally {
    rmSync(mine, { force: true });
  }
};
