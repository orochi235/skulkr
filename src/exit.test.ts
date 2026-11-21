import { execFileSync, spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const EXIT = new URL('./exit.mjs', import.meta.url).pathname;

describe('exitAfterFlush', () => {
  it('lets a write far past a pipe buffer reach the reader before the process exits', () => {
    const script = `import { exitAfterFlush } from ${JSON.stringify(EXIT)}; process.stdout.write('x'.repeat(1 << 20)); exitAfterFlush(0);`;
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', maxBuffer: 4 << 20 });
    expect(out.length).toBe(1 << 20);
  });
});

describe('tolerateClosedOutput', () => {
  it('keeps a process writing to a stdout and stderr nobody reads any more alive', async () => {
    const script = `import { exitAfterFlush, tolerateClosedOutput } from ${JSON.stringify(EXIT)};
      tolerateClosedOutput();
      setTimeout(() => {
        for (let i = 0; i < 5; i++) { process.stdout.write('x\\n'); process.stderr.write('y\\n'); }
        setTimeout(() => exitAfterFlush(7), 300);
      }, 300);`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    child.stdout.destroy();
    child.stderr.destroy();
    const code = await new Promise((done) => child.on('exit', done));
    expect(code).toBe(7);
  });
});
