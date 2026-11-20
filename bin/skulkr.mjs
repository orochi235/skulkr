#!/usr/bin/env node
/**
 * skulk's one command. Every subcommand reads the project's config (`--config <file>`, or `--tenant <name>` for a
 * registered tenant's, else `SKULK_CONFIG`, else `skulk.config.mjs` in `--root`, `SKULK_ROOT` or the working
 * directory). README.md says what each does.
 *
 *   skulk night [flags]        one run (a round); `--dry` prints its plan
 *   skulk partition [--ref R]  rewrites the partition file
 *   skulk map [--out FILE]     the dashboard's JSON
 *   skulk defects <area>       one area's defects, every round's, as JSON
 *   skulk service              the long-running service (requests on stdin): the config's project, or with
 *                              none named, every registered tenant
 *   skulk config               the resolved config, as JSON
 *   skulk tenants ls [--json]  the registered tenants
 *   skulk tenants add <config> [--name n] [--read-only]
 *   skulk tenants rm <name>
 */
import { mainCheckout } from '../src/batch.mjs';
import { exitAfterFlush } from '../src/exit.mjs';
import { loadConfig } from '../src/config.mjs';
import { areaDefects } from '../src/defects.mjs';
import { mapCommand } from '../src/map.mjs';
import { runNight } from '../src/night.mjs';
import { partitionCommand } from '../src/partition.mjs';
import { loadRunner } from '../src/runner/index.mjs';
import { serve } from '../src/service.mjs';
import { addTenant, readTenants, removeTenant, requireTenant, tenantsPath } from '../src/tenants.mjs';

const USAGE = 'usage: skulk <night|partition|map|defects|service|config|tenants> [--config <file> | --tenant <name>] [--root <dir>] …';

/** `argv` less `--config`, `--tenant` and `--root` and their values, and those values. */
const takeOptions = (argv) => {
  const rest = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--config' || argv[i] === '--root' || argv[i] === '--tenant') opts[argv[i].slice(2)] = argv[++i];
    else rest.push(argv[i]);
  }
  if (opts.tenant !== undefined) {
    if (opts.config !== undefined) throw new Error('--tenant and --config both name a config; pass one');
    opts.config = requireTenant(opts.tenant).config;
  }
  return { opts, rest };
};

/** `skulk tenants ls|add|rm`. */
const tenantsCommand = async ([verb, ...args]) => {
  const flag = (name) => {
    const at = args.indexOf(name);
    return at >= 0 ? args.splice(at, 2)[1] : undefined;
  };
  if (verb === 'ls' || verb === undefined) {
    const list = readTenants();
    if (args.includes('--json')) console.log(JSON.stringify(list));
    else if (!list.length) console.log(`no tenants registered (${tenantsPath()})`);
    else for (const t of list) console.log(`${t.name}\t${t.config}${t.readOnly ? '\tread-only' : ''}`);
    return 0;
  }
  if (verb === 'add') {
    const name = flag('--name');
    const readOnly = args.includes('--read-only');
    const config = args.find((a) => !a.startsWith('--'));
    if (!config) throw new Error('usage: skulk tenants add <config> [--name n] [--read-only]');
    const cfg = await loadConfig({ config });
    const entry = addTenant({ name: name ?? cfg.name, config: cfg.file, readOnly });
    console.log(`added ${entry.name}: ${entry.config}${entry.readOnly ? ' (read-only)' : ''}`);
    return 0;
  }
  if (verb === 'rm') {
    if (!args[0]) throw new Error('usage: skulk tenants rm <name>');
    removeTenant(args[0]);
    console.log(`removed ${args[0]}`);
    return 0;
  }
  throw new Error('usage: skulk tenants <ls|add|rm>');
};

/** Whether `skulk service` hosts the registry: no config named and at least one tenant registered. */
const hostsRegistry = (opts) => opts.config === undefined && opts.root === undefined && !process.env.SKULK_CONFIG && readTenants().length > 0;

const main = async () => {
  const [command, ...args] = process.argv.slice(2);
  const { opts, rest } = takeOptions(args);
  if (!command || command === '--help' || command === '-h') {
    console.log(USAGE);
    return 0;
  }
  if (command === 'tenants') return tenantsCommand(rest);
  if (command === 'service' && hostsRegistry(opts)) {
    await serve(null);
    return undefined;
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
      await serve(cfg);
      return undefined;
    default:
      console.error(USAGE);
      return 2;
  }
};

main().then(
  (code) => {
    if (code !== undefined) exitAfterFlush(code);
  },
  (error) => {
    console.error(`skulk: ${error.stack ?? error}`);
    exitAfterFlush(1);
  },
);
