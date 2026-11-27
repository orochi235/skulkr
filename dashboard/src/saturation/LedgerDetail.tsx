import { useCallback, useEffect, useRef, useState } from 'react';
import { DataGrid, type DataGridColumn } from '@weasel-js/ui/components/DataGrid';
import { DelveAbout, DelveChart } from './DelveChart';
import { PassTableButton } from './PassTable';
import { estimate, percent, severityRank, sourcesText, usd, usdOrDash } from './format';
import type { SaturationDefect, SaturationLedger } from './saturation.types';
import s from './LedgerDetail.module.css';

const COLUMNS: readonly DataGridColumn<SaturationDefect>[] = [
  { id: 'id', header: 'ID', accessor: (d) => Number(d.id.slice(1)), render: (d) => <span data-defect={d.id}>{d.id}</span>, className: s.id },
  { id: 'severity', header: 'Severity', accessor: (d) => severityRank(d.severity), render: (d) => d.severity || '–' },
  { id: 'claim', header: 'Defect', className: s.claim },
  { id: 'where', header: 'Where', className: s.where },
  { id: 'sightings', header: 'Seen', numeric: true, render: (d) => (d.recurrent ? <><span className={s.recurrent}>recurrent</span> {d.sightings}</> : d.sightings) },
  { id: 'sources', header: 'By', accessor: (d) => (d.onlyBy ? `${d.onlyBy} only` : d.sources.join(', ')), sortable: false },
  { id: 'status', header: 'Status', accessor: (d) => d.registry?.status ?? 'not landed', render: statusOf },
];

/** A defect's registry status, with the commit that resolved it. */
function statusOf(d: SaturationDefect) {
  if (!d.registry) return <span className={s.unlanded}>not landed</span>;
  return d.registry.sha ? <>{d.registry.status} <code>{d.registry.sha.slice(0, 10)}</code></> : d.registry.status;
}

/** One ledger: how far its reviews got, and its distinct defects; clicking a tile on its chart scrolls to that defect's
 *  row and marks it. */
export function LedgerDetail({ ledger }: { ledger: SaturationLedger }) {
  // The pick carries a count so picking the same defect again scrolls to it again.
  const [picked, setPicked] = useState<{ id: string; n: number } | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!picked) return;
    const cell = scroll.current?.querySelector(`[data-defect="${CSS.escape(picked.id)}"]`);
    cell?.closest('tr')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [picked]);
  useEffect(() => setPicked(null), [ledger.id]);
  const pickDefect = useCallback((id: string) => setPicked((was) => ({ id, n: (was?.n ?? 0) + 1 })), []);
  return (
    <section className={s.detail} aria-label={`${ledger.area}'s defects`}>
      <header className={s.head}>
        <div className={s.titleRow}><h2 className={s.title}>{ledger.id}</h2><DelveAbout ledger={ledger} picks /></div>
        <p className={s.facts}>
          {ledger.files} files{ledger.lines !== null && <>, <span className={s.num}>{ledger.lines.toLocaleString('en-US')}</span> lines</>} at{' '}
          <code>{ledger.commit.slice(0, 10)}</code> · {ledger.occasions} occasions ({sourcesText(ledger.sources)}) ·{' '}
          <span className={s.num}>{ledger.distinct}</span> found, ≈<span className={s.num}>{estimate(ledger.total)}</span> held,
          next new <span className={s.num}>{percent(ledger.nextNew)}</span> · <span className={s.num}>{usd(ledger.costUsd)}</span>,
          next defect ≈ <span className={s.num}>{usdOrDash(ledger.nextUsd)}</span>, limit <span className={s.num}>{ledger.limit.text}</span>
        </p>
        {ledger.lines !== null && (
          <p className={s.facts}>
            Per thousand lines: <span className={s.num}>{estimate(ledger.defectsPerKloc)}</span> found,{' '}
            <span className={s.num}>{estimate(ledger.unseenPerKloc)}</span> estimated unseen, <span className={s.num}>{usdOrDash(ledger.usdPerKloc)}</span> spent
          </p>
        )}
        <p className={s.facts}>{ledger.stopped ? `Stopped: ${ledger.stopped}.` : 'Not saturated yet: the stop rule does not hold.'}</p>
        <div className={s.chart}><DelveChart ledger={ledger} max={ledger.running?.max ?? null} live={ledger.running !== null} onPickDefect={pickDefect} /><div className={s.chartFoot}><PassTableButton ledger={ledger} /></div></div>
      </header>
      <div ref={scroll} className={s.scroll}>
        <DataGrid
          rows={ledger.defects} columns={COLUMNS} defaultSort={{ columnId: 'sightings', direction: 'desc' }} empty="No defects."
          rowClassName={(d) => (d.id === picked?.id ? s.picked : undefined)}
        />
      </div>
    </section>
  );
}
