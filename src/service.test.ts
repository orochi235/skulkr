import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveConfig } from './config.mjs';
import { createTenant, lastLineOf, registryTenants } from './service.mjs';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'skulkr-service-'));
  dirs.push(dir);
  return dir;
};

describe('lastLineOf', () => {
  it('reads a night log\'s last line from its tail, and nothing from a log that is not there', () => {
    const dir = tmp();
    const log = join(dir, 'night.log');
    writeFileSync(log, `${'x'.repeat(10_000)}\nfirst\nlast\n`);
    expect(lastLineOf(log)).toBe('last');
    expect(lastLineOf(join(dir, 'none.log'))).toBeUndefined();
  });
});

describe('a tenant starting a run', () => {
  it('records nothing, and idles its continuous mode, when the run cannot be spawned', async () => {
    const dir = tmp();
    const cfg = resolveConfig({ name: 'p', state: join(dir, 'state'), root: join(dir, 'gone'), budget: { nightUsd: 100 } });
    const t = createTenant('p', cfg);
    t.setContinuous(true, new Date());
    t.deps.start([], { continuous: true });
    await new Promise((done) => setTimeout(done, 200));
    expect(t.running()).toBe(false);
    expect(t.lastStarted()).toBeUndefined();
    expect(t.continuous(new Date()).next).toMatchObject({ start: false, why: expect.stringContaining('found nothing to do or failed') });
  });
});

describe('the registry\'s tenants', () => {
  it('reload an edited config, keep what the tenant started, and forget a tenant no longer registered', async () => {
    const dir = tmp();
    const config = join(dir, 'skulkr.config.mjs');
    const write = (startAt: string, at: number) => {
      writeFileSync(config, `export default { name: 'p', root: ${JSON.stringify(dir)}, state: ${JSON.stringify(join(dir, 'state'))}, schedule: { startAt: '${startAt}' } };`);
      utimesSync(config, at, at);
    };
    const registry = join(dir, 'tenants.json');
    writeFileSync(registry, JSON.stringify([{ name: 'p', config }]));
    write('21:00', 1_000_000);
    const source = registryTenants(registry);
    await source.refresh();
    const first = source.current()[0];
    expect(first.startAt).toBe('21:00');
    first.runtime.children.set(4242, { lastLine: 'x' });
    await source.refresh();
    expect(source.current()[0]).toBe(first);
    write('22:30', 2_000_000);
    await source.refresh();
    const second = source.current()[0];
    expect(second.startAt).toBe('22:30');
    expect(second.running()).toBe(true);
    writeFileSync(registry, '[]');
    await source.refresh();
    expect(source.current()).toEqual([]);
    writeFileSync(registry, JSON.stringify([{ name: 'p', config }]));
    await source.refresh();
    expect(source.current()[0].running()).toBe(false);
  });
});

describe('skulkr service', () => {
  it('answers a request line that is not an object with an error, and keeps serving', () => {
    const dir = tmp();
    const config = join(dir, 'skulkr.config.mjs');
    writeFileSync(config, `export default { name: 'p', state: ${JSON.stringify(join(dir, 'state'))} };\n`);
    const bin = fileURLToPath(new URL('../bin/skulkr.mjs', import.meta.url));
    const out = spawnSync(process.execPath, [bin, 'service', '--config', config, '--root', dir], {
      input: 'null\n[1]\n7\n{"id":2,"ping":true}\n',
      encoding: 'utf8',
      timeout: 20_000,
      env: { ...process.env, SKULKR_TENANTS: join(dir, 'tenants.json'), SKULKR_FLEET: join(dir, 'fleet') },
    });
    const replies = out.stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l));
    expect(replies).toEqual([
      { error: 'not a JSON object' },
      { error: 'not a JSON object' },
      { error: 'not a JSON object' },
      expect.objectContaining({ id: 2, pong: true }),
    ]);
    expect(out.status).toBe(0);
  });
});

describe('the registry\'s tenants, refreshed twice at once', () => {
  it('load a new entry once, so its tenant and its runs are one', async () => {
    const dir = tmp();
    const config = join(dir, 'skulkr.config.mjs');
    writeFileSync(config, `export default { name: 'p', root: ${JSON.stringify(dir)}, state: ${JSON.stringify(join(dir, 'state'))} };`);
    const registry = join(dir, 'tenants.json');
    writeFileSync(registry, JSON.stringify([{ name: 'p', config }]));
    const source = registryTenants(registry);
    const logged: string[] = [];
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((line) => (logged.push(String(line)), true));
    try {
      await Promise.all([source.refresh(), source.refresh()]);
    } finally {
      spy.mockRestore();
    }
    expect(logged.filter((l) => l.includes('tenants: hosting p'))).toHaveLength(1);
    const first = source.current()[0];
    first.runtime.children.set(4242, { lastLine: 'x' });
    await source.refresh();
    expect(source.current()[0].running()).toBe(true);
  });
});
