import type { SaturationLedger } from './saturation.types';

/** One row of the ledger tree: a run of an area id's dotted parts, the ledgers there, and the totals beneath it. */
export interface LedgerTreeNode {
  /** The area id up to this row, or the ledger's own id for a set-aside one. */
  readonly id: string;
  readonly label: string;
  /** The ledger this row stands for, if any. */
  readonly ledger: SaturationLedger | null;
  /** Whether this row is an area of the partition, with a ledger or without. */
  readonly area: boolean;
  /** How many ledgers this row and the rows beneath it hold. */
  readonly ledgers: number;
  readonly children: readonly LedgerTreeNode[];
  /** Distinct defects in this row's ledger and every ledger beneath it. */
  readonly defects: number;
  /** Their estimated unseen defects, summed over those that have an estimate; null where none does. */
  readonly unseen: number | null;
  readonly costUsd: number;
}

interface Draft {
  ledger: SaturationLedger | null;
  area: boolean;
  kids: Map<string, Draft>;
  aside: SaturationLedger[];
}

const draft = (): Draft => ({ ledger: null, area: false, kids: new Map(), aside: [] });

const addUnseen = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : a + b);

const finish = (path: string, label: string, d: Draft): LedgerTreeNode => {
  const kids = [...d.kids].sort(([a], [b]) => a.localeCompare(b)).map(([part, k]) => finish(path ? `${path}.${part}` : part, part, k));
  const aside = d.aside.map((l): LedgerTreeNode => ({
    id: l.id, label: `@${l.commit.slice(0, 10)}`, ledger: l, area: false, ledgers: 1, children: [], defects: l.distinct, unseen: l.unseen, costUsd: l.costUsd,
  }));
  const children = [...kids, ...aside];
  // A row that is no area and has one row beneath it says nothing: it merges into that row.
  if (!d.ledger && !d.area && children.length === 1 && kids.length === 1) {
    const [only] = kids;
    return { ...only!, label: `${label}.${only!.label}` };
  }
  return {
    id: path, label, ledger: d.ledger, area: d.area || d.ledger !== null, children,
    ledgers: (d.ledger ? 1 : 0) + children.reduce((n, c) => n + c.ledgers, 0),
    defects: (d.ledger?.distinct ?? 0) + children.reduce((n, c) => n + c.defects, 0),
    unseen: children.reduce((n, c) => addUnseen(n, c.unseen), d.ledger?.unseen ?? null),
    costUsd: (d.ledger?.costUsd ?? 0) + children.reduce((n, c) => n + c.costUsd, 0),
  };
};

/**
 * The ledgers as a tree by their areas' dotted parts, a set-aside ledger under its area as `@<commit>`, with a row as
 * well for each of `areas` that has no ledger.
 */
export function ledgerTreeOf(ledgers: readonly SaturationLedger[], areas: readonly string[] = []): readonly LedgerTreeNode[] {
  const root = draft();
  const reach = (area: string) => {
    let at = root;
    for (const part of area.split('.')) {
      if (!at.kids.has(part)) at.kids.set(part, draft());
      at = at.kids.get(part)!;
    }
    return at;
  };
  for (const area of areas) reach(area).area = true;
  for (const l of ledgers) {
    const at = reach(l.area);
    if (l.id === l.area) at.ledger = l;
    else at.aside.push(l);
  }
  return [...root.kids].sort(([a], [b]) => a.localeCompare(b)).map(([part, d]) => finish(part, part, d));
}

/** The ids of the rows above `id`, for opening the tree down to it. */
export function ancestorIdsOf(nodes: readonly LedgerTreeNode[], id: string): string[] {
  for (const n of nodes) {
    if (n.id === id) return [];
    const below = ancestorIdsOf(n.children, id);
    if (below.length || n.children.some((c) => c.id === id)) return [n.id, ...below];
  }
  return [];
}
