import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DataGrid, type DataGridColumn } from '@weasel-js/ui/components/DataGrid';
import { DelveAbout, DelveChart } from './DelveChart';
import { FixShelf, FixShelfAbout, FixStatusChip, FixSwatch, isDefectClosed, ShelfOrderSwitch, shelfStatusOf, type ShelfOrder } from './FixShelf';
import { LedgerHero } from './LedgerHero';
import { PassTableButton } from './PassTable';
import { severityRank } from './format';
import { DefectCallout } from './DefectCallout';
import { LedgerFacts } from './LedgerFacts';
import type { FixShelf as FixShelfData, SaturationDefect, SaturationLedger } from './saturation.types';
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

/** The table's columns, with a Fix column before Status where the ledger has a fix plan: each defect's fix-run status,
 *  the shelf's, which moves before the registry's does (that waits for a fix to land). */
export const columnsFor = (shelf: FixShelfData | null | undefined): readonly DataGridColumn<SaturationDefect>[] => {
  if (!shelf) return COLUMNS;
  // A row leads with its tile's color, so where its fix stands reads at the row's start.
  const id: DataGridColumn<SaturationDefect> = {
    ...COLUMNS[0]!,
    render: (d) => <span data-defect={d.id}><FixSwatch status={shelfStatusOf(shelf.statuses[d.id])} />{d.id}</span>,
  };
  const fix: DataGridColumn<SaturationDefect> = {
    id: 'fix', header: 'Fix', accessor: (d) => shelf.statuses[d.id]?.status ?? '',
    render: (d) => {
      const at = shelf.statuses[d.id];
      return at ? <FixStatusChip status={shelfStatusOf(at)} branch={at.status === 'fixed' ? at.branch : null} /> : '–';
    },
  };
  return [id, ...COLUMNS.slice(1, -1), fix, COLUMNS.at(-1)!];
};

/** A ledger's defects split by whether each is closed (`isDefectClosed`), the unresolved first; the resolved group only
 *  where it has rows. Each is its own table, sorted on its own: weasel's DataGrid cannot group rows. */
export const defectGroupsOf = (ledger: SaturationLedger) => {
  const closed = ledger.defects.filter((d) => isDefectClosed(ledger.fix?.statuses[d.id], d.registry));
  const open = ledger.defects.filter((d) => !closed.includes(d));
  return [
    { label: 'Unresolved', closed: false, rows: open },
    ...(closed.length ? [{ label: 'Resolved', closed: true, rows: closed }] : []),
  ];
};

/** The shelf's caption: its batches, and how many of its defects a fix run has fixed or has out now. */
export const fixFactsOf = (shelf: FixShelfData): string => {
  const total = shelf.batches.reduce((n, b) => n + b.defects.length, 0);
  const statuses = Object.values(shelf.statuses);
  const fixed = statuses.filter((v) => v.status === 'fixed').length;
  const fixing = statuses.filter((v) => v.status === 'fixing').length;
  return `Fix plan · ${shelf.batches.length} batches · ${fixed} of ${total} fixed${fixing ? `, ${fixing} fixing` : ''}${shelf.ask.length ? ` · ${shelf.ask.length} to ask` : ''}`;
};

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
  // The defect hovered on either chart, traced on both.
  const [traced, setTraced] = useState<string | null>(null);
  const [shelfOrder, setShelfOrder] = useState<ShelfOrder>('batch');
  // Where the pointer is over the header, for the traced defect's callout.
  const head = useRef<HTMLElement>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => { setPicked(null); setTraced(null); }, [ledger.id]);
  const columns = useMemo(() => columnsFor(ledger.fix), [ledger.fix]);
  const groups = useMemo(() => defectGroupsOf(ledger), [ledger]);
  const pickDefect = useCallback((id: string) => setPicked((was) => ({ id, n: (was?.n ?? 0) + 1 })), []);
  return (
    <section className={s.detail} aria-label={`${ledger.area}'s defects`}>
      <header
        ref={head} className={s.head}
        onPointerMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          setPointer({ x: e.clientX - box.left, y: e.clientY - box.top });
        }}
        onPointerLeave={() => setPointer(null)}
      >
        <div className={s.summary}>
          <div className={`${s.titleRow} ${s.summaryTitle}`}><h2 className={s.title}>{ledger.id}</h2><DelveAbout ledger={ledger} picks /></div>
          <div className={s.heroCell}><LedgerHero ledger={ledger} /></div>
          <div className={s.blurb}><LedgerFacts ledger={ledger} /></div>
        </div>
        <div className={s.chart}><DelveChart ledger={ledger} max={ledger.running?.max ?? null} live={ledger.running !== null} onPickDefect={pickDefect} traced={traced} onTrace={setTraced} /><div className={s.chartFoot}><PassTableButton ledger={ledger} /></div></div>
        {ledger.fix && ledger.fix.batches.length > 0 && (
          <div className={s.chart}>
            <div className={s.titleRow}>
              <span className={s.facts}>{fixFactsOf(ledger.fix)}</span><FixShelfAbout /><ShelfOrderSwitch order={shelfOrder} onChange={setShelfOrder} />
            </div>
            <FixShelf shelf={ledger.fix} order={shelfOrder} onPickDefect={pickDefect} traced={traced} onTrace={setTraced} />
          </div>
        )}
        <DefectCallout ledger={ledger} id={traced} at={pointer} flipX={(head.current?.clientWidth ?? 0) / 2} />
      </header>
      <div ref={scroll} className={s.scroll}>
        {groups.map((g) => (
          <div key={g.label}>
            {groups.length > 1 && <h3 className={s.group}>{g.label} · <span className={s.num}>{g.rows.length}</span></h3>}
            <DataGrid
              rows={g.rows} columns={columns} defaultSort={{ columnId: 'sightings', direction: 'desc' }} empty="No defects."
              rowClassName={(d) => [d.id === picked?.id ? s.picked : '', g.closed ? s.closed : ''].filter(Boolean).join(' ') || undefined}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
