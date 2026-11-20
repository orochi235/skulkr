#!/usr/bin/env node
/**
 * skulk's one command. Every subcommand reads the project's config (`--config <file>`, else `SKULK_CONFIG`, else
 * `skulk.config.mjs` in `--root`, `SKULK_ROOT` or the working directory). README.md says what each does.
 *
 *   skulk night [flags]        one run (a round); `--dry` prints its plan
 *   skulk partition [--ref R]  rewrites the partition file
 *   skulk map [--out FILE]     the dashboard's JSON
 *   skulk defects <area>       one area's defects, every round's, as JSON
 *   skulk service              the long-running service (requests on stdin)
 *   skulk config               the resolved config, as JSON
 */
import { mainCheckout } from '../src/batch.mjs';
import { loadConfig } from '../src/config.mjs';
import { areaDefects } from '../src/defects.mjs';
import { mapCommand } from '../src/map.mjs';
import { runNight } from '../src/night.mjs';
import { partitionCommand } from '../src/partition.mjs';
import { loadRunner } from '../src/runner/index.mjs';
import { serve } from '../src/service.mjs';

const USAGE = 'usage: skulk <night|partition|map|defects|service|config> [--config <file>] [--root <dir>] …';

/** `argv` less `--config` and `--root` and their values, and those two values. */
const takeOptions = (argv) => {
  const rest = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--config' || argv[i] === '--root') opts[argv[i].slice(2)] = argv[++i];
    else rest.push(argv[i]);
  }
  return { opts, rest };
};

const main = async () => {
  const [command, ...args] = process.argv.slice(2);
  const { opts, rest } = takeOptions(args);
  if (!command || command === '--help' || command === '-h') {
    console.log(USAGE);
    return 0;
  }
  const cfg = await loadConfig(opts);
  if (command === 'config') {
    console.log(JSON.stringify(cfg, (k, v) => (v instanceof RegExp ? String(v) : typeof v === 'function' ? '[function]' : v), 1));
    return 0;
  }
  const root = () => mainCheckout(cfg);
  switch (command) {
    case 'night':
      await runNight(cfg, await loadRunner(cfg), rest);
      return 0;
    case 'partition':
      partitionCommand(cfg, root(), rest);
      return 0;
    case 'map':
      mapCommand(cfg, root(), await loadRunner(cfg), rest);
      return 0;
    case 'defects':
      process.stdout.write(`${JSON.stringify(areaDefects(root(), rest[0] ?? '', cfg.state, cfg.record.dir))}\n`);
      return 0;
    case 'service':
      serve(cfg);
      return undefined;
    default:
      console.error(USAGE);
      return 2;
  }
};

main().then(
  (code) => {
    if (code !== undefined) process.exit(code);
  },
  (error) => {
    console.error(`skulk: ${error.stack ?? error}`);
    process.exit(1);
  },
);
