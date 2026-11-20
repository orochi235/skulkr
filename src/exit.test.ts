import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const EXIT = new URL('./exit.mjs', import.meta.url).pathname;

describe('exitAfterFlush', () => {
  it('lets a write far past a pipe buffer reach the reader before the process exits', () => {
    const script = `import { exitAfterFlush } from ${JSON.stringify(EXIT)}; process.stdout.write('x'.repeat(1 << 20)); exitAfterFlush(0);`;
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', maxBuffer: 4 << 20 });
    expect(out.length).toBe(1 << 20);
  });
});
