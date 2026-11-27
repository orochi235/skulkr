import { SegmentedBar } from '@weasel-js/ui/components/Segmented';
import { linesText, usd } from './format';
import type { FixQueueRow, SaturationLedger } from './saturation.types';
import s from './ScourQueue.module.css';

export type QueueMode = 'delve' | 'fix';

const MODES = [{ value: 'delve', label: 'Delve' }, { value: 'fix', label: 'Fix' }] as const satisfies readonly { value: QueueMode; label: string }[];

/** A stored queue mode, when it is one. */
export const readQueueMode = (stored: string): QueueMode | undefined => (stored === 'delve' || stored === 'fix' ? stored : undefined);

/** A queued area's row's hover text: its next defect's price where its ledger has one, else that it is ranked at the
 *  project's opening price. */
export const queueTitleOf = (id: string, ledger: SaturationLedger | undefined): string =>
  ledger && ledger.occasions >= 2 && ledger.nextUsd !== null
    ? `${id}: next defect ≈ ${usd(ledger.nextUsd)}`
    : `${id}: under two passes, ranked at the opening price`;

/** What a fix queue row says in its figure columns' place while its run is live: its batch's phase, which batch, and
 *  that step's count. */
export const fixingText = (row: FixQueueRow): string =>
  `${row.phase ?? 'fixing'} ${row.done + 1}/${row.batches ?? '?'}${row.progress ? ` · ${row.progress.done.toLocaleString('en-US')}/${row.progress.of.toLocaleString('en-US')}` : ''}`;

/** The areas a mode's queue lists, in its order: for the map's numbers and for picking. */
export const queueIdsFor = (mode: QueueMode, queue: readonly string[], fixQueue: readonly FixQueueRow[]): readonly string[] =>
  mode === 'fix' ? fixQueue.map((r) => r.area) : queue;

/**
 * Two queues, one shown at a time by the switch in its head: Delve, the areas `scour run` would delve, in its order,
 * each with its lines and defects already known; and Fix, the fix queue (`skulkr scour queue`), its live runs first.
 * Read-only; a row picks its area. Its column heads scroll with its rows, pinned at the top, so the two share one width.
 */
export function ScourQueue({ mode, onMode, queue, fixQueue, ledgers, picked, onPick }: {
  mode: QueueMode; onMode: (mode: QueueMode) => void;
  queue: readonly string[]; fixQueue: readonly FixQueueRow[]; ledgers: readonly SaturationLedger[];
  picked: string | null; onPick: (id: string) => void;
}) {
  const count = mode === 'fix' ? fixQueue.length : queue.length;
  return (
    <section className={s.pane} aria-label="Scour queue">
      <header className={s.head}>
        <h2 className={s.title}>Queue</h2>
        <SegmentedBar aria-label="Queue mode" size="sm" items={MODES} value={mode} onChange={(v) => v && onMode(v)} />
        <span className={s.count}>{count.toLocaleString('en-US')} areas</span>
      </header>
      {mode === 'fix'
        ? <FixList rows={fixQueue} picked={picked} onPick={onPick} />
        : <DelveList queue={queue} ledgers={ledgers} picked={picked} onPick={onPick} />}
    </section>
  );
}

function DelveList({ queue, ledgers, picked, onPick }: {
  queue: readonly string[]; ledgers: readonly SaturationLedger[]; picked: string | null; onPick: (id: string) => void;
}) {
  if (queue.length === 0) return <p className={s.empty}>Nothing to delve: every area has stopped or is held.</p>;
  const byArea = new Map(ledgers.filter((l) => l.id === l.area).map((l) => [l.area, l]));
  return (
    <div className={s.scroll}>
      <div className={`${s.cells} ${s.columns}`} aria-hidden="true">
        <span /><span>Area</span><span className={s.num}>Lines</span><span className={s.num}>Defects</span>
      </div>
      <ol className={s.list}>
        {queue.map((id, i) => {
          const ledger = byArea.get(id);
          return (
            <li key={id} className={id === picked ? `${s.row} ${s.picked}` : s.row}>
              <button type="button" className={`${s.cells} ${s.pick}`} title={queueTitleOf(id, ledger)} onClick={() => onPick(id)}>
                <span className={`${s.num} ${s.place}`}>{i + 1}</span>
                <span className={s.area}>{id}</span>
                <span className={s.num}>{linesText(ledger?.lines)}</span>
                <span className={s.num}>{ledger ? ledger.distinct : '–'}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function FixList({ rows, picked, onPick }: { rows: readonly FixQueueRow[]; picked: string | null; onPick: (id: string) => void }) {
  if (rows.length === 0) return <p className={s.empty}>Nothing to fix: add areas with <code>skulkr scour queue add</code>.</p>;
  const waiting = rows.filter((r) => !r.running);
  return (
    <div className={s.scroll}>
      <div className={`${s.cells} ${s.columns}`} aria-hidden="true">
        <span /><span>Area</span><span className={s.num}>Open</span><span className={s.num}>Batches</span>
      </div>
      <ol className={s.list}>
        {rows.map((row) => (
          <li key={row.area} className={row.area === picked ? `${s.row} ${s.picked}` : s.row}>
            <button type="button" className={`${s.cells} ${s.pick}${row.running ? ` ${s.live}` : ''}`} onClick={() => onPick(row.area)}>
              <span className={`${s.num} ${s.place}`}>{row.running ? '▸' : waiting.indexOf(row) + 1}</span>
              <span className={s.area}>{row.area}</span>
              {row.running
                ? <span className={`${s.num} ${s.fixing}`}>{fixingText(row)}</span>
                : <><span className={s.num}>{row.open ?? '–'}</span><span className={s.num}>{row.batches ?? '–'}</span></>}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
