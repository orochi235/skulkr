import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { GateFailures } from './GateFailures';

afterEach(cleanup);

describe('GateFailures', () => {
  it('turns a failed capstone run\'s label into a button that opens what failed', () => {
    render(<GateFailures label="fleet tests · 3 failed in 2 files" run="fleet tests" failures={{
      count: 3, files: 2, names: ['a.test.ts', 'b.test.ts'],
      list: [{ file: 'a.test.ts', count: 2, tests: [{ test: 'x > one', error: 'AssertionError: expected 1 to be 2' }, { test: 'x > two', error: '' }] }, { file: 'b.test.ts', count: 1, tests: [] }],
    }} />);
    const button = screen.getByRole('button', { name: 'What fleet tests failed' });
    expect(button.textContent).toBe('fleet tests · 3 failed in 2 files');
    // Opening it is checked in a browser: React Aria's popover does not open under jsdom.
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });
});
