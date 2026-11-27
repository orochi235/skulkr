import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { asksHelp, helpFor, USAGE } from './cliHelp.mjs';

describe('skulkr --help', () => {
  it("prints a command's own usage, and the whole CLI's for one it does not know", () => {
    expect(helpFor('service')).toMatch(/^usage: skulkr service /);
    expect(helpFor('sat')).toBe(helpFor('scour'));
    expect(helpFor('nonsense')).toBe(USAGE);
    expect(asksHelp(['area', '-h'])).toBe(true);
    expect(asksHelp(['area', '--hours'])).toBe(false);
  });

  it('answers a command asked for help without running it, even one that would start a server', () => {
    const out = execFileSync('node', ['bin/skulkr.mjs', 'service', '--help'], { encoding: 'utf8', timeout: 10_000, env: { ...process.env, SKULKR_TENANTS: '/nonexistent' } });
    expect(out).toMatch(/^usage: skulkr service /);
  });
});
