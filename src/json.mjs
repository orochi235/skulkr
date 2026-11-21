/** JSON files that several processes read and write: a reader never sees half of one. */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** What the JSON file at `path` holds, or `undefined` when it is gone, half-written or unreadable. */
export const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
};

/**
 * Writes `value` to `path` as JSON (indented by `space`, if given) by writing beside it and renaming. The temporary name
 * carries the pid, so two processes writing one file never rename each other's half-written copy.
 */
export const writeJson = (path, value, space) => {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, space)}\n`);
  renameSync(tmp, path);
};
