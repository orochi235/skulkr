import { Button } from '@weasel-js/ui/components/Button';
import { DataGrid, type DataGridColumn } from '@weasel-js/ui/components/DataGrid';
import { Dialog } from '@weasel-js/ui/components/Dialog';
import { useState } from 'react';
import { estimate, percent, usd, usdOrDash } from './format';
import type { SaturationLedger, SaturationPass } from './saturation.types';
import s from './PassTable.module.css';

type Row = SaturationPass & { readonly id: string };

const COLUMNS: readonly DataGridColumn<Row>[] = [
  { id: 'n', header: 'Pass', accessor: (p) => p.n, numeric: true },
  { id: 'source', header: 'Source' },
  { id: 'findings', header: 'Found', accessor: (p) => p.findings, numeric: true },
  { id: 'new', header: 'New', accessor: (p) => p.new, numeric: true },
  { id: 'distinct', header: 'Distinct', accessor: (p) => p.distinct, numeric: true },
  { id: 'unseen', header: 'Unseen', accessor: (p) => p.unseen, render: (p) => estimate(p.unseen), numeric: true },
  { id: 'nextNew', header: 'Next new', accessor: (p) => p.nextNew, render: (p) => percent(p.nextNew), numeric: true },
  { id: 'costUsd', header: 'Pass $', accessor: (p) => p.costUsd, render: (p) => usd(p.costUsd), numeric: true },
  { id: 'spentUsd', header: 'Total $', accessor: (p) => p.spentUsd, render: (p) => usd(p.spentUsd), numeric: true },
  { id: 'usdPerDefect', header: 'Avg $/defect', accessor: (p) => p.usdPerDefect, render: (p) => usdOrDash(p.usdPerDefect), numeric: true },
  { id: 'nextUsd', header: 'Next defect $', accessor: (p) => p.nextUsd, render: (p) => usdOrDash(p.nextUsd), numeric: true },
];

/** A button opening the ledger's passes as a table: each pass's yield, and the estimates and prices as they stood after it. */
export function PassTableButton({ ledger }: { ledger: SaturationLedger }) {
  const [open, setOpen] = useState(false);
  if (!ledger.passes.length) return null;
  const rows: Row[] = ledger.passes.map((p) => ({ ...p, id: String(p.n) }));
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>Passes</Button>
      <Dialog open={open} onOpenChange={setOpen} dismissable title={`${ledger.id}: passes`} className={s.dialog}>
        <DataGrid rows={rows} columns={COLUMNS} defaultSort={{ columnId: 'n', direction: 'asc' }} className={s.grid} />
      </Dialog>
    </>
  );
}
