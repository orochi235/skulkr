/**
 * Which area branch a red capstone's failing file belongs to: the branches whose commits changed that file, or else
 * changed code it imports. Imports are followed through relative paths, and a bare one naming a workspace package
 * reaches every file of that package; a file no branch reaches is unattributed.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

/** The files each branch's own commits changed since `from`, by branch. */
export const changedBy = (git, from, branches) =>
  new Map(branches.map((b) => [b, new Set(git('log', '--no-merges', '--name-only', '--format=', `${from}..${b}`).split('\n').filter(Boolean))]));

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\b(?:vi|jest)\.mock\(\s*)['"]([^'"]+)['"]/g;
const EXTENSIONS = ['', '.ts', '.tsx', '.mts', '.mjs', '.js', '.jsx', '.cjs'];

const isFile = (path) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

/** A relative specifier from `file` resolved to a file in `tree`, as a repository path, or undefined. */
const resolveRelative = (tree, file, spec) => {
  const base = normalize(join(dirname(file), spec));
  // A `.js` specifier in TypeScript source names the `.ts` file beside it.
  const stems = [base, base.replace(/\.[cm]?js$/, '')];
  for (const stem of stems) {
    for (const ext of EXTENSIONS) if (isFile(join(tree, stem + ext))) return stem + ext;
    for (const ext of EXTENSIONS.slice(1)) if (isFile(join(tree, stem, `index${ext}`))) return join(stem, `index${ext}`);
  }
  return undefined;
};

/** The workspace packages of the repository at `tree`, `name → directory`, from its root `package.json`. */
export const workspacesIn = (tree, listDir) => {
  const root = join(tree, 'package.json');
  if (!existsSync(root)) return new Map();
  const { workspaces = [] } = JSON.parse(readFileSync(root, 'utf8'));
  const globs = Array.isArray(workspaces) ? workspaces : workspaces.packages ?? [];
  const dirs = globs.flatMap((g) => (g.endsWith('/*') ? listDir(g.slice(0, -2)).map((d) => `${g.slice(0, -2)}/${d}`) : [g]));
  return new Map(dirs.flatMap((dir) => {
    const manifest = join(tree, dir, 'package.json');
    if (!existsSync(manifest)) return [];
    const { name } = JSON.parse(readFileSync(manifest, 'utf8'));
    return name ? [[name, dir]] : [];
  }));
};

/** The package a bare specifier names: `@scope/name/sub` → `@scope/name`, `name/sub` → `name`. */
const packageOf = (spec) => spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/');

/** What `file` reaches in `tree`: the files its relative imports reach, transitively, and the workspace packages it or
 *  they import by name. */
export const reachOf = (tree, file, workspaces, { limit = 5000 } = {}) => {
  const files = new Set([file]);
  const packages = new Set();
  const queue = [file];
  while (queue.length && files.size < limit) {
    const at = queue.shift();
    let text;
    try {
      text = readFileSync(join(tree, at), 'utf8');
    } catch {
      continue;
    }
    for (const [, spec] of text.matchAll(SPECIFIER)) {
      if (spec.startsWith('.')) {
        const to = resolveRelative(tree, at, spec);
        if (to && !files.has(to)) {
          files.add(to);
          queue.push(to);
        }
      } else if (workspaces.has(packageOf(spec))) packages.add(workspaces.get(packageOf(spec)));
    }
  }
  return { files, packages };
};

/**
 * Each failing file's branches: those that changed it, else those that changed a file it reaches, else those that
 * changed a file in a workspace package it reaches. Answers `{ byBranch, unattributed }`: the failing files by branch,
 * and those no branch reaches.
 */
export const attribute = (failing, changed, reach) => {
  const byBranch = new Map();
  const unattributed = [];
  const add = (branch, file) => byBranch.set(branch, [...(byBranch.get(branch) ?? []), file]);
  for (const file of failing) {
    const touched = (test) => [...changed].filter(([, files]) => [...files].some(test)).map(([b]) => b);
    let owners = touched((f) => f === file);
    if (!owners.length) {
      const { files, packages } = reach(file);
      owners = touched((f) => files.has(f));
      if (!owners.length) owners = touched((f) => [...packages].some((dir) => f.startsWith(`${dir}/`)));
    }
    if (owners.length) for (const b of owners) add(b, file);
    else unattributed.push(file);
  }
  return { byBranch, unattributed };
};
