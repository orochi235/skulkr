import { describe, expect, it } from 'vitest';
import { parseFindings } from '../../src/findings.mjs';
import { sweepSection } from '../../src/record.mjs';
import { findingsOf, sweep } from './sweep.mjs';

const dead = [
  { demo: 'lab-tween', path: 'apps/site/demos/TweenLabDemo.tsx', label: 'Distance', kind: 'slider', shots: ['shots/a-before.png', 'shots/a-after.png'] },
  { demo: 'lab-tween', path: 'apps/site/demos/TweenLabDemo.tsx', label: 'Steps', kind: 'slider', precondition: 'Space steps by › count' },
];

describe('the sweep’s findings', () => {
  it('read back as reviewer findings, one per dead control, citing the demo’s file', () => {
    const found = parseFindings(findingsOf(dead));
    expect(found.map((f) => f.claim)).toEqual([
      'Dead control: slider "Distance" in demo `lab-tween`',
      'Dead control: slider "Steps" in demo `lab-tween`',
    ]);
    expect(found[0].where).toBe('apps/site/demos/TweenLabDemo.tsx (demo `lab-tween`)');
    expect(found[1].body).toContain('with "Space steps by › count" operated first');
  });
});

describe('the round README’s sweep section', () => {
  it('counts the run and lists its dead controls', () => {
    const summary = { controls: 9, demos: 1, dead: 2, unsure: 0, skipped: 1, waived: 0, error: 0, loadFailures: 0, deadControls: dead };
    const text = sweepSection(sweep, { ran: true, summary, minutes: 2.04 }, '`audit38-control-sweep`').join('\n');
    expect(text).toContain('operated 9 controls in 1 demos in 2.0 min: 2 dead');
    expect(text).toContain('| `lab-tween` | Steps | slider | Space steps by › count |');
  });

  it('says why it did not run', () => {
    expect(sweepSection(sweep, { ran: false, why: 'no record came back' }).join('\n')).toContain('The control sweep did not run: no record came back.');
  });
});
