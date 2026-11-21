// @vitest-environment node
import type { execFile } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { SKULKR_BIN, createKeptMap, createMapBuilder, createSkulkrRunner, listTenants, tenantArgs } from './plugin';
import { parseTenantPath, tenantMapPath } from '../shared/routes';

describe('createMapBuilder', () => {
  it('shares one build among the calls made while it runs, and starts afresh after', async () => {
    let finish: (json: string) => void = () => {};
    const run = vi.fn(() => new Promise<string>((done) => { finish = done; }));
    const build = createMapBuilder(run);
    const first = build();
    const second = build();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(['map']);
    finish('{"a":1}');
    expect(await first).toBe('{"a":1}');
    expect(await second).toBe('{"a":1}');
    void build();
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe('createSkulkrRunner', () => {
  type Call = { file: string; args: readonly string[]; opts: { cwd?: string; env?: NodeJS.ProcessEnv } };
  /** An `execFile` that records each call and answers `stdout`, or fails with `stderr`. */
  function fakeExec(answer: { stdout?: string; stderr?: string; fail?: boolean }) {
    const calls: Call[] = [];
    const exec = ((file: string, args: readonly string[], opts: Call['opts'], cb: (e: Error | null, out: string, err: string) => void) => {
      calls.push({ file, args, opts });
      cb(answer.fail ? new Error('exit 1') : null, answer.stdout ?? '', answer.stderr ?? '');
    }) as unknown as typeof execFile;
    return { exec, calls };
  }

  it('runs the bin beside the dashboard in the project root, passing the environment through', async () => {
    const { exec, calls } = fakeExec({ stdout: '[]' });
    const env = { SKULKR_CONFIG: '/p/skulkr.config.mjs', SKULKR_ROOT: '/p' };
    expect(await createSkulkrRunner({ env, exec })(['defects', 'core.ops'])).toBe('[]');
    expect(SKULKR_BIN).toMatch(/\/bin\/skulkr\.mjs$/);
    expect(calls[0]).toMatchObject({ file: process.execPath, args: [SKULKR_BIN, 'defects', 'core.ops'], opts: { cwd: '/p', env } });
  });

  it("fails with the CLI's own complaint", async () => {
    const { exec } = fakeExec({ fail: true, stderr: 'no skulkr.config.mjs in /x\n' });
    await expect(createSkulkrRunner({ env: {}, cwd: '/x', exec })(['map'])).rejects.toThrow('no skulkr.config.mjs in /x');
  });
});

describe('tenants', () => {
  it('lists the registry\'s tenants, or the one project the CLI finds when none is registered', async () => {
    const answers = (registry: string) => vi.fn(async (args: readonly string[]) => (args[0] === 'tenants' ? registry : '{"name":"solo"}'));
    expect(await listTenants(answers('[{"name":"weasel","config":"/w.mjs"},{"name":"b","config":"/b.mjs"}]')))
      .toEqual([{ name: 'weasel', registered: true }, { name: 'b', registered: true }]);
    expect(await listTenants(answers('[]'))).toEqual([{ name: 'solo', registered: false }]);
  });

  it('asks the CLI for a tenant\'s map and defects by its name, and for no tenant it does not read', () => {
    const list = [{ name: 'weasel', registered: true }, { name: 'solo', registered: false }];
    expect(tenantArgs(list, 'weasel', 'map', null)).toEqual(['map', '--tenant', 'weasel']);
    expect(tenantArgs(list, 'weasel', 'area', 'core.ops')).toEqual(['defects', 'core.ops', '--tenant', 'weasel']);
    expect(tenantArgs(list, 'solo', 'map', null)).toEqual(['map']);
    expect(tenantArgs(list, 'nope', 'map', null)).toBeNull();
  });

  it('reads a tenant route back from its path', () => {
    expect(parseTenantPath(`/base/${tenantMapPath('skulkr.demo')}`)).toEqual({ tenant: 'skulkr.demo', what: 'map' });
    expect(parseTenantPath('/base/api/t/a/area')).toEqual({ tenant: 'a', what: 'area' });
    expect(parseTenantPath('/base/api/tenants')).toBeNull();
  });
});

describe('createKeptMap', () => {
  it('answers the kept map at once, rebuilds it in the background once stale, and keeps it through a failed build', async () => {
    let clock = 0;
    let n = 0;
    let fail = false;
    const build = vi.fn(async () => {
      if (fail) throw new Error('onto is down');
      n += 1;
      return `map ${n}`;
    });
    const kept = createKeptMap(build, null, { freshMs: 5_000, now: () => clock });
    const text = async () => (await kept()).text;
    expect(await text()).toBe('map 1');
    clock = 1_000;
    expect(await text()).toBe('map 1');
    expect(build).toHaveBeenCalledTimes(1);
    clock = 10_000;
    expect(await text()).toBe('map 1');
    await vi.waitFor(() => expect(build).toHaveBeenCalledTimes(2));
    expect(await text()).toBe('map 2');
    fail = true;
    clock = 20_000;
    expect(await text()).toBe('map 2');
    await vi.waitFor(() => expect(build).toHaveBeenCalledTimes(3));
    expect(await text()).toBe('map 2');
  });

  it('answers the kept map with why the builds since it failed, until one succeeds', async () => {
    let clock = 0;
    let fail = false;
    const build = vi.fn(async () => {
      if (fail) throw new Error('map.mjs crashed');
      return 'map';
    });
    const kept = createKeptMap(build, null, { freshMs: 5_000, now: () => clock });
    expect(await kept()).toEqual({ text: 'map', error: null });
    fail = true;
    clock = 10_000;
    await kept();
    await vi.waitFor(() => expect(build).toHaveBeenCalledTimes(2));
    await vi.waitFor(async () => expect(await kept()).toEqual({ text: 'map', error: 'map.mjs crashed' }));
    fail = false;
    await vi.waitFor(() => expect(build).toHaveBeenCalledTimes(3));
    await vi.waitFor(async () => expect(await kept()).toEqual({ text: 'map', error: null }));
  });

  it('starts from the copy kept on disk, and writes each fresh build there', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'skulkr-kept-'));
    const file = join(dir, 'weasel', 'map.json');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, 'map from disk');
    const kept = createKeptMap(async () => 'map fresh', file, { freshMs: 5_000, now: () => Date.now() + 60_000 });
    expect((await kept()).text).toBe('map from disk');
    await vi.waitFor(() => expect(readFileSync(file, 'utf8')).toBe('map fresh'));
    rmSync(dir, { recursive: true, force: true });
  });
});
