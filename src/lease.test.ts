import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, uptime } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PLACED, createSlots } from './slots.mjs';
import { heldAlive, leaseAt, pidAlive, takeLease, waitForLease } from './lease.mjs';
import { mergeLock } from './runs.mjs';
import { weaselConfig } from '../test/weaselConfig.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const state = () => {
  const dir = mkdtempSync(join(tmpdir(), 'skulkr-lease-'));
  dirs.push(dir);
  return dir;
};
/** The pid of a process that has already exited. */
const deadPid = () => spawnSync(process.execPath, ['-e', '']).pid as number;

describe('takeLease', () => {
  it('holds a path for one taker until it is released', () => {
    const path = join(state(), 'x', 'lease');
    const release = takeLease(path, { round: 42 });
    expect(release).toBeTypeOf('function');
    expect(leaseAt(path)).toMatchObject({ pid: process.pid, round: 42 });
    expect(takeLease(path)).toBeUndefined();
    release!();
    expect(existsSync(path)).toBe(false);
    const again = takeLease(path, { round: 43 });
    expect(leaseAt(path)).toMatchObject({ round: 43 });
    again!();
  });

  it('takes back a lease whose holder has died, and leaves no file aside', () => {
    const dir = state();
    const path = join(dir, 'lease');
    const dead = deadPid();
    expect(pidAlive(dead)).toBe(false);
    writeFileSync(path, JSON.stringify({ pid: dead, round: 40 }));
    const release = takeLease(path, { round: 41 });
    expect(release).toBeTypeOf('function');
    expect(leaseAt(path)).toMatchObject({ pid: process.pid, round: 41 });
    expect(readdirSync(dir)).toEqual(['lease']);
    release!();
  });

  it('does not take a lease a live process holds, nor one it cannot read', () => {
    const path = join(state(), 'lease');
    writeFileSync(path, JSON.stringify({ pid: process.ppid, round: 40 }));
    expect(takeLease(path)).toBeUndefined();
    writeFileSync(path, '{"pid":');
    expect(takeLease(path)).toBeUndefined();
  });

  it('releasing twice, or after another took it, leaves the other\'s lease alone', () => {
    const path = join(state(), 'lease');
    const release = takeLease(path)!;
    release();
    const other = takeLease(path, { round: 2 })!;
    release();
    expect(leaseAt(path)).toMatchObject({ round: 2 });
    other();
  });
  it('counts a lease alive while the process group it names lives on, though its pid is dead', async () => {
    const child = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' });
    const record = { pid: deadPid(), group: child.pid, at: new Date().toISOString() };
    try {
      expect(heldAlive(record)).toBe(true);
    } finally {
      process.kill(-child.pid!, 'SIGKILL');
    }
    await new Promise((done) => child.on('close', done));
    expect(heldAlive(record)).toBe(false);
  });

  it('takes back a lease written before this machine booted, though its pid is alive again', () => {
    const path = join(state(), 'lease');
    const before = new Date(Date.now() - uptime() * 1000 - 3_600_000).toISOString();
    writeFileSync(path, JSON.stringify({ pid: process.pid, at: before, round: 1 }));
    expect(pidAlive(process.pid, before)).toBe(false);
    expect(pidAlive(process.pid, new Date().toISOString())).toBe(true);
    // A record written before its pid's process started names a process that has since died, its pid reused.
    expect(pidAlive(process.pid, new Date(Date.now() - 3_600_000 * 24 * 365).toISOString(), 0)).toBe(false);
    const release = takeLease(path, { round: 2 });
    expect(leaseAt(path)).toMatchObject({ round: 2 });
    release!();
  });
});

describe('the merge lock', () => {
  it('lets a second run in only once the first lets go', async () => {
    const path = mergeLock(state());
    const first = takeLease(path, { round: 1 })!;
    const heard: unknown[] = [];
    let second: (() => void) | undefined;
    const waiting = waitForLease(path, { round: 2 }, { pollMs: 5, onWait: (h) => heard.push(h) }).then((r) => (second = r));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(second).toBeUndefined();
    expect(heard).toEqual([expect.objectContaining({ round: 1 })]);
    first();
    await waiting;
    expect(leaseAt(path)).toMatchObject({ round: 2 });
    second!();
  });
});

