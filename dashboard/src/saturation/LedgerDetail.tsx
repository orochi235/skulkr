import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DataGrid, type DataGridColumn } from '@weasel-js/ui/components/DataGrid';
import { DelveAbout, DelveChart } from './DelveChart';
import { FixShelf, FixShelfAbout, FixStatusChip, FixSwatch, isDefectClosed, shelfStatusOf } from './FixShelf';
import { PassTableButton } from './PassTable';
import { estimate, linesText, percent, severityRank, sourcesText, usd, usdOrDash } from './format';
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
  useEffect(() => { setPicked(null); setTraced(null); }, [ledger.id]);
  const columns = useMemo(() => columnsFor(ledger.fix), [ledger.fix]);
  const groups = useMemo(() => defectGroupsOf(ledger), [ledger]);
  const pickDefect = useCallback((id: string) => setPicked((was) => ({ id, n: (was?.n ?? 0) + 1 })), []);
  return (
    <section className={s.detail} aria-label={`${ledger.area}'s defects`}>
      <header className={s.head}>
        <div className={s.titleRow}><h2 className={s.title}>{ledger.id}</h2><DelveAbout ledger={ledger} picks /></div>
        <p className={s.facts}>
          {ledger.files} files{ledger.lines !== null && <>, <span className={s.num}>{linesText(ledger.lines)}</span> lines</>} at{' '}
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
        <div className={s.chart}><DelveChart ledger={ledger} max={ledger.running?.max ?? null} live={ledger.running !== null} onPickDefect={pickDefect} traced={traced} onTrace={setTraced} /><div className={s.chartFoot}><PassTableButton ledger={ledger} /></div></div>
        {ledger.fix && ledger.fix.batches.length > 0 && (
          <div className={s.chart}>
            <div className={s.titleRow}><span className={s.facts}>{fixFactsOf(ledger.fix)}</span><FixShelfAbout /></div>
            <FixShelf shelf={ledger.fix} onPickDefect={pickDefect} traced={traced} onTrace={setTraced} />
          </div>
        )}
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
