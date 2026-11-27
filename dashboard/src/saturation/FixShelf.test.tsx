import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FixShelf, isDefectClosed, isFixSettled, shelfLayoutOf, shelfStatusOf } from './FixShelf';
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

  it("shows a defect out now by its stage, and settles a fix only once it is verified on a branch or fixed in the registry", () => {
    expect(shelfStatusOf({ status: 'fixing', run: 2, branch: null, stage: 'repairing' })).toBe('repairing');
    expect(shelfStatusOf({ status: 'fixing', run: 2, branch: null })).toBe('fixing');
    expect(shelfStatusOf(undefined)).toBe('waiting');
    expect(isFixSettled({ status: 'fixed', run: 1, branch: 'b', verified: true })).toBe(true);
    expect(isFixSettled({ status: 'fixed', run: 1, branch: 'b', verified: false })).toBe(false);
    expect(isFixSettled({ status: 'not a defect', run: 1, branch: 'b', verified: true })).toBe(false);
    expect(isFixSettled(undefined, { status: 'fixed' })).toBe(true);
    expect(isDefectClosed({ status: 'not a defect', run: 1, branch: 'b', verified: true })).toBe(true);
    expect(isDefectClosed({ status: 'question', run: 1, branch: 'b', verified: true }, { status: 'open' })).toBe(false);
  });

  it("keeps a traced defect's whole batch in color", () => {
    const { container } = render(<FixShelf shelf={shelf} traced="D2" />);
    const groups = [...container.querySelectorAll('svg > g')];
    expect(groups.map((g) => g.getAttribute('class') ?? '')).toEqual([expect.stringContaining('tracedGroup'), '']);
  });
});
