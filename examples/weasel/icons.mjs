/**
 * weasel's area icons: a package's areas wear the badge its changelog entries carry, read from `PACKAGE_ICONS` in
 * `apps/site/releaseIcons.ts`, and every glyph from the icon tables `npm run gen:icons` writes, so nothing of weasel
 * is imported or built.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const RELEASE_ICONS = 'apps/site/releaseIcons.ts';
/** The site's own table: a bare name in `releaseIcons.ts` is in its namespace. */
const SITE_TABLE = 'apps/site/icons.table.json';

/** `PACKAGE_ICONS`' entries in `source`, each package's icon qualified by `own`, the namespace of a bare name. */
export const packageIconsIn = (source, own) => {
  const block = /PACKAGE_ICONS[^=]*=\s*\{([^}]*)\}/.exec(source)?.[1] ?? '';
  const out = {};
  for (const [, quoted, bare, ref] of block.matchAll(/(?:'([^']+)'|([\w-]+))\s*:\s*icon\('([^']+)'\)/g)) {
    out[quoted ?? bare] = ref.includes(':') ? ref : `${own}:${ref}`;
  }
  return out;
};

/** Every `icons.table.json` the icon generator writes in `root`, by its namespace. */
const tablesIn = (root) => {
  const tables = new Map();
  for (const top of ['packages', 'apps']) {
    const dir = join(root, top);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      for (const at of [join(dir, name, 'src', 'icons.table.json'), join(dir, name, 'icons.table.json')]) {
        if (!existsSync(at)) continue;
        const table = JSON.parse(readFileSync(at, 'utf8'));
        tables.set(table.namespace, { ...tables.get(table.namespace), ...table.icons });
      }
    }
  }
  return tables;
};

/** The config's `icons` for weasel's checkout at `root`. */
export const icons = ({ root }) => {
  const tables = tablesIn(root);
  const sourceAt = join(root, RELEASE_ICONS);
  const siteAt = join(root, SITE_TABLE);
  const own = existsSync(siteAt) ? JSON.parse(readFileSync(siteAt, 'utf8')).namespace : 'site';
  const packages = existsSync(sourceAt) ? packageIconsIn(readFileSync(sourceAt, 'utf8'), own) : {};
  return {
    areas: {},
    packageOf: (file) => /^packages\/([^/]+)\//.exec(file)?.[1] ?? null,
    packages,
    glyph: (ref) => {
      const at = ref.indexOf(':');
      return tables.get(ref.slice(0, at))?.[ref.slice(at + 1)]?.body;
    },
  };
};
