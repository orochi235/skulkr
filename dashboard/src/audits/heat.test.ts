import { describe, expect, it } from 'vitest';
import { mixOf, rampAt } from './heat';

describe('mixOf', () => {
  it('mixes two oklch colors the given way toward the second, and gives null for any other form', () => {
    expect(mixOf('oklch(0.2 0.1 40)', 'oklch(1 0 40)', 0.3)).toBe('oklch(0.4400 0.0700 40.00)');
    expect(mixOf('#000', 'oklch(1 0 40)', 0.3)).toBeNull();
  });

  it('is what the ramp mixes with, falling back to the nearer stop', () => {
    expect(rampAt(['oklch(0.2 0.1 40)', 'oklch(1 0 40)'], 0.3)).toBe('oklch(0.4400 0.0700 40.00)');
    expect(rampAt(['#000', '#fff'], 0.7)).toBe('#fff');
  });
});
