#!/usr/bin/env node
/**
 * skulkr's one command. Every subcommand reads the project's config (`--config <file>`, or `--tenant <name>` for a
 * registered tenant's, else `SKULKR_CONFIG`, else `.skulkr/config.mjs` or `skulkr.config.mjs` in `--root`, `SKULKR_ROOT` or the working
 * directory). README.md says what each does.
 *
 *   skulkr init                 writes a starter .skulkr/config.mjs for the repository here
 *   skulkr registry             writes the defect registry, .skulkr/defects/, from the record, uncommitted
 *   skulkr q <sql> [--json]     queries the index of the record, built first when stale
 *   skulkr night [flags]        one run (a round); `--dry` prints its plan
 *   skulkr partition [--ref R]  rewrites the partition file
 *   skulkr map [--out FILE] [--cached-jobs]   the dashboard's JSON
 *   skulkr fetch [--every S]    keeps the fleet listings `map --cached-jobs` reads fresh, until stdin closes
 *   skulkr defects <area>       one area's defects, every round's, as JSON
 *   skulkr pin|unpin <area>     forces an area into every round until it settles, or stops
 *   skulkr scour <area> …    repeated blind reviews of one area into a ledger, until saturated (alias `sat`)
 *   skulkr trial                the preload trials' digest (`night --trial preload` runs one)
 *   skulkr service              the long-running service (requests on stdin): the config's project, or with
 *                              none named, every registered tenant
 *   skulkr config               the resolved config, as JSON
 *   skulkr tenants ls [--json]  the registered tenants
 *   skulkr tenants add <config> [--name n] [--read-only]
 *   skulkr tenants rm <name>
 */
import { gitIn, mainCheckout } from '../src/batch.mjs';
import { exitAfterFlush, tolerateClosedOutput } from '../src/exit.mjs';
import { loadConfig } from '../src/config.mjs';
import { defectsFor } from '../src/defects.mjs';
import { fetchCommand } from '../src/fetch.mjs';
import { initCommand } from '../src/init.mjs';
import { readRegistry, writeRegistry } from '../src/registry.mjs';
import { queryIndex, rowsText } from '../src/recordIndex.mjs';
import { mapCommand } from '../src/map.mjs';
import { runNight } from '../src/night.mjs';
import { partitionAt, partitionCommand } from '../src/partition.mjs';
import { pin, pinsOf, unpin } from '../src/pins.mjs';
import { loadRunner } from '../src/runner/index.mjs';
import { createLocalRunner } from '../src/runner/local.mjs';
import { saturateCommand } from '../src/saturate.mjs';
import { serve } from '../src/service.mjs';
import { trialCommand } from '../src/trial.mjs';
import { addTenant, readTenants, removeTenant, requireTenant, tenantsPath } from '../src/tenants.mjs';

const USAGE = 'usage: skulkr <init|night|partition|map|fetch|defects|registry|q|pin|unpin|scour|trial|service|config|tenants|menu> [--config <file> | --tenant <name>] [--root <dir>] [--local] …';

/** `argv` less `--config`, `--tenant` and `--root` and their values, and those values. */
const takeOptions = (argv) => {
  const rest = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--config' || argv[i] === '--root' || argv[i] === '--tenant') opts[argv[i].slice(2)] = argv[++i];
    else if (argv[i] === '--local') opts.local = true;
    else rest.push(argv[i]);
  }
  if (opts.tenant !== undefined) {
    if (opts.config !== undefined) throw new Error('--tenant and --config both name a config; pass one');
    opts.config = requireTenant(opts.tenant).config;
  }
  return { opts, rest };
};

/** `skulkr tenants ls|add|rm`. */
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
    if (!config) throw new Error('usage: skulkr tenants add <config> [--name n] [--read-only]');
    const cfg = await loadConfig({ config });
    const entry = addTenant({ name: name ?? cfg.name, config: cfg.file, readOnly });
    console.log(`added ${entry.name}: ${entry.config}${entry.readOnly ? ' (read-only)' : ''}`);
    return 0;
  }
  if (verb === 'rm') {
    if (!args[0]) throw new Error('usage: skulkr tenants rm <name>');
    removeTenant(args[0]);
    console.log(`removed ${args[0]}`);
    return 0;
  }
  throw new Error('usage: skulkr tenants <ls|add|rm>');
};

