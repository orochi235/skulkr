/**
 * The tenants one skulkr host serves: a registry of projects, each by its name and the absolute path of its config,
 * in `~/.config/skulkr/tenants.json` (`SKULKR_TENANTS` overrides it). A tenant marked `readOnly` is shown and counted
 * but never started here: its rounds run under another service.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { writeJson } from './json.mjs';

/** The registry's path: `SKULKR_TENANTS`, else `~/.config/skulkr/tenants.json`. */
export const tenantsPath = (env = process.env) => env.SKULKR_TENANTS ?? join(homedir(), '.config', 'skulkr', 'tenants.json');

/** The registered tenants, `[{ name, config, readOnly? }]`; empty when there is no registry. Throws on a malformed one. */
export const readTenants = (path = tenantsPath()) => {
  if (!existsSync(path)) return [];
  const list = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(list) || list.some((t) => typeof t?.name !== 'string' || typeof t?.config !== 'string')) {
    throw new Error(`${path} is not a list of { name, config }`);
  }
  return list;
};

const writeTenants = (list, path) => writeJson(path, list, 2);

const NAME = /^[\w.-]+$/;

/**
 * Registers the config at `config` as tenant `name`, its path made absolute. Refuses a name or config already
 * registered, a name that will not sit in a URL path segment, and a config that is not there. Answers the entry.
 */
export const addTenant = ({ name, config, readOnly = false }, path = tenantsPath()) => {
  const file = isAbsolute(config) ? config : resolve(config);
  if (!NAME.test(name)) throw new Error(`a tenant's name is letters, digits, '.', '_' and '-': not ${JSON.stringify(name)}`);
  if (!existsSync(file)) throw new Error(`no config at ${file}`);
  const list = readTenants(path);
  const clash = list.find((t) => t.name === name || t.config === file);
  if (clash) throw new Error(`already registered: ${clash.name} (${clash.config})`);
  const entry = { name, config: file, ...(readOnly ? { readOnly: true } : {}) };
  writeTenants([...list, entry], path);
  return entry;
};

/** Removes tenant `name`; throws when there is none. */
export const removeTenant = (name, path = tenantsPath()) => {
  const list = readTenants(path);
  if (!list.some((t) => t.name === name)) throw new Error(`no tenant ${name}; registered: ${list.map((t) => t.name).join(', ') || 'none'}`);
  writeTenants(list.filter((t) => t.name !== name), path);
};

/** Tenant `name`'s entry; throws, naming those there are, when there is none. */
export const requireTenant = (name, path = tenantsPath()) => {
  const list = readTenants(path);
  const found = list.find((t) => t.name === name);
  if (!found) throw new Error(`no tenant ${name}; registered: ${list.map((t) => t.name).join(', ') || 'none'} (${path})`);
  return found;
};
