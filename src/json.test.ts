import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readJson, writeJson } from './json.mjs';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('json files', () => {
  it('writes into a new directory, leaves no temporary file, and reads it back', () => {
    const dir = mkdtempSync(join(tmpdir(), 'skulkr-json-'));
    dirs.push(dir);
    const path = join(dir, 'a', 'b.json');
    writeJson(path, { x: 1 }, 1);
    expect(readJson(path)).toEqual({ x: 1 });
    expect(readdirSync(join(dir, 'a'))).toEqual(['b.json']);
  });

  it('reads a missing or half-written file as undefined', () => {
    const dir = mkdtempSync(join(tmpdir(), 'skulkr-json-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'half.json'), '{"x":');
    expect(readJson(join(dir, 'half.json'))).toBeUndefined();
    expect(readJson(join(dir, 'none.json'))).toBeUndefined();
  });
});
