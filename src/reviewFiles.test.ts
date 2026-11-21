import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { gitIn } from './batch.mjs';
import { recentlyChanged, reviewFileList } from './reviewFiles.mjs';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const scratch = () => {
  const d = mkdtempSync(join(tmpdir(), 'skulkr-review-files-'));
  dirs.push(d);
  return d;
};

describe('reviewFileList', () => {
  it('gives each file its line count and marks those changed this week; a file it cannot read gets no count', () => {
    const root = scratch();
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src/a.ts'), 'one\ntwo\nthree\n');
    writeFileSync(join(root, 'src/b.ts'), 'no newline at the end');
    writeFileSync(join(root, 'src/c.ts'), '');
    expect(reviewFileList(root, ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/gone.ts'], new Set(['src/b.ts', 'src/gone.ts']))).toBe(
      '- src/a.ts (3 lines)\n- src/b.ts (1 line, changed this week)\n- src/c.ts (0 lines)\n- src/gone.ts (changed this week)',
    );
  });
});

describe('recentlyChanged', () => {
  it("names the files of the list that a commit of the week before `now` changed", () => {
    const root = scratch();
    const git = gitIn(root);
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'skulkr@example.invalid');
    git('config', 'user.name', 'skulkr');
    const commit = (file: string, at: string) => {
      writeFileSync(join(root, file), at);
      git('add', file);
      process.env.GIT_COMMITTER_DATE = at;
      try {
        git('commit', '-q', '--date', at, '-m', file);
      } finally {
        delete process.env.GIT_COMMITTER_DATE;
      }
    };
    commit('old.ts', '2026-11-01T12:00:00Z');
    commit('new.ts', '2026-11-19T12:00:00Z');
    commit('other.ts', '2026-11-20T12:00:00Z');
    expect([...recentlyChanged(root, ['old.ts', 'new.ts'], new Date('2026-11-21T12:00:00Z'))]).toEqual(['new.ts']);
    expect([...recentlyChanged(scratch(), ['x.ts'])]).toEqual([]);
  });
});