describe('createSlots over leases', () => {
  it('shares one node\'s trees between two runs', () => {
    const dir = state();
    const a = createSlots(weaselConfig(dir), ['studio'], { about: { round: 1 } });
    const b = createSlots(weaselConfig(dir), ['studio'], { about: { round: 2 } });
    const taken = [a.take('review'), b.take('review'), a.take('review'), b.take('review'), a.take('review'), b.take('review')];
    expect(taken.map((s) => s?.tree).sort()).toEqual([1, 2, 3, 4, 5, 6].map((k) => `weasel-skulkr-r${k}`));
    expect(a.take('review')).toBeUndefined();
    expect(b.take('review')).toBeUndefined();
    expect([a.inUse(), b.inUse()]).toEqual([3, 3]);
    expect(leaseAt(join(dir, 'slots', 'studio', taken[1]!.tree))).toMatchObject({ round: 2, role: 'review' });
    taken[1]!.release();
    expect(a.take('review')?.tree).toBe(taken[1]!.tree);
    expect(b.inUse()).toBe(2);
  });

  it('keeps each node to its fixer limit, and reclaims one a dead run left', () => {
    const dir = state();
    writeFileSync(join(dir, 'limits.json'), JSON.stringify({ fix: 1 }));
    mkdirSync(join(dir, 'slots', 'teitou'), { recursive: true });
    writeFileSync(join(dir, 'slots', 'teitou', 'weasel-skulkr-f1'), JSON.stringify({ pid: deadPid(), round: 40 }));
    const a = createSlots(weaselConfig(dir), ['studio', 'teitou']);
    const b = createSlots(weaselConfig(dir), ['studio', 'teitou']);
    expect(a.take('fix')?.node).toBe('studio');
    expect(b.take('fix')).toMatchObject({ node: 'teitou', tree: 'weasel-skulkr-f1' });
    expect(a.take('fix')).toBeUndefined();
  });
});

describe('placed slots', () => {
  it('leases one pool the size of concurrency, names no node for the runner, and is never set aside on a refusal', () => {
    const dir = state();
    const cfg = { ...weaselConfig(dir), concurrency: { review: 2, fix: 1 } };
    const slots = createSlots(cfg, undefined, { places: true });
    const a = slots.take('review');
    expect(a).toMatchObject({ node: PLACED, placed: true });
    expect(slots.take('review')).toBeDefined();
    expect(slots.take('review')).toBeUndefined();
    slots.refuse(PLACED);
    expect(slots.take('fix')).toBeDefined();
    expect(slots.take('fix')).toBeUndefined();
    const pinned = createSlots(cfg, ['studio'], { places: true }).take('review');
    expect(pinned).toMatchObject({ node: 'studio', placed: false });
  });

  it("leases local fixers on this machine, named for the runner, apart from the fleet's fixers", () => {
    const dir = state();
    const cfg = { ...weaselConfig(dir), concurrency: { review: 2, fix: 1 }, localFix: { enabled: false, slots: 2 } };
    const slots = createSlots(cfg, undefined, { places: true });
    expect(slots.take('fix')).toMatchObject({ node: PLACED, placed: true });
    expect(slots.take('localFix')).toMatchObject({ node: 'local', placed: false, tree: 'weasel-skulkr-flocal-1' });
    expect(slots.take('localFix')).toMatchObject({ node: 'local', tree: 'weasel-skulkr-flocal-2' });
    expect(slots.take('localFix')).toBeUndefined();
    writeFileSync(join(dir, 'limits.json'), JSON.stringify({ localFix: 3 }));
    expect(slots.take('localFix')?.tree).toBe('weasel-skulkr-flocal-3');
  });
});

describe('slotsPerNode', () => {
  it('reads limits.json at every lease, so a change reaches runs already going', () => {
    const dir = state();
    const slots = createSlots(weaselConfig(dir), ['studio'], { about: { round: 1 } });
    writeFileSync(join(dir, 'limits.json'), JSON.stringify({ fix: 1 }));
    expect(slots.take('fix')?.tree).toBe('weasel-skulkr-f1');
    expect(slots.take('fix')).toBeUndefined();
    writeFileSync(join(dir, 'limits.json'), JSON.stringify({ fix: 2 }));
    expect(slots.take('fix')?.tree).toBe('weasel-skulkr-f2');
  });
});

describe('spreading', () => {
  it('takes a slot on the node with the fewest live leases of the role', () => {
    const dir = state();
    const slots = createSlots(weaselConfig(dir), ['studio', 'teitou']);
    expect([slots.take('fix')?.node, slots.take('fix')?.node, slots.take('fix')?.node]).toEqual(['studio', 'teitou', 'studio']);
  });
});
