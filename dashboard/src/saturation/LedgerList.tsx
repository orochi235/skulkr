import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { DataGrid, type DataGridColumn } from '@weasel-js/ui/components/DataGrid';
import { Input } from '@weasel-js/ui/components/Input';
import { estimate, percent, usd } from './format';
import type { SaturationLedger } from './saturation.types';
import s from './LedgerList.module.css';

/** An area id that wraps only after its dots. */
const areaName = (id: string) => id.split('.').map((part, i) => <Fragment key={i}>{i > 0 && <>.<wbr /></>}{part}</Fragment>);

const COLUMNS: readonly DataGridColumn<SaturationLedger>[] = [
  { id: 'id', header: 'Area', className: s.area, render: (l) => areaName(l.id) },
  { id: 'occasions', header: 'Occ.', numeric: true },
  { id: 'distinct', header: 'Defects', numeric: true },
  { id: 'unseen', header: 'Unseen', numeric: true, render: (l) => estimate(l.unseen) },
  { id: 'nextNew', header: 'Next new', numeric: true, render: (l) => percent(l.nextNew) },
  { id: 'costUsd', header: 'Cost', numeric: true, render: (l) => usd(l.costUsd) },
];

/** Every ledger, filtered by name and sortable by any column; picking one shows its defects. */
export function LedgerList({ ledgers, picked, onPick }: { ledgers: readonly SaturationLedger[]; picked: string | null; onPick: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? ledgers.filter((l) => l.id.toLowerCase().includes(q)) : ledgers;
  }, [ledgers, query]);
  // A pick made elsewhere, on the map, brings its row into view.
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroll.current?.querySelector(`.${s.picked}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [picked]);
  return (
    <section className={s.list} aria-label="Ledgers">
      <Input
        type="search" size="sm" aria-label="Filter ledgers by area" placeholder="filter areas"
        value={query} onChange={setQuery} spellCheck={false} autoCapitalize="off"
      />
      <div ref={scroll} className={s.scroll}>
        <DataGrid
          rows={rows} columns={COLUMNS} defaultSort={{ columnId: 'unseen', direction: 'desc' }} empty="No ledger matches."
          onRowClick={(l) => onPick(l.id)} rowClassName={(l) => (l.id === picked ? s.picked : undefined)} rowLabel={(l) => l.id}
        />
      </div>
    </section>
  );
}
