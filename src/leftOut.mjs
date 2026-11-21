/**
 * The branches a batch left out because they would not merge, kept in the state directory so the next round's batch
 * tries them again. An entry goes once `main` holds its branch or the branch is gone.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const fileIn = (state) => join(state, 'left-out.json');

const holds = (git, ...args) => {
  try {
    git(...args);
    return true;
  } catch {
    return false;
  }
};

/**
 * Why a batch left a branch out (`makeBatch`'s `conflicted` or `failed` entry), in a phrase fit for a table cell.
 * @param {{ paths?: string[], error?: string }} out
 */
export const leftOutWhy = ({ paths, error }) => {
  const text = paths
    ? `merge conflict in ${paths.slice(0, 5).join(', ')}${paths.length > 5 ? `, and ${paths.length - 5} more` : ''}`
    : `merge failed: ${error}`;
  return text.replaceAll('|', '\\|');
};

/** Every recorded entry, `{ branch, round, why }`. */
export const leftOutIn = (state) => {
  try {
    return JSON.parse(readFileSync(fileIn(state), 'utf8')).branches ?? [];
  } catch {
    return [];
  }
};

/** The entries whose branch still exists and is not yet in `main`. */
export const retryable = (git, entries, main) =>
  entries.filter((e) => holds(git, 'rev-parse', '--verify', '--quiet', `refs/heads/${e.branch}`)
    && !holds(git, 'merge-base', '--is-ancestor', e.branch, main));

/** Records `left` beside what the file held, keeping only `retryable` entries. Answers what it kept. */
export const recordLeftOut = (state, git, main, left) => {
  const byBranch = new Map(leftOutIn(state).map((e) => [e.branch, e]));
  for (const e of left) byBranch.set(e.branch, e);
  const kept = retryable(git, [...byBranch.values()], main);
  mkdirSync(state, { recursive: true });
  writeFileSync(fileIn(state), `${JSON.stringify({ branches: kept }, null, 1)}\n`);
  return kept;
};
