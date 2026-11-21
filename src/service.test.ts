import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveConfig } from './config.mjs';
import { createTenant, lastLineOf } from './service.mjs';

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
