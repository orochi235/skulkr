import { resolveConfig } from '../src/config.mjs';
import weasel from '../examples/weasel.config.mjs';

/** weasel's example config, resolved, with `state` (a scratch directory) in place of its own. */
export const weaselConfig = (state?: string) => resolveConfig({ ...weasel, ...(state ? { state } : {}) }, { file: new URL('../examples/weasel.config.mjs', import.meta.url).pathname });
