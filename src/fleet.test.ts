import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, uptime } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { nextContinuous } from './continuous.mjs';
import { gateAhead, readFleet, waitForFleet } from './fleet.mjs';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const fleet = () => {
  const dir = mkdtempSync(join(tmpdir(), 'skulkr-fleet-'));
  dirs.push(dir);
  return dir;
};
const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

describe('gateAhead', () => {
  it('holds a new review, and nothing else, while a gate holds the fleet', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'skulkr-gate-ahead-'));
    try {
      expect(gateAhead('review', dir)).toBeNull();
      const release = await waitForFleet(dir, { tenant: 'weasel', round: 62 });
      expect(gateAhead('review', dir)).toMatchObject({ tenant: 'weasel', round: 62 });
      expect(gateAhead('fix', dir)).toBeNull();
      release();
      expect(gateAhead('review', dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the fleet queue', () => {
  it('has no holder, nor waiter, written before this machine booted', () => {
    const dir = fleet();
    const before = new Date(Date.now() - uptime() * 1000 - 3_600_000).toISOString();
    writeFileSync(join(dir, 'gate.lease'), JSON.stringify({ pid: process.pid, at: before, tenant: 'weasel', round: 1 }));
    mkdirSync(join(dir, 'waiting'));
    writeFileSync(join(dir, 'waiting', '1.json'), JSON.stringify({ pid: process.pid, at: before, tenant: 'weasel', round: 2 }));
    expect(readFleet(dir)).toEqual({ holder: null, waiting: [] });
  });

  it('runs one gate at a time, in the order rounds reached it, and says who each waits behind', async () => {
    const dir = fleet();
    const heard: unknown[] = [];
    const n = await waitForFleet(dir, { tenant: 'weasel', round: 50 }, { pollMs: 5 });
    expect(readFleet(dir)).toMatchObject({ holder: { tenant: 'weasel', round: 50 }, waiting: [] });
    let n1: (() => void) | undefined;
    let other: (() => void) | undefined;
    const waiting = waitForFleet(dir, { tenant: 'weasel', round: 51 }, { pollMs: 5, onWait: (q) => heard.push(q) }).then((r) => (n1 = r));
    await tick(10);
    const later = waitForFleet(dir, { tenant: 'colm', round: 3 }, { pollMs: 5 }).then((r) => (other = r));
    await tick();
    expect(n1).toBeUndefined();
    expect(heard).toEqual([{ holder: expect.objectContaining({ tenant: 'weasel', round: 50 }), ahead: [] }]);
    expect(readFleet(dir).waiting).toMatchObject([{ tenant: 'weasel', round: 51 }, { tenant: 'colm', round: 3 }]);
    n();
    await waiting;
    await tick();
    // The second waiter came later, so it still waits, now behind 51.
    expect(other).toBeUndefined();
    expect(readFleet(dir)).toMatchObject({ holder: { round: 51 }, waiting: [{ tenant: 'colm' }] });
    n1!();
    await later;
    other!();
    expect(readFleet(dir)).toEqual({ holder: null, waiting: [] });
    expect(readdirSync(join(dir, 'waiting'))).toEqual([]);
  });

  it('passes over a waiter whose process has died, and clears its ticket', async () => {
    const dir = fleet();
    const dead = spawnSync(process.execPath, ['-e', '']).pid as number;
    mkdirSync(join(dir, 'waiting'), { recursive: true });
    writeFileSync(join(dir, 'waiting', '000000000000001-x.json'), JSON.stringify({ pid: dead, tenant: 'gone', round: 1 }));
    const release = await waitForFleet(dir, { tenant: 'weasel', round: 52 }, { pollMs: 5 });
    expect(readFleet(dir)).toEqual({ holder: expect.objectContaining({ round: 52 }), waiting: [] });
    release();
  });
});

describe('two rounds of one tenant, pipelined', () => {
  it('starts N+1 when N reaches its batch, and holds N+1 at its gate while N\'s runs', async () => {
    const dir = fleet();
    const runs = [{ round: 50, step: 'review' }];
    const decide = () => nextContinuous({ now: new Date(), mode: { on: true, by: 'request' }, readOnly: false, runs, spentUsd: 0, estimateUsd: 50, nightUsd: 200, capUsd: 160 });
    expect(decide()).toMatchObject({ start: false, behind: 50 });
    runs[0]!.step = 'patch';
    expect(decide()).toMatchObject({ start: true });
    runs.push({ round: 51, step: 'review' });
    // N reaches its gate and takes the fleet; N+1 does its model work meanwhile.
    runs[0]!.step = 'fleet';
    const n = await waitForFleet(dir, { tenant: 'weasel', round: 50 }, { pollMs: 5 });
    expect(decide()).toMatchObject({ start: false, behind: 51 });
    // N+1 reaches its gate while N's runs: it waits, and says behind whom.
    runs[1]!.step = 'fleet-wait';
    let behind: unknown;
    let n1: (() => void) | undefined;
    const waiting = waitForFleet(dir, { tenant: 'weasel', round: 51 }, { pollMs: 5, onWait: (q) => (behind = q.holder) }).then((r) => (n1 = r));
    await tick();
    expect(n1).toBeUndefined();
    expect(behind).toMatchObject({ tenant: 'weasel', round: 50 });
    // And N+2 may start: neither is in its model steps.
    expect(decide()).toMatchObject({ start: true });
    n();
    await waiting;
    expect(readFleet(dir).holder).toMatchObject({ round: 51 });
    n1!();
  });
});
