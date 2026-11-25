import { useEffect, useMemo, useRef, useState } from 'react';
import { Input } from '@weasel-js/ui/components/Input';
import { Tree, filterTree, treeBranchIds, type TreeNode } from '@weasel-js/ui/components/Tree';
import { estimate, usd } from './format';
import { ancestorIdsOf, ledgerTreeOf, type LedgerTreeNode } from './ledgerTree';
import type { SaturationLedger } from './saturation.types';
import s from './LedgerList.module.css';

const treeNodeOf = (n: LedgerTreeNode): TreeNode => ({
  id: n.id,
  label: n.label,
  textValue: n.label,
  muted: !n.ledger,
  className: s.row,
  tooltip: n.ledgers === 0 ? `${n.id}: no ledger yet${n.within ? `, nor any of the ${n.within} areas within it` : ''}`
    : `${n.ledger ? n.id : `everything under ${n.id}`}: ${n.defects} defects, ${estimate(n.unseen)} unseen, ${usd(n.costUsd)}`,
  trailing: (
    <span className={s.figures}>
      <span className={s.within}>{n.within || ''}</span>
      <span className={s.defects}>{n.ledgers === 0 ? '–' : n.defects}</span>
      <span className={s.unseen}>{estimate(n.unseen)}</span>
    </span>
  ),
  ...(n.children.length ? { children: n.children.map(treeNodeOf) } : {}),
});

/** Every area and ledger as a tree by area, filtered by name; picking one shows its defects. */
export function LedgerList({ ledgers, areas, picked, onPick }: {
  ledgers: readonly SaturationLedger[];
  /** The partition's areas, each listed whether it has a ledger or not. */
  areas: readonly string[];
  picked: string | null;
  onPick: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const tree = useMemo(() => ledgerTreeOf(ledgers, areas), [ledgers, areas]);
  const ids = useMemo(() => new Set([...ledgers.map((l) => l.id), ...areas]), [ledgers, areas]);
  const all = useMemo(() => tree.map(treeNodeOf), [tree]);
  const q = query.trim().toLowerCase();
  const nodes = useMemo(() => (q ? filterTree(all, (n) => n.id.toLowerCase().includes(q)) : all), [all, q]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(picked ? ancestorIdsOf(tree, picked) : []));
  // A pick made elsewhere, on the map, opens the tree down to its row and brings it into view.
  useEffect(() => {
    if (!picked) return;
    setExpanded((open) => {
      const missing = ancestorIdsOf(tree, picked).filter((id) => !open.has(id));
      return missing.length ? new Set([...open, ...missing]) : open;
    });
  }, [picked, tree]);
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroll.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [picked, expanded]);
  return (
    <section className={s.list} aria-label="Ledgers">
      <Input
        type="search" size="sm" aria-label="Filter ledgers by area" placeholder="filter areas"
        value={query} onChange={setQuery} spellCheck={false} autoCapitalize="off"
      />
      <div className={s.head} aria-hidden="true">
        <span>Area</span>
        <span className={s.figures}><span className={s.within}>Areas</span><span className={s.defects}>Defects</span><span className={s.unseen}>Unseen</span></span>
      </div>
      <div ref={scroll} className={s.scroll}>
        <Tree
          aria-label="Ledgers by area" className={s.tree} nodes={nodes} empty="No ledger matches." guides pressFolds={false}
          expandedIds={q ? treeBranchIds(nodes) : expanded} onExpandedChange={q ? undefined : setExpanded}
          selectionMode="single" selectedIds={picked ? [picked] : []}
          onAction={(id) => { if (ids.has(id)) onPick(id); }}
        />
      </div>
    </section>
  );
}
