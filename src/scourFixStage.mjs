/**
 * Where each defect of a fix batch out now stands, read from the batch's job directory, for the Scour page's shelf:
 * `analyzing` until the fixer names it, `writing` from then until its next commit, `written` after, `checking` once
 * every defect is written or a verify runs, and `repairing` while a repair job does.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { newestLogIn } from './delveLive.mjs';

const VERIFYING = 'skulkr: verifying the fixer';

/** Each of `ids`' stage from a fixer's log `text`: the fixer's `says:` lines name the defect it takes up, and the
 *  `commit` line after closes it. */
export const stagesFromFixLog = (text, ids) => {
  const written = new Set();
  let current = null;
  let verifying = false;
  for (const line of String(text).split('\n')) {
    if (line.startsWith(VERIFYING)) verifying = true;
    else if (/^skulkr: commit \d+/.test(line)) {
      if (current) written.add(current);
      current = null;
    } else if (line.startsWith('skulkr: says:')) {
      const id = (line.match(/\bD\d+\b/g) ?? []).find((d) => ids.includes(d) && !written.has(d));
      if (id && id !== current) {
        if (current) written.add(current);
        current = id;
      }
    }
  }
  const checking = verifying || ids.every((d) => written.has(d));
  return Object.fromEntries(ids.map((d) => [d, checking ? 'checking' : written.has(d) ? 'written' : d === current ? 'writing' : 'analyzing']));
};

/** Each of `ids`' stage in the batch whose job directory is `dir`, from the step its newest log is for. */
export const fixStagesIn = (dir, ids) => {
  const all = (stage) => Object.fromEntries(ids.map((d) => [d, stage]));
  const newest = dir ? newestLogIn(dir) : null;
  if (!newest) return all('analyzing');
  const step = newest.f.replace(/\.log$/, '');
  if (step.startsWith('verify')) return all('checking');
  const text = newest.size ? readFileSync(join(dir, newest.f), 'utf8') : '';
  // A repair job verifies its own commits before handing back, in its own log.
  if (step.startsWith('repair')) return all(text.trimEnd().split('\n').at(-1)?.startsWith(VERIFYING) ? 'checking' : 'repairing');
  return stagesFromFixLog(text, ids);
};
