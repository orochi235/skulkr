import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { pin, pinsOf, pinsPath, unpin } from './pins.mjs';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const cfgIn = () => {
  const state = mkdtempSync(join(tmpdir(), 'skulkr-pins-'));
  dirs.push(state);
  return { state };
};

describe('pins', () => {
  it('reads no pins from a missing or garbled file', () => {
    const cfg = cfgIn();
    expect([...pinsOf(cfg)]).toEqual([]);
    writeFileSync(pinsPath(cfg), '["a", ');
    expect([...pinsOf(cfg)]).toEqual([]);
    writeFileSync(pinsPath(cfg), '{"a": 1}');
    expect([...pinsOf(cfg)]).toEqual([]);
  });

  it('pins and unpins an id, answering whether anything changed', () => {
    const cfg = cfgIn();
    expect(pin(cfg, 'b')).toBe(true);
    expect(pin(cfg, 'a')).toBe(true);
    expect(pin(cfg, 'a')).toBe(false);
    expect(JSON.parse(readFileSync(pinsPath(cfg), 'utf8'))).toEqual(['a', 'b']);
    expect(unpin(cfg, 'a')).toBe(true);
    expect(unpin(cfg, 'a')).toBe(false);
    expect([...pinsOf(cfg)]).toEqual(['b']);
  });
});
