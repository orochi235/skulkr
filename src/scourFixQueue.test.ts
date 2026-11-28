import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fixQueueLines, fixQueueOf, withDropped, withQueued, writeFixQueue } from './scourFixQueue.mjs';

describe('the fix queue', () => {
  const dirs: string[] = [];
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
  const cfgIn = () => {
    const state = mkdtempSync(join(tmpdir(), 'skulkr-queue-'));
    dirs.push(state);
    return { state };
  };

  it('adds at the end, leaving an area already queued where it is, and drops by id', () => {
    expect(withQueued(['a', 'b'], ['c', 'a', 'c'])).toEqual(['a', 'b', 'c']);
    expect(withDropped(['a', 'b', 'c'], ['b', 'x'])).toEqual(['a', 'c']);
  });

  it('reads back what it wrote, and an empty queue with no file', () => {
    const cfg = cfgIn();
    expect(fixQueueOf(cfg)).toEqual([]);
    writeFixQueue(cfg, ['routing.tools', 'core.canvas.part4']);
    expect(fixQueueOf(cfg)).toEqual(['routing.tools', 'core.canvas.part4']);
  });

  it('prints running areas by batch and queued ones by their open defects and batches', () => {
    expect(fixQueueLines([
      { area: 'forge.vite.part2', running: true, done: 2, batches: 8, open: null },
      { area: 'cursor', running: false, done: 0, open: 14, batches: 2 },
    ])).toEqual([
      'area                open  batches',
      'forge.vite.part2       fixing 3/8',
      'cursor                14        2',
    ]);
    expect(fixQueueLines([{ area: 'animator.engine', running: true, done: 3, batches: 3, open: null, phase: 'landing' }])[1])
      .toBe('animator.engine      landing 3/3');
    expect(fixQueueLines([])).toEqual(['the fix queue is empty']);
  });
});
