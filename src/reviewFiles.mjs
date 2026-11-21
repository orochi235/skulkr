/** The reviewer brief's `{{files}}`: each of an area's files with its line count, and whether it changed this week. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gitIn } from './batch.mjs';

const WEEK_MS = 7 * 24 * 3_600_000;
export const RECENT_MARK = 'changed this week';

/** Lines in the file at `path`, or undefined when it cannot be read. */
const linesIn = (path) => {
  try {
    const text = readFileSync(path, 'utf8');
    return text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
  } catch {
    return undefined;
  }
};

/** The files of `files` a commit reachable from the checkout at `root`'s HEAD changed in the week before `now`. */
export const recentlyChanged = (root, files, now = new Date()) => {
  if (!files.length) return new Set();
  try {
    const out = gitIn(root)('log', `--since=${new Date(now.getTime() - WEEK_MS).toISOString()}`, '--format=', '--name-only', 'HEAD', '--', ...files);
    return new Set(out.split('\n').filter(Boolean));
  } catch {
    return new Set();
  }
};

/** One `- path (N lines)` per file of `files`, counted in the tree at `root`, those in `recent` marked {@link RECENT_MARK}. */
export const reviewFileList = (root, files, recent = new Set()) => files.map((f) => {
  const n = linesIn(join(root, f));
  const notes = [...(n === undefined ? [] : [`${n} ${n === 1 ? 'line' : 'lines'}`]), ...(recent.has(f) ? [RECENT_MARK] : [])];
  return notes.length ? `- ${f} (${notes.join(', ')})` : `- ${f}`;
}).join('\n');
