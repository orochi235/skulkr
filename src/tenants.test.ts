import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { addTenant, readTenants, removeTenant, requireTenant, tenantsPath } from './tenants.mjs';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), 'skulk-tenants-'));
  dirs.push(dir);
  const config = join(dir, 'skulk.config.mjs');
  writeFileSync(config, 'export default { name: "p" };\n');
  return { dir, config, registry: join(dir, 'conf', 'tenants.json') };
};

describe('the tenant registry', () => {
  it('lives at SKULK_TENANTS when set', () => {
    expect(tenantsPath({ SKULK_TENANTS: '/x/t.json' })).toBe('/x/t.json');
    expect(tenantsPath({})).toMatch(/\.config\/skulk\/tenants\.json$/);
  });

  it('adds, finds and removes tenants by name, each config once', () => {
    const { config, registry } = scratch();
    expect(readTenants(registry)).toEqual([]);
    expect(addTenant({ name: 'p', config }, registry)).toEqual({ name: 'p', config });
    const other = scratch();
    expect(addTenant({ name: 'q', config: other.config, readOnly: true }, registry)).toEqual({ name: 'q', config: other.config, readOnly: true });
    removeTenant('q', registry);
    expect(() => addTenant({ name: 'p2', config }, registry)).toThrow('already registered: p');
    expect(() => addTenant({ name: 'a/b', config }, registry)).toThrow("a tenant's name");
    expect(() => addTenant({ name: 'z', config: '/nowhere.mjs' }, registry)).toThrow('no config at /nowhere.mjs');
    expect(requireTenant('p', registry).config).toBe(config);
    expect(() => requireTenant('nope', registry)).toThrow('no tenant nope; registered: p');
    removeTenant('p', registry);
    expect(readTenants(registry)).toEqual([]);
    expect(() => removeTenant('p', registry)).toThrow('no tenant p');
  });

  it('refuses a registry that is not a list of tenants', () => {
    const { registry, dir } = scratch();
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, '{"name":"p"}');
    expect(() => readTenants(bad)).toThrow('is not a list');
    expect(readTenants(registry)).toEqual([]);
  });
});
