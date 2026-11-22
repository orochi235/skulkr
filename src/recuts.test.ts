import { describe, expect, it } from 'vitest';
import { recutIn } from './recuts.mjs';

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