/** `skulkr pin|unpin <area>`. An id no longer in the partition can still be unpinned. */
const pinCommand = (cfg, root, verb, id) => {
  if (!id) throw new Error(`usage: skulkr ${verb} <area>`);
  const known = verb === 'unpin' && pinsOf(cfg).has(id) || partitionAt(cfg, root, cfg.git.main).some((a) => a.id === id);
  if (!known) throw new Error(`no area named ${id}; see ${cfg.partition.path}`);
  const changed = verb === 'pin' ? pin(cfg, id) : unpin(cfg, id);
  console.log(changed ? `${verb}ned ${id}` : `${id} was ${verb === 'pin' ? 'already' : 'not'} pinned`);
};

/** Whether `skulkr service` hosts the registry: no config named and at least one tenant registered. */
const hostsRegistry = (opts) => opts.config === undefined && opts.root === undefined && !process.env.SKULKR_CONFIG && readTenants().length > 0;

const main = async () => {
  const [command, ...args] = process.argv.slice(2);
  const { opts, rest } = takeOptions(args);
  if (!command || command === '--help' || command === '-h') {
    console.log(USAGE);
    return 0;
  }
  if (command === 'tenants') return tenantsCommand(rest);
  if (command === 'menu') {
    const { menuCommand } = await import('../src/menu.mjs');
    console.log(JSON.stringify(menuCommand()));
    return 0;
  }
  if (command === 'init') {
    const path = initCommand();
    console.log(`wrote ${path}; check its guesses, then run \`skulkr partition\` and \`skulkr night --dry\``);
    return 0;
  }
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
      tolerateClosedOutput();
      await runNight(cfg, await loadRunner(cfg), rest);
      return 0;
    case 'partition':
      partitionCommand(cfg, root(), rest);
      return 0;
    case 'map':
      mapCommand(cfg, root(), await loadRunner(cfg, { cached: rest.includes('--cached-jobs') }), rest);
      return 0;
    case 'fetch':
      await fetchCommand(cfg, await loadRunner(cfg), rest);
      return 0;
    case 'defects':
      process.stdout.write(`${JSON.stringify(defectsFor(cfg, root(), rest[0] ?? ''))}\n`);
      return 0;
    case 'registry': {
      const at = root();
      const dir = writeRegistry(cfg, gitIn(at), at);
      const counts = new Map();
      for (const e of readRegistry(cfg, at)) counts.set(e.status, (counts.get(e.status) ?? 0) + 1);
      console.log(`wrote ${dir}: ${[...counts].sort((x, y) => y[1] - x[1]).map(([k, n]) => `${n} ${k}`).join(', ')}`);
      return 0;
    }
    case 'q': {
      const sql = rest.filter((a) => a !== '--json').join(' ');
      if (!sql) throw new Error('usage: skulkr q <sql> [--json]');
      const at = root();
      const rows = queryIndex(cfg, gitIn(at), at, sql);
      if (rest.includes('--json')) console.log(JSON.stringify(rows));
      else for (const line of rowsText(rows)) console.log(line);
      return 0;
    }
    case 'pin':
    case 'unpin':
      pinCommand(cfg, root(), command, rest[0]);
      return 0;
    case 'scour':
    case 'saturate':
    case 'sat':
      tolerateClosedOutput();
      {
        // Fleet mode bills each node's signed-in account; otherwise Claude's passes are the running session's subagents.
        const fleet = rest.includes('--fleet');
        await saturateCommand(cfg, fleet ? await loadRunner(cfg) : createLocalRunner(cfg), root(), rest.filter((a) => a !== '--fleet'), undefined, { fleet });
      }
      return 0;
    case 'trial':
      trialCommand(cfg);
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
    console.error(`skulkr: ${error.stack ?? error}`);
    exitAfterFlush(1);
  },
);
