/**
 * Defects a person has flagged for repair: a fix run's verdict on them is not to be trusted (a "not a defect" its own
 * evidence contradicts, say), so they go back to a fixer. Kept in `<state>/scour/flags.json` as `{ area: [ids] }`;
 * `skulkr scour flag <area> <ids…> [--clear]` writes it, and the Scour page shows each as `flagged for repair`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { scourStateDirOf } from './scourPaths.mjs';

export const FLAGGED = 'flagged for repair';

const flagsPathOf = (cfg) => join(scourStateDirOf(cfg), 'flags.json');

/** Every area's flagged defect ids, `{}` before any flag. */
export const scourFlagsOf = (cfg) => {
  const path = flagsPathOf(cfg);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
};

/** `flags` with `ids` flagged on `area`, or unflagged with `clear`; an area left with none is dropped. */
export const withFlags = (flags, area, ids, clear = false) => {
  const kept = new Set(flags[area] ?? []);
  for (const id of ids) (clear ? kept.delete(id) : kept.add(id));
  const next = { ...flags };
  if (kept.size) next[area] = [...kept].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  else delete next[area];
  return next;
};

/** `skulkr scour flag <area> <ids…> [--clear]`: flags (or clears) `ids` on `area`'s ledger. Answers its flagged ids. */
export const flagDefects = (cfg, ledger, ids, clear, say) => {
  const known = new Set(ledger.defects.map((d) => d.id));
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length) throw new Error(`${ledger.area} has no defect ${unknown.join(', ')}`);
  const next = withFlags(scourFlagsOf(cfg), ledger.area, ids, clear);
  const path = flagsPathOf(cfg);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(next, null, 1)}\n`);
  const now = next[ledger.area] ?? [];
  say(`${ledger.area}: ${now.length ? `${now.join(' ')} ${FLAGGED}` : `nothing ${FLAGGED}`}`);
  return now;
};
