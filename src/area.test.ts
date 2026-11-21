import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { reviewFileList } from './area.mjs';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('reviewFileList', () => {
  it('gives each file its line count, and a file it cannot read its path alone', () => {
    const root = mkdtempSync(join(tmpdir(), 'skulkr-area-'));
    dirs.push(root);
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src/a.ts'), 'one\ntwo\nthree\n');
    writeFileSync(join(root, 'src/b.ts'), 'no newline at the end');
    writeFileSync(join(root, 'src/c.ts'), '');
    expect(reviewFileList(root, ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/gone.ts'])).toBe(
      '- src/a.ts (3 lines)\n- src/b.ts (1 line)\n- src/c.ts (0 lines)\n- src/gone.ts',
    );
  });
});
