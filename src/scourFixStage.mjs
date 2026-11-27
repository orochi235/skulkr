/**
 * Where each defect of a fix batch out now stands, read from the batch's job directory, for the Scour page's shelf:
 * `analyzing` until the fixer names it, `writing` from then until a commit for it, `written` after, `checking` while
 * its commits verify, and `repairing` while a repair job works on a failure laid at them (`scourFixLay.mjs`).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { newestLogIn } from './delveLive.mjs';
import { layPathFor } from './scourFixLay.mjs';

const VERIFYING = 'skulkr: verifying the fixer';
/** A fixer's commit line, with the defects its `Defect:` trailer names where it has one (`progress.mjs`). */
const COMMIT = /^skulkr: (?:commit \d+\/\d+|fixup commit)(?: for ((?:D\d+ ?)+))?/;

/**
 * Each of `ids`' stage from a fixer's log `text`. A commit line naming defects closes those; one naming none closes the
 * defect the fixer's `says:` lines last took up. Once a verify runs (`verifying`, or its line in the log), each
 * committed defect is `checking` and the rest keep their stage; where no commit named a defect, every one is.
 */
export const stagesFromFixLog = (text, ids, { verifying = false } = {}) => {
  const lines = String(text).split('\n');
  // Trailers, where any commit has one, are the whole account of what is written.
  const named = lines.some((l) => COMMIT.exec(l)?.[1]);
  const written = new Set();
  let current = null;
  let verify = verifying;
  for (const line of lines) {
    const commit = COMMIT.exec(line);
    if (line.startsWith(VERIFYING)) verify = true;
    else if (commit) {
      const of = commit[1]?.trim().split(' ').filter((d) => ids.includes(d)) ?? [];
      if (of.length) {
        for (const d of of) written.add(d);
        if (of.includes(current)) current = null;
      } else if (current && !named) {
        written.add(current);
        current = null;
      }
    } else if (line.startsWith('skulkr: says:')) {
      const id = (line.match(/\bD\d+\b/g) ?? []).find((d) => ids.includes(d) && !written.has(d));
      if (id && id !== current) {
        if (current && !named) written.add(current);
        current = id;
      }
    }
  }
  const own = (d) => (written.has(d) ? 'written' : d === current ? 'writing' : 'analyzing');
  const checks = verify || ids.every((d) => written.has(d));
  return Object.fromEntries(ids.map((d) => [d, checks && (!named || written.has(d)) ? 'checking' : own(d)]));
};

/** The defects repair `label`'s failure is laid at, from beside its log in `dir`; null where none could be said. */
const laidIn = (dir, label) => {
  try {
    return JSON.parse(readFileSync(layPathFor(dir, label), 'utf8')).defects ?? null;
  } catch {
    return null;
  }
};

/** Each of `ids`' stage in the batch whose job directory is `dir`, from the step its newest log is for. */
export const fixStagesIn = (dir, ids) => {
  const all = (stage) => Object.fromEntries(ids.map((d) => [d, stage]));
  const newest = dir ? newestLogIn(dir) : null;
  if (!newest) return all('analyzing');
  const step = newest.f.replace(/\.log$/, '');
  const read = (f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : '');
  const fixLog = read('fix.log');
  if (step === 'fix') return stagesFromFixLog(fixLog, ids);
  const checked = stagesFromFixLog(fixLog, ids, { verifying: true });
  const repair = /^repair-(.+)$/.exec(step);
  // A repair job verifies its own commits before handing back, in its own log.
  if (!repair || read(newest.f).trimEnd().split('\n').at(-1)?.startsWith(VERIFYING)) return checked;
  const laid = laidIn(dir, repair[1]);
  if (!laid) return all('repairing');
  return Object.fromEntries(ids.map((d) => [d, laid.includes(d) ? 'repairing' : checked[d]]));
};
