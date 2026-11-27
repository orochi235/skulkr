import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FixShelf, shelfLayoutOf } from './FixShelf';
import type { FixShelf as FixShelfData } from './saturation.types';

const shelf: FixShelfData = {
  batches: [
    { n: 1, defects: [{ id: 'D1', size: 'function', recurrent: true }, { id: 'D2', size: 'line', recurrent: false }] },
    { n: 2, defects: [{ id: 'D3', size: 'design', recurrent: false }] },
  ],
  ask: [],
  statuses: { D1: { status: 'fixed', run: 1, branch: 'scour1-core-b1' }, D3: { status: 'fixing', run: 2, branch: null } },
};

describe('FixShelf', () => {
  it("stands one tile per defect, all one size, batches apart, each in its status's color", () => {
    const { groups } = shelfLayoutOf(shelf);
    expect(groups.map((g) => g.books.map((b) => [b.id, b.status, b.h]))).toEqual([[['D1', 'fixed', 26], ['D2', 'waiting', 26]], [['D3', 'fixing', 26]]]);
    expect(groups[1]!.books[0]!.x - groups[0]!.books[1]!.x).toBeGreaterThan(9);
  });

  it("names each tile's status and run, and picks its defect when clicked", () => {
    const pick = vi.fn();
    const { container } = render(<FixShelf shelf={shelf} onPickDefect={pick} />);
    const titles = [...container.querySelectorAll('title')].map((t) => t.textContent);
    expect(titles).toEqual([
      'D1 · batch 1 · fixed (fix run 1, scour1-core-b1) · recurrent', 'D2 · batch 1 · waiting', 'D3 · batch 2 · fixing (fix run 2)',
    ]);
    fireEvent.click(container.querySelectorAll('svg > g > g')[1]!);
    expect(pick).toHaveBeenCalledWith('D2');
  });
});
