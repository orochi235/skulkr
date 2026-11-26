import { DataGrid, type DataGridColumn } from '@weasel-js/ui/components/DataGrid';
import { DelveChart, DelveKey } from './DelveChart';
import { PassTableButton } from './PassTable';
import { estimate, percent, severityRank, sourcesText, usd, usdOrDash } from './format';
import type { SaturationDefect, SaturationLedger } from './saturation.types';
import s from './LedgerDetail.module.css';

const COLUMNS: readonly DataGridColumn<SaturationDefect>[] = [
  { id: 'id', header: 'ID', accessor: (d) => Number(d.id.slice(1)), render: (d) => d.id, className: s.id },
  { id: 'severity', header: 'Severity', accessor: (d) => severityRank(d.severity), render: (d) => d.severity || '–' },
  { id: 'claim', header: 'Defect', className: s.claim },
  { id: 'where', header: 'Where', className: s.where },
  { id: 'sightings', header: 'Seen', numeric: true },
  { id: 'sources', header: 'By', accessor: (d) => (d.onlyBy ? `${d.onlyBy} only` : d.sources.join(', ')), sortable: false },
  { id: 'status', header: 'Status', accessor: (d) => d.registry?.status ?? 'not landed', render: statusOf },
];

/** A defect's registry status, with the commit that resolved it. */
function statusOf(d: SaturationDefect) {
  if (!d.registry) return <span className={s.unlanded}>not landed</span>;
  return d.registry.sha ? <>{d.registry.status} <code>{d.registry.sha.slice(0, 10)}</code></> : d.registry.status;
}

/** One ledger: how far its reviews got, and its distinct defects. */
export function LedgerDetail({ ledger }: { ledger: SaturationLedger }) {
  return (
    <section className={s.detail} aria-label={`${ledger.area}'s defects`}>
      <header className={s.head}>
        <h2 className={s.title}>{ledger.id}</h2>
        <p className={s.facts}>
          {ledger.files} files{ledger.lines !== null && <>, <span className={s.num}>{ledger.lines.toLocaleString('en-US')}</span> lines</>} at{' '}
          <code>{ledger.commit.slice(0, 10)}</code> · {ledger.occasions} occasions ({sourcesText(ledger.sources)}) ·{' '}
          <span className={s.num}>{ledger.distinct}</span> found, ≈<span className={s.num}>{estimate(ledger.total)}</span> held,
          next new <span className={s.num}>{percent(ledger.nextNew)}</span> · <span className={s.num}>{usd(ledger.costUsd)}</span>,
          next defect ≈ <span className={s.num}>{usdOrDash(ledger.nextUsd)}</span>
        </p>
        {ledger.lines !== null && (
          <p className={s.facts}>
            Per thousand lines: <span className={s.num}>{estimate(ledger.defectsPerKloc)}</span> found,{' '}
            <span className={s.num}>{estimate(ledger.unseenPerKloc)}</span> estimated unseen, <span className={s.num}>{usdOrDash(ledger.usdPerKloc)}</span> spent
          </p>
        )}
        <p className={s.facts}>{ledger.stopped ? `Stopped: ${ledger.stopped}.` : 'Not saturated yet: the stop rule does not hold.'}</p>
        <div className={s.chart}><DelveChart ledger={ledger} max={ledger.running?.max ?? null} live={ledger.running !== null} /><div className={s.chartFoot}><DelveKey /><PassTableButton ledger={ledger} /></div></div>
      </header>
      <div className={s.scroll}>
        <DataGrid rows={ledger.defects} columns={COLUMNS} defaultSort={{ columnId: 'sightings', direction: 'desc' }} empty="No defects." />
      </div>
    </section>
  );
}
