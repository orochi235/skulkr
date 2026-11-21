import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { attribute, reachOf, workspacesIn } from './attribute.mjs';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tree = (files: Record<string, string>) => {
  const root = mkdtempSync(join(tmpdir(), 'skulkr-attr-'));
  dirs.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
};
const listDir = (root: string) => (dir: string) => {
  try {
    return readdirSync(join(root, dir));
  } catch {
    return [];
  }
};

const REPO = {
  'package.json': JSON.stringify({ workspaces: ['packages/*'] }),
  'packages/core/package.json': JSON.stringify({ name: '@x/core' }),
  'packages/core/src/index.ts': "export * from './store.js';",
  'packages/core/src/store.ts': "import { order } from './order';\nexport const store = order;",
  'packages/core/src/order/index.ts': 'export const order = 1;',
  'packages/core/src/store.pbt.test.ts': "import { store } from './store.js';",
  'packages/ui/package.json': JSON.stringify({ name: '@x/ui' }),
  'packages/ui/src/Bar.browser.test.tsx': "import { store } from '@x/core/store';\nvi.mock('./theme');",
  'packages/ui/src/theme.ts': '',
};

describe('reachOf', () => {
  it('follows relative imports through `.js` specifiers and index files, and names the workspace packages imported', () => {
    const root = tree(REPO);
    const ws = workspacesIn(root, listDir(root));
    expect([...reachOf(root, 'packages/core/src/store.pbt.test.ts', ws).files].sort()).toEqual([
      'packages/core/src/order/index.ts', 'packages/core/src/store.pbt.test.ts', 'packages/core/src/store.ts',
    ]);
    const bar = reachOf(root, 'packages/ui/src/Bar.browser.test.tsx', ws);
    expect([...bar.packages]).toEqual(['packages/core']);
    expect(bar.files.has('packages/ui/src/theme.ts')).toBe(true);
  });
});

describe('attribute', () => {
  const root = () => tree(REPO);

  it('lays a failing file at the branch that changed it, or code it imports, or a package it imports', () => {
    const r = root();
    const ws = workspacesIn(r, listDir(r));
    const changed = new Map([
      ['audit9-core', new Set(['packages/core/src/order/index.ts'])],
      ['audit9-docs', new Set(['docs/x.md'])],
      ['audit9-ui', new Set(['packages/ui/src/theme.ts', 'packages/ui/src/Other.test.ts'])],
    ]);
    const got = attribute(['packages/core/src/store.pbt.test.ts', 'packages/ui/src/Other.test.ts', 'packages/ui/src/Bar.browser.test.tsx', 'apps/z.test.ts'], changed, (f: string) => reachOf(r, f, ws));
    expect(Object.fromEntries(got.byBranch)).toEqual({
      'audit9-core': ['packages/core/src/store.pbt.test.ts'],
      'audit9-ui': ['packages/ui/src/Other.test.ts', 'packages/ui/src/Bar.browser.test.tsx'],
    });
    expect(got.unattributed).toEqual(['apps/z.test.ts']);
  });

  it('falls back to a package only when no branch changed what the file reaches by path', () => {
    const r = root();
    const ws = workspacesIn(r, listDir(r));
    const changed = new Map([['audit9-core', new Set(['packages/core/src/index.ts'])]]);
    const got = attribute(['packages/ui/src/Bar.browser.test.tsx'], changed, (f: string) => reachOf(r, f, ws));
    expect(Object.fromEntries(got.byBranch)).toEqual({ 'audit9-core': ['packages/ui/src/Bar.browser.test.tsx'] });
  });
});
