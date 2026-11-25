/**
 * Where scour's ledgers live: `<state>/scour/` on one machine, `<record.dir>/scour/` once landed. Both were named
 * `saturation/` before 2026-11-25; the state directory's is moved on first use, and a landed one is still read there
 * until a landing of that ledger moves it.
 */
import { existsSync, readdirSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const NAME = 'scour';
const FORMER = 'saturation';

/** The state directory's ledgers. */
export const scourStateDirOf = (cfg) => join(cfg.state, NAME);

/** Moves the state directory's `saturation/` to `scour/`, once, when only the old one exists. */
export const moveFormerScourState = (cfg) => {
  const former = join(cfg.state, FORMER);
  if (existsSync(former) && !existsSync(scourStateDirOf(cfg))) renameSync(former, scourStateDirOf(cfg));
};

/** Where `ledger` lands, relative to the project's root: one directory per area and frozen commit. */
export const landedDirOf = (cfg, ledger) => `${cfg.record.dir}/${NAME}/${ledger.area}/${ledger.commit.slice(0, 10)}`;

/** Where a landing of `ledger` before the rename put it, relative to the project's root. */
export const formerLandedDirOf = (cfg, ledger) => `${cfg.record.dir}/${FORMER}/${ledger.area}/${ledger.commit.slice(0, 10)}`;

/**
 * Every landed ledger under `root`, as `{ area, short, file, ledger }`, the current directory's first; one landed under
 * both names is read from `scour/`.
 */
export const landedLedgersUnder = (cfg, root) => {
  const seen = new Set();
  return [NAME, FORMER].flatMap((name) => {
    const dir = join(root, cfg.record.dir, name);
    if (!existsSync(dir)) return [];
    return readdirSync(dir).sort().flatMap((area) => readdirSync(join(dir, area)).sort().flatMap((short) => {
      const file = join(dir, area, short, 'ledger.json');
      if (seen.has(`${area}@${short}`) || !existsSync(file)) return [];
      seen.add(`${area}@${short}`);
      return [{ area, short, file, ledger: JSON.parse(readFileSync(file, 'utf8')) }];
    }));
  });
};
