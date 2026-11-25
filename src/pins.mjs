/**
 * Pins: areas the user forces into every round's picks until they settle, kept in `<state>/pins.json` as a list of
 * area ids. README.md, "Which areas", is its documentation.
 */
import { join } from 'node:path';
import { readJson, writeJson } from './json.mjs';

export const pinsPath = (cfg) => join(cfg.state, 'pins.json');

/** The pinned area ids, read fresh each call; empty when the file is missing or garbled. */
export const pinsOf = (cfg) => {
  const list = readJson(pinsPath(cfg));
  return new Set(Array.isArray(list) ? list.filter((id) => typeof id === 'string') : []);
};

const writePins = (cfg, pins) => writeJson(pinsPath(cfg), [...pins].sort(), 1);

/** Pins `id`; answers whether it was not pinned already. */
export const pin = (cfg, id) => {
  const pins = pinsOf(cfg);
  if (pins.has(id)) return false;
  pins.add(id);
  writePins(cfg, pins);
  return true;
};

/** Unpins `id`; answers whether it was pinned. */
export const unpin = (cfg, id) => {
  const pins = pinsOf(cfg);
  if (!pins.delete(id)) return false;
  writePins(cfg, pins);
  return true;
};
