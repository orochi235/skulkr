/** Reading a file as text, and quoting text for a shell: the two small helpers the job modules share. */
import { existsSync, readFileSync } from 'node:fs';

/** The file at `path` as text, or '' when there is none. */
export const readIf = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : '');

/** `s` single-quoted for a POSIX shell. */
export const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
