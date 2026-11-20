/** The runner a config names: `'onto'`, a module exporting `createRunner(cfg)`, or an object with the interface itself. */
import { pathToFileURL } from 'node:url';
import { fromConfig } from '../config.mjs';
import { createOntoRunner } from './onto.mjs';

const METHODS = ['run', 'unavailableNodes', 'jobs'];

const check = (runner, what) => {
  const missing = METHODS.filter((m) => typeof runner?.[m] !== 'function');
  if (missing.length) throw new Error(`runner ${what} lacks ${missing.join(', ')}; see src/runner/onto.mjs for the interface`);
  return runner;
};

export const loadRunner = async (cfg) => {
  const r = cfg.runner;
  if (r === 'onto' || r === undefined) return createOntoRunner(cfg);
  if (typeof r === 'string') {
    const mod = await import(pathToFileURL(fromConfig(cfg, r)).href);
    return check(await mod.createRunner(cfg), r);
  }
  return check(r, 'from the config');
};
