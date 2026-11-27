import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DelveChart, spanOf, stacksOf } from './DelveChart';
import type { SaturationLedger } from './saturation.types';

const defect = (id: string, seenAt: number[]) => ({
  id, claim: `claim ${id}`, where: 'x.ts:1', severity: '', sightings: seenAt.length, seenAt, firstOccasion: seenAt[0] ?? null, sources: ['claude'], onlyBy: null, registry: null,
});

const defects = [defect('D2', [3]), defect('D1', [1, 2, 3]), defect('D3', [2])];
const ledger: SaturationLedger = {
  id: 'core', area: 'core', commit: 'c0ffee', files: 3, occasions: 3, sources: { claude: 3 }, costUsd: 5, distinct: 3,
  total: 5.4, unseen: 2.4, nextNew: 0.4, nextUsd: null, lines: null, defectsPerKloc: null, unseenPerKloc: null, limit: { usd: 1.5, times: null, goingUsd: null, text: '$1.50' }, usdPerKloc: null, passes: [], stopped: null, updated: null, running: null, defects,
};

describe('DelveChart', () => {
  it("stacks each pass's own findings, the ones seen before at the bottom, by whether each was new", () => {
    expect(stacksOf(defects, 3).map((st) => st.map(({ defect: d, novelty }) => `${d.id}:${novelty}`))).toEqual([
      ['D1:new'], ['D1:again', 'D3:lone'], ['D1:again', 'D2:lone'],
    ]);
  });

  it('draws a tile per finding, and outlines for the defects not found yet with their count', () => {
    const { container } = render(<DelveChart ledger={ledger} max={40} live />);
    expect(screen.getByRole('img')).toHaveAccessibleName('3 passes, 3 defects found, about 2 not found yet');
    expect(container.querySelectorAll('title')).toHaveLength(5);
    expect(screen.getByText('≈ 2 not found yet')).toBeInTheDocument();
  });

  it("names a repeat sighting's first pass, and traces every sighting of a hovered defect", () => {
    const { container } = render(<DelveChart ledger={ledger} />);
    const titles = [...container.querySelectorAll('title')].map((t) => t.textContent);
    expect(titles).toContain('pass 3 · D1, seen before in pass 1 · claim D1');
    const tileOf = (title: string) => [...container.querySelectorAll('g')].find((g) => g.querySelector('title')?.textContent === title)!;
    fireEvent.pointerEnter(tileOf('pass 3 · D1, seen before in pass 1 · claim D1'));
    const traced = [...container.querySelectorAll('g')].filter((g) => g.className.baseVal.includes('traced'));
    expect(traced.map((g) => g.querySelector('title')!.textContent!.split(' ·')[0])).toEqual(['pass 1', 'pass 2', 'pass 3']);
    expect(screen.getByRole('img').getAttribute('class')).toContain('tracing');
    fireEvent.pointerLeave(tileOf('pass 3 · D1, seen before in pass 1 · claim D1'));
    expect(screen.getByRole('img').getAttribute('class')).not.toContain('tracing');
  });

  it("fades a defect whose fix is settled, every sighting of it", () => {
    const fix = { batches: [], ask: [], statuses: { D1: { status: 'fixed' as const, run: 1, branch: 'scour1-core-b1', verified: true } } };
    const { container } = render(<DelveChart ledger={{ ...ledger, fix }} />);
    const settled = [...container.querySelectorAll('g')].filter((g) => g.className.baseVal.includes('settled'));
    expect(settled.map((g) => g.querySelector('title')!.textContent!.split(' · ')[1]!.split(',')[0])).toEqual(['D1', 'D1', 'D1']);
  });

  it('marks a pass that found nothing with a patch on the ground', () => {
    const { container } = render(<DelveChart ledger={{ ...ledger, occasions: 4 }} />);
    expect([...container.querySelectorAll('title')].map((t) => t.textContent)).toContain('pass 4 · no findings');
  });

  it('spans a finished ledger by its passes, and a live one with room to grow up to its cap', () => {
    expect(spanOf(25, 40, false)).toBe(25);
    expect(spanOf(6, 40, true)).toBe(10);
    expect(spanOf(20, 40, true)).toBe(27);
    expect(spanOf(38, 40, true)).toBe(40);
  });
});
