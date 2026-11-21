import { describe, expect, it } from 'vitest';
import { areaIcons, iconNameOf, iconsFor } from './icons.mjs';

const packageOf = (file: string) => /^pkg\/([^/]+)\//.exec(file)?.[1] ?? null;
const ICONS = {
  areas: { ui: 'groupIcon', 'ui.menu': 'menuIcon', 'ui.menu.items': null },
  packageOf,
  packages: { ui: 'uiIcon', core: 'coreIcon' },
  glyph: (name: string) => (name === 'missing' ? undefined : `<path d="M 0 0 L ${name.length} 0"/>`),
};
const area = (id: string, ...files: string[]) => ({ id, files });

describe('an area\'s icon', () => {
  it('is the one named for its own id before one named for a group holding it', () => {
    expect(iconNameOf(ICONS, area('ui.menu', 'pkg/ui/menu.ts'))).toBe('menuIcon');
    expect(iconNameOf(ICONS, area('ui.menu.part2', 'pkg/ui/menu/b.ts'))).toBe('menuIcon');
    expect(iconNameOf(ICONS, area('ui.button', 'pkg/ui/button.ts'))).toBe('groupIcon');
  });

  it('matches a group by whole segments, not by any prefix of the id', () => {
    expect(iconNameOf(ICONS, area('uikit', 'pkg/core/a.ts'))).toBe('coreIcon');
  });

  it('falls back to the icon of the one package all its files lie in', () => {
    expect(iconNameOf(ICONS, area('core.ops', 'pkg/core/ops/a.ts', 'pkg/core/ops/b.ts'))).toBe('coreIcon');
  });

  it('is none for an area spanning two packages, or files in none', () => {
    expect(iconNameOf(ICONS, area('mixed', 'pkg/core/a.ts', 'pkg/geom/b.ts'))).toBeUndefined();
    expect(iconNameOf(ICONS, area('apps.site', 'apps/site/a.ts'))).toBeUndefined();
    expect(iconNameOf(ICONS, area('half', 'pkg/core/a.ts', 'apps/site/a.ts'))).toBeUndefined();
  });

  it('is none where the config names null, the package default included', () => {
    expect(iconNameOf(ICONS, area('ui.menu.items', 'pkg/ui/menu/items/a.ts'))).toBeUndefined();
  });

  it('takes the package icon from a function as well as a table', () => {
    expect(iconNameOf({ packageOf, packages: (p: string) => `${p}!` }, area('geom', 'pkg/geom/a.ts'))).toBe('geom!');
  });

  it('is none with no icons configured', () => {
    expect(iconNameOf(null, area('core', 'pkg/core/a.ts'))).toBeUndefined();
  });
});

describe('the map\'s icons', () => {
  it('give each area its icon\'s name and the glyph of each name once, leaving out icons with no glyph', () => {
    const icons = { ...ICONS, areas: { ...ICONS.areas, broken: 'missing' } };
    const { byArea, glyphs } = areaIcons(icons, [
      area('core.a', 'pkg/core/a.ts'), area('core.b', 'pkg/core/b.ts'), area('broken', 'pkg/core/c.ts'), area('mixed', 'pkg/core/a.ts', 'pkg/ui/a.ts'),
    ]);
    expect(Object.fromEntries(byArea)).toEqual({ 'core.a': 'coreIcon', 'core.b': 'coreIcon' });
    expect(glyphs).toEqual({ coreIcon: '<path d="M 0 0 L 8 0"/>' });
  });

  it('read a config\'s icons answered by a function of the project root', () => {
    expect(iconsFor({ icons: ({ root }: { root: string }) => ({ areas: { x: root } }) }, '/repo')).toEqual({ areas: { x: '/repo' } });
    expect(iconsFor({ icons: null }, '/repo')).toBeNull();
  });
});
