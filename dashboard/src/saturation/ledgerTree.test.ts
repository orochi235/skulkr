import { describe, expect, it } from 'vitest';
import { ancestorIdsOf, ledgerTreeOf, type LedgerTreeNode } from './ledgerTree';
import type { SaturationLedger } from './saturation.types';

const ledger = (id: string, distinct: number, unseen: number | null, area = id): SaturationLedger => ({
  id, area, commit: '9c4522d63555ec5f264441bcef4cd6a1917eac02', files: 1, occasions: 2, sources: { claude: 2 },
  costUsd: 1, distinct, total: null, unseen, nextNew: null, stopped: null, updated: null, defects: [],
});

const shape = (nodes: readonly LedgerTreeNode[]): unknown => nodes.map((n) => [n.label, n.defects, n.unseen, ...(n.children.length ? [shape(n.children)] : [])]);

describe('ledgerTreeOf', () => {
  it('nests areas by their dotted parts, totals each branch, and merges a branch that only leads to one row', () => {
    const tree = ledgerTreeOf([
      ledger('apps.chart', 1, 2), ledger('apps.chart.src.part1', 2, null), ledger('apps.chart.src.part2', 3, 0.5),
      ledger('core.canvas.nodeShapes', 6, 8.3), ledger('core.canvas.nodeShapes.9c4522d635', 4, null, 'core.canvas.nodeShapes'),
    ]);
    expect(shape(tree)).toEqual([
      ['apps.chart', 6, 2.5, [['src', 5, 0.5, [['part1', 2, null], ['part2', 3, 0.5]]]]],
      ['core.canvas.nodeShapes', 10, 8.3, [['@9c4522d635', 4, null]]],
    ]);
    expect(tree[0]!.id).toBe('apps.chart');
    expect(ancestorIdsOf(tree, 'apps.chart.src.part2')).toEqual(['apps.chart', 'apps.chart.src']);
    expect(ancestorIdsOf(tree, 'core.canvas.nodeShapes.9c4522d635')).toEqual(['core.canvas.nodeShapes']);
  });
});
