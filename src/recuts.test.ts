import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveConfig } from './config.mjs';
import { recutIn, recutsIn } from './recuts.mjs';

const area = (id: string, ...files: string[]) => ({ id, files });

describe('recutIn', () => {
  it('is empty when no area is new', () => {
    expect(recutIn([area('a', 'a/1')], [area('a', 'a/1', 'a/2')])).toEqual([]);
  });

  it('names a new area and the one it took its files from', () => {
    const before = [area('core', 'core/x', 'core/layers/1', 'core/layers/2'), area('ui', 'ui/1')];
    const after = [area('core', 'core/x'), area('core.layers', 'core/layers/1', 'core/layers/2'), area('ui', 'ui/1')];
    expect(recutIn(before, after).sort()).toEqual(['core', 'core.layers']);
  });

  it('names every part of a directory cut into one more', () => {
    const before = [area('d.part1', 'd/1', 'd/2'), area('d.part2', 'd/3', 'd/4'), area('e', 'e/1')];
    const after = [area('d.part1', 'd/1'), area('d.part2', 'd/2', 'd/3'), area('d.part3', 'd/4', 'd/5'), area('e', 'e/1')];
    expect(recutIn(before, after).sort()).toEqual(['d.part1', 'd.part2', 'd.part3']);
  });

  it('names a new directory alone', () => {
    expect(recutIn([area('a', 'a/1')], [area('a', 'a/1'), area('tiles', 'tiles/1')])).toEqual(['tiles']);
  });
});

describe('recutsIn', () => {
  it('reads rounds recorded before the record moved, and takes the move for no round', () => {
    const root = mkdtempSync(join(tmpdir(), 'skulkr-recuts-'));
    try {
      const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
      git('init', '-q', '-b', 'main');
      git('config', 'user.name', 't');
      git('config', 'user.email', 't@t');
      const record = (dir: string, round: number, areas: { id: string; files: string[] }[]) => {
        mkdirSync(join(root, dir, `round-${round}`), { recursive: true });
        writeFileSync(join(root, dir, `round-${round}/README.md`), `round ${round}\n`);
        writeFileSync(join(root, dir, 'partition.json'), JSON.stringify(areas));
        git('add', '-A');
        git('commit', '-qm', `round ${round}`);
      };
      const a = { id: 'a', files: ['src/a.ts'] };
      const b = { id: 'b', files: ['src/b.ts'] };
      const c = { id: 'c', files: ['src/c.ts'] };
      record('docs/audits', 1, [a]);
      record('docs/audits', 2, [a, b]);
      mkdirSync(join(root, '.skulkr'));
      git('mv', 'docs/audits/round-1', 'docs/audits/round-2', 'docs/audits/partition.json', '.skulkr/');
      git('commit', '-qm', 'move the record');
      record('.skulkr', 3, [a, b, c]);
      const cfg = resolveConfig({ name: 'p', root, record: { formerDirs: ['docs/audits'] } }, { root });
      expect(cfg.record.dirs).toEqual(['.skulkr', 'docs/audits']);
      expect(recutsIn(cfg, git, root, [a, b, c])).toEqual([{ round: 2, areas: ['b'] }, { round: 3, areas: ['c'] }]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
