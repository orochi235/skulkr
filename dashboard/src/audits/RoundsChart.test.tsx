import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RoundsChart, areaRoundsOf, nthPassAverages } from './RoundsChart';
import type { AuditArea, AuditRound } from './skulkrMap.types';

const rounds: AuditRound[] = [
  { round: 1, date: '2026-11-01', areas: 16, files: 400, distinct: 80, est: 120 },
  { round: 2, date: '2026-11-02', areas: 8, files: 200, distinct: 24, est: 40 },
];
const area = {
  id: 'geom.part1', files: 30,
  passes: [
    { round: 1, date: '2026-11-01', a: 4, b: 5, shared: 2, distinct: 7, est: 10, left: 3 },
    { round: 2, date: '2026-11-02', a: 2, b: 1, shared: 1, distinct: 2, est: 2, left: 0, provisional: true },
  ],
} as unknown as AuditArea;

describe('RoundsChart', () => {
  it('draws every round per area, and a picked area its own passes in plain defects', () => {
    const { rerender } = render(<RoundsChart rounds={rounds} />);
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Defects found and estimated per area, by round');
    rerender(<RoundsChart rounds={rounds} area={area} />);
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Defects found and estimated in geom.part1, by round');
    expect(screen.getByText('defects')).toBeTruthy();
    expect([...document.querySelectorAll('title')].map((t) => t.textContent)).toEqual([
      'round 1: 7 found and 10.0 estimated in geom.part1',
      'round 2 (live): 2 found and 2.0 estimated in geom.part1',
    ]);
  });

  it('keeps a round most of whose areas came back incomplete out of the scale, with no estimate, tagged by how many counted', () => {
    const partial = { round: 3, date: '2026-11-03', areas: 1, files: 19, distinct: 13, est: 53, incomplete: 15 };
    render(<RoundsChart rounds={[...rounds, partial]} />);
    expect([...document.querySelectorAll('.lk-axis, text')].map((t) => t.textContent)).toContain('1 of 16');
    expect(document.querySelectorAll('rect').length).toBe(5);
    expect(Number([...document.querySelectorAll('text')].map((t) => Number(t.textContent)).filter((n) => !Number.isNaN(n)).sort((p, q) => q - p)[0])).toBeLessThan(13);
  });

  it('names the picked area under the chart and keeps the full caption behind an info button', () => {
    render(<RoundsChart rounds={rounds} area={area} />);
    expect(screen.getByText('geom.part1').closest('span')!.textContent).toBe('geom.part1, each round that read it');
    expect(screen.queryByText(/Chapman/)).toBeNull();
    // Opening it is checked in a browser: React Aria's popover does not open under jsdom.
    expect(screen.getByRole('button', { name: 'What the rounds chart shows' }).getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps every round for an area with one pass, saying so, and averages each nth pass across areas', () => {
    const once = { ...area, id: 'menu', passes: [area.passes[0]!] } as AuditArea;
    render(<RoundsChart rounds={rounds} area={once} areas={[area, once]} />);
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Defects found and estimated per area, by round');
    expect(screen.getByText('menu').closest('span')!.textContent).toBe('menu has one pass; every round shown');
    expect(nthPassAverages([area, once])).toEqual([{ mean: 7, of: 2 }, { mean: 2, of: 1 }]);
  });

  it('draws a gray bar beside each of the area\'s passes for what an area\'s pass in that place found on average', () => {
    const other = { ...area, id: 'core', passes: [{ ...area.passes[0]!, distinct: 3 }] } as AuditArea;
    render(<RoundsChart rounds={rounds} area={area} areas={[area, other]} />);
    const titles = [...document.querySelectorAll('title')].map((t) => t.textContent);
    expect(titles).toContain("an area's 1st pass found 5.0 on average, over 2 areas");
    expect(titles).toContain("an area's 2nd pass found 2.0 on average, over 1 areas");
  });

  it('draws a fresh chart when its scope goes back to every area, with nothing of the area\'s left', () => {
    const other = { ...area, id: 'core', passes: [{ ...area.passes[0]!, distinct: 3 }] } as AuditArea;
    const { rerender } = render(<RoundsChart rounds={rounds} area={area} areas={[area, other]} />);
    const before = screen.getByRole('img');
    rerender(<RoundsChart rounds={rounds} areas={[area, other]} />);
    const after = screen.getByRole('img');
    expect(after).not.toBe(before);
    expect(after.getAttribute('aria-label')).toBe('Defects found and estimated per area, by round');
    expect([...after.querySelectorAll('title')].map((t) => t.textContent).some((t) => /geom\.part1|on average/.test(t ?? ''))).toBe(false);
  });

  it('turns an area\'s passes into rounds of one area, a live pass pending', () => {
    expect(areaRoundsOf(area).map((r) => [r.round, r.areas, r.distinct, r.est, r.pending])).toEqual([
      [1, 1, 7, 10, undefined], [2, 1, 2, 2, 'live'],
    ]);
  });
});
