import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Checkbox } from '@weasel-js/ui/components/Checkbox';
import { useDashPref } from '@dash/audits/dashPrefs';
import { DataGrid, type DataGridColumn } from '@weasel-js/ui/components/DataGrid';
import { InlineMarkdown } from '@weasel-js/ui/components/InlineMarkdown';
import { DelveAbout, DelveChart, DelveKey, hasCodexPass, hasHeldDefect } from './DelveChart';
import { FixShelf, FixShelfAbout, FixShelfKey, FixStatusChip, FixSwatch, isDefectClosed, ShelfOrderSwitch, shelfStatusOf } from './FixShelf';
import { LedgerHero } from './LedgerHero';
import { PassTableButton } from './PassTable';
import { severityRank } from './format';
import { DefectCallout, useDefectCallout } from './DefectCallout';
import { LedgerFacts, StopStatus } from './LedgerFacts';
import { useFitsInRow } from './useFitsInRow';
import type { FixShelf as FixShelfData, SaturationDefect, SaturationLedger } from './saturation.types';
import s from './LedgerDetail.module.css';

const COLUMNS: readonly DataGridColumn<SaturationDefect>[] = [
  { id: 'id', header: 'ID', accessor: (d) => Number(d.id.slice(1)), render: (d) => <span data-defect={d.id}>{d.id}</span>, className: s.id },
  { id: 'severity', header: 'Severity', accessor: (d) => severityRank(d.severity), render: (d) => d.severity || '–' },
  { id: 'claim', header: 'Defect', render: (d) => <InlineMarkdown text={d.claim} />, className: s.claim },
  { id: 'where', header: 'Where', render: (d) => <InlineMarkdown text={d.where} />, className: s.where },
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

/** A picked defect, with its area; `n` counts picks, so picking the same defect again scrolls to it again. */
export type DefectPick = { area: string; id: string; n: number };

/** One ledger: how far its reviews got, and its distinct defects; `picked`, a tile clicked on its chart or elsewhere,
 *  is the defect whose row it scrolls to and marks. */
export function LedgerDetail({ ledger, picked: pick, onPickDefect }: {
  ledger: SaturationLedger; picked: DefectPick | null; onPickDefect: (area: string, id: string) => void;
}) {
  const picked = pick?.area === ledger.id ? pick : null;
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!picked) return;
    const cell = scroll.current?.querySelector(`[data-defect="${CSS.escape(picked.id)}"]`);
    cell?.closest('tr')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [picked]);
  // The defect hovered on either chart, traced on both, its callout over the header.
  const { hostEvents, traced, setTraced, at: pointer } = useDefectCallout<HTMLElement>();
  const [shelfOrder, setShelfOrder] = useDashPref('saturation.shelfOrder');
  const [hideFixed, setHideFixed] = useDashPref('saturation.collapseResolved');
  const hasFixPlan = Boolean(ledger.fix && ledger.fix.batches.length > 0);
  // Only a delve grows the chart toward its cap; a fix run's max counts batches, not passes.
  const delving = ledger.running !== null && ledger.running.does !== 'fix';
  // The legend box shows only where it fits beside the others.
  const summary = useRef<HTMLDivElement>(null);
  const legend = useRef<HTMLElement>(null);
  const legendFits = useFitsInRow(summary, legend);
  useEffect(() => setTraced(null), [ledger.id, setTraced]);
  const columns = useMemo(() => columnsFor(ledger.fix), [ledger.fix]);
  const groups = useMemo(() => defectGroupsOf(ledger), [ledger]);
  const pickDefect = useCallback((id: string) => onPickDefect(ledger.id, id), [onPickDefect, ledger.id]);
  return (
    <section className={s.detail} aria-label={`${ledger.area}'s defects`}>
      <header className={s.head} {...hostEvents}>
        <div className={`${s.titleRow} ${s.summaryTitle}`}><h2 className={s.title}>{ledger.id}</h2><DelveAbout ledger={ledger} picks /></div>
        <div ref={summary} className={s.summary}>
          <LedgerHero ledger={ledger} />
          <LedgerFacts ledger={ledger} />
          <div className={s.stack}>
            <StopStatus ledger={ledger} />
            {ledger.fix && ledger.fix.batches.length > 0 && (
              <section className={s.fixBox} aria-label="Fix plan">
                <div className={s.titleRow}>
                  <span className={s.facts}>{fixFactsOf(ledger.fix)}</span><FixShelfAbout /><span className={s.end}><ShelfOrderSwitch order={shelfOrder} onChange={setShelfOrder} /></span>
                </div>
                <FixShelf shelf={ledger.fix} order={shelfOrder} onPickDefect={pickDefect} traced={traced} onTrace={setTraced} />
              </section>
            )}
          </div>
          <section ref={legend} className={legendFits ? s.legend : `${s.legend} ${s.legendOut}`} aria-label="Legend" aria-hidden={!legendFits}>
            <div><h3 className={s.legendTitle}>Passes</h3><DelveKey codex={hasCodexPass(ledger)} held={hasHeldDefect(ledger)} /></div>
            {ledger.fix && ledger.fix.batches.length > 0 && <div className={s.legendFixes}><h3 className={s.legendTitle}>Fixes</h3><FixShelfKey /></div>}
          </section>
        </div>
        <div className={s.chart}><DelveChart ledger={ledger} max={delving ? ledger.running!.max : null} live={delving} onPickDefect={pickDefect} traced={traced} onTrace={setTraced} hideFixed={hideFixed && hasFixPlan} /><div className={s.chartFoot}><PassTableButton ledger={ledger} />{hasFixPlan && <Checkbox isSelected={hideFixed} onChange={setHideFixed}>Collapse resolved passes</Checkbox>}</div></div>
        <DefectCallout ledger={ledger} id={traced} at={pointer} />
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
