import { describe, expect, it } from 'vitest';
import { resolveConfig } from './config.mjs';
import { partition as partitionWith } from './partition.mjs';
import { weaselConfig } from '../test/weaselConfig.ts';

const cfg = weaselConfig();
const { maxFiles: MAX_AREA_FILES, minFiles: MIN_AREA_FILES } = cfg.partition;
const isAuditSource = cfg.partition.isSource;
const areaId = cfg.partition.areaId;
const partition = (paths: string[]) => partitionWith(cfg, paths);

const files = (dir: string, n: number, ext = 'ts') => Array.from({ length: n }, (_, i) => `${dir}/f${String(i).padStart(3, '0')}.${ext}`);

describe('isAuditSource', () => {
  it('takes package src and app source, and leaves tests, fixtures, vendored code and declarations out', () => {
    expect(isAuditSource('packages/core/src/a.ts')).toBe(true);
    expect(isAuditSource('apps/draw/src/App.tsx')).toBe(true);
    expect(isAuditSource('apps/draw/src/app.css')).toBe(true);
    expect(isAuditSource('packages/core/src/a.test.ts')).toBe(false);
    expect(isAuditSource('packages/core/src/a.browser.test.tsx')).toBe(false);
    expect(isAuditSource('packages/geom/src/x.pbt.fixture.ts')).toBe(false);
    expect(isAuditSource('packages/text-shaping/src/vendor/hb.js')).toBe(false);
    expect(isAuditSource('packages/icons-plugin/src/fixtures/app/src/a.ts')).toBe(false);
    expect(isAuditSource('packages/core/src/types.d.ts')).toBe(false);
    expect(isAuditSource('packages/core/README.md')).toBe(false);
    expect(isAuditSource('packages/core/test/a.ts')).toBe(false);
  });
});

describe('partition', () => {
  it('keeps a package that fits as one area named for it', () => {
    expect(partition(files('packages/clock/src', 5))).toEqual([{ id: 'clock', files: files('packages/clock/src', 5) }]);
    expect(areaId('apps/draw/src/dev')).toBe('apps.draw.src.dev');
  });

  it('splits a large directory by subdirectory, folding small ones into the parent\'s own files', () => {
    const big = files('packages/core/src/canvas', MAX_AREA_FILES - 5);
    const small = files('packages/core/src/util', MIN_AREA_FILES - 1);
    const own = files('packages/core/src', 3);
    const areas = partition([...big, ...small, ...own]);
    expect(areas.map((a) => a.id)).toEqual(['core', 'core.canvas']);
    expect(areas[0].files).toEqual([...own, ...small].sort());
    expect(areas[1].files).toEqual(big);
  });

  it('chunks a flat directory past the limit into even parts', () => {
    const areas = partition(files('packages/ui/src/components', MAX_AREA_FILES * 2 + 1));
    expect(areas.map((a) => a.id)).toEqual(['ui.part1', 'ui.part2', 'ui.part3'].map((id) => id.replace('ui', 'ui.components')));
    expect(areas.every((a) => a.files.length <= MAX_AREA_FILES)).toBe(true);
  });

  it('answers the same areas whatever order the paths come in, and keeps an unchanged directory\'s id when another grows', () => {
    const before = [...files('packages/core/src/canvas', 40), ...files('packages/core/src/scene', 40)];
    expect(partition([...before].reverse())).toEqual(partition(before));
    const after = partition([...before, ...files('packages/core/src/scene/deep', 30)]);
    expect(after.find((a) => a.id === 'core.canvas')).toEqual(partition(before).find((a) => a.id === 'core.canvas'));
  });
});

describe('the default config', () => {
  it('cuts areas from src/ by directory, naming each for its path', () => {
    const plain = resolveConfig({});
    const paths = [...files('src/a', 3), ...files('src', 2), 'src/a/x.test.ts', 'lib/other.ts'];
    expect(partitionWith(plain, paths)).toEqual([{ id: 'src', files: [...files('src', 2), ...files('src/a', 3)].sort() }]);
  });

  it('takes its roots, limits and ids from the config', () => {
    const custom = resolveConfig({ partition: { roots: ['lib/*'], extensions: ['py'], maxFiles: 2, minFiles: 1, areaId: (d: string) => d.split('/').at(-1) } });
    const areas = partitionWith(custom, [...files('lib/one', 3, 'py'), ...files('lib/two', 1, 'py'), 'lib/two/x.ts']);
    expect(areas.map((a) => [a.id, a.files.length])).toEqual([['one.part1', 2], ['one.part2', 1], ['two', 1]]);
  });
});
