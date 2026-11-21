import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { icons, packageIconsIn } from './icons.mjs';

const RELEASE_ICONS = `
export const PACKAGE_ICONS: Readonly<Record<string, IconRef>> = {
  core: icon('core'),
  'diagram-elk': icon('diagramElk'),
  editing: icon('editing:select'),
};

export const TAG_ICONS: Readonly<Record<Tag, IconRef>> = {
  fix: icon('fix'),
};
`;

let root: string | undefined;
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

const table = (at: string, namespace: string, bodies: Record<string, string>) => {
  mkdirSync(join(root!, at), { recursive: true });
  const glyphs = Object.fromEntries(Object.entries(bodies).map(([k, body]) => [k, { body, group: 'G', tags: [] }]));
  writeFileSync(join(root!, at, 'icons.table.json'), JSON.stringify({ namespace, owner: '@x', icons: glyphs }));
};

describe("weasel's area icons", () => {
  it("read PACKAGE_ICONS and nothing after it, a bare name in the site's namespace", () => {
    expect(packageIconsIn(RELEASE_ICONS, 'site')).toEqual({ core: 'site:core', 'diagram-elk': 'site:diagramElk', editing: 'editing:select' });
  });

  it("give a package's areas its badge, drawn from the icon tables in the checkout", () => {
    root = mkdtempSync(join(tmpdir(), 'skulkr-icons-'));
    table('apps/site', 'site', { core: '<circle cx="10" cy="10" r="4"/>' });
    table('packages/editing/src', 'editing', { select: '<path d="M 4 4 L 16 16"/>' });
    writeFileSync(join(root, 'apps/site/releaseIcons.ts'), RELEASE_ICONS);
    const spec = icons({ root });
    expect(spec.packageOf('packages/editing/src/tools/a.ts')).toBe('editing');
    expect(spec.packageOf('apps/draw/src/a.ts')).toBeNull();
    expect(spec.packages).toMatchObject({ core: 'site:core', editing: 'editing:select' });
    expect(spec.glyph('site:core')).toBe('<circle cx="10" cy="10" r="4"/>');
    expect(spec.glyph('editing:select')).toBe('<path d="M 4 4 L 16 16"/>');
    expect(spec.glyph('site:diagramElk')).toBeUndefined();
  });
});
