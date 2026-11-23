import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveConfig } from './config.mjs';
import { continuousOf } from './continuousOf.mjs';
import { writeContinuous } from './runs.mjs';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const at = (hhmm: string, day = 16) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2026, 10, day, h!, m!);
};
const write = (state: string, round: number, file: string, body: object) => {
  mkdirSync(join(state, 'runs', String(round)), { recursive: true });
  writeFileSync(join(state, 'runs', String(round), file), JSON.stringify(body));
};
const fleet = { holder: null, waiting: [] };

describe('continuousOf', () => {
  it('reads the night\'s spend, the estimate and the mode from the state on disk', () => {
    const state = mkdtempSync(join(tmpdir(), 'skulkr-cont-'));
    dirs.push(state);
    const cfg = resolveConfig({ name: 'p', state, areasPerRound: 4, budget: { nightUsd: 100 } });
    write(state, 40, 'summary.json', { started: at('06:00').toISOString(), ended: at('06:50').toISOString(), costUsd: 70, areas: [1, 2] });
    write(state, 41, 'summary.json', { started: at('23:00').toISOString(), ended: at('23:40').toISOString(), costUsd: 30, areas: [1, 2, 3] });
    write(state, 42, 'status.json', { started: at('23:41').toISOString(), step: 'fleet', costUsd: 12, pid: process.pid });
    expect(continuousOf(cfg, { now: at('23:50'), fleet }).mode).toEqual({ on: false, by: 'off' });
    writeContinuous(state, { on: true, until: at('07:00', 17).toISOString() });
    const now = continuousOf(cfg, { now: at('23:50'), fleet });
    // Round 40 started before the night's 07:00; per area, rounds 40 and 41 cost $20.
    expect(now.budget).toMatchObject({ nightUsd: 100, spentUsd: 42, leftUsd: 58, estimateUsd: 80, estimateUsdPerArea: 20 });
    expect(now.next).toMatchObject({ start: false, why: expect.stringContaining('the night\'s budget') });
    expect(now.queues).toEqual({ model: null, fleet });
    expect(continuousOf(cfg, { now: at('23:50'), fleet, pending: 1 }).next).toMatchObject({ why: 'a round is starting' });
  });

  it('counts a round that died without a summary at its last status\'s spend', () => {
    const state = mkdtempSync(join(tmpdir(), 'skulkr-cont-'));
    dirs.push(state);
    const cfg = resolveConfig({ name: 'p', state, areasPerRound: 4, budget: { nightUsd: 100 } });
    const dead = spawnSync(process.execPath, ['-e', '']).pid;
    write(state, 43, 'status.json', { started: at('23:00').toISOString(), step: 'review', costUsd: 25, pid: dead });
    expect(continuousOf(cfg, { now: at('23:50'), fleet }).budget).toMatchObject({ spentUsd: 25 });
  });

  it('keeps the chain ended for the night across a restart, from the state on disk', () => {
    const state = mkdtempSync(join(tmpdir(), 'skulkr-cont-'));
    dirs.push(state);
    const cfg = resolveConfig({ name: 'p', state, areasPerRound: 4, budget: { nightUsd: 100, areaGuessUsd: 1 } });
    writeContinuous(state, { on: true, until: at('07:00', 17).toISOString() });
    expect(continuousOf(cfg, { now: at('23:50'), fleet }).next).toMatchObject({ start: true });
    writeFileSync(join(state, 'continuous-idle.json'), JSON.stringify({ until: at('23:55').toISOString(), why: 'failed' }));
    expect(continuousOf(cfg, { now: at('23:50'), fleet }).next).toMatchObject({ start: false, why: expect.stringContaining('found nothing to do or failed') });
    expect(continuousOf(cfg, { now: at('23:56'), fleet }).next).toMatchObject({ start: true });
  });
});
