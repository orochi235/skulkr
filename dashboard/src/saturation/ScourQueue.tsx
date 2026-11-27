import { usd } from './format';
import type { SaturationLedger } from './saturation.types';
import s from './ScourQueue.module.css';

/** A queued area's row's hover text: its next defect's price where its ledger has one, else that it is ranked at the
 *  project's opening price. */
export const queueTitleOf = (id: string, ledger: SaturationLedger | undefined): string =>
  ledger && ledger.occasions >= 2 && ledger.nextUsd !== null
    ? `${id}: next defect ≈ ${usd(ledger.nextUsd)}`
    : `${id}: under two passes, ranked at the opening price`;

const count = (n: number | null | undefined) => (n == null ? '–' : n.toLocaleString('en-US'));

/** The areas `scour run` would delve, in its order: each one's lines (what a pass reads) and defects already known,
 *  picking its area when clicked. Read-only for now. */
export function ScourQueue({ queue, ledgers, picked, onPick }: {
  queue: readonly string[]; ledgers: readonly SaturationLedger[]; picked: string | null; onPick: (id: string) => void;
}) {
  const byArea = new Map(ledgers.filter((l) => l.id === l.area).map((l) => [l.area, l]));
  return (
    <section className={s.pane} aria-label="Scour queue">
      <header className={s.head}>
        <h2 className={s.title}>Queue</h2>
        <span className={s.count}>{queue.length.toLocaleString('en-US')} areas</span>
      </header>
      {queue.length === 0 ? <p className={s.empty}>Nothing to delve: every area has stopped or is held.</p> : (
        <>
          <div className={`${s.pick} ${s.columns}`} aria-hidden="true">
            <span /><span>Area</span><span className={s.num}>Lines</span><span className={s.num}>Defects</span>
          </div>
          <ol className={s.list}>
            {queue.map((id, i) => {
              const ledger = byArea.get(id);
              return (
                <li key={id} className={id === picked ? `${s.row} ${s.picked}` : s.row}>
                  <button type="button" className={s.pick} title={queueTitleOf(id, ledger)} onClick={() => onPick(id)}>
                    <span className={s.num}>{i + 1}</span>
                    <span className={s.area}>{id}</span>
                    <span className={s.num}>{count(ledger?.lines)}</span>
                    <span className={s.num}>{count(ledger?.distinct)}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}
