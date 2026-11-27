import { minutesSince, minutesText } from '@dash/audits/runData';
import { DelveAbout, DelveChart } from './DelveChart';
import { FixShelf } from './FixShelf';
import { PassPill } from './PassPill';
import { STAT_TONE, StatRow, type Stat } from './LedgerHero';
import { percent, usd, usdOrDash } from './format';
import type { ScourJob, SaturationLedger } from './saturation.types';
import s from './ScourNow.module.css';

/**
 * The last `n` of `log`'s lines (each led by its ISO time), newest first, each led by the time since the line before
 * it (since `since`, when the process took the ledger, for the first), right-aligned: how long that pass took.
 */
export const timedLines = (log: readonly string[], since: string, n = 3): string[] => {
  const at = log.map((line) => Date.parse(line.slice(0, line.indexOf(' '))));
  const rows = log.map((line, i) => {
    const before = i ? at[i - 1]! : Date.parse(since);
    const took = Number.isFinite(at[i]) && Number.isFinite(before) ? minutesText((at[i]! - before) / 60_000) : '';
    return [took, line.replace(/^\S+ /, '')] as const;
  }).slice(-n).reverse();
  const width = Math.max(...rows.map(([took]) => took.length));
  return rows.map(([took, text]) => `${took.padStart(width)}  ${text}`);
};

/** A live delve's figures in one row: how long the process has held it (pinned to a width, as it changes), its passes
 *  against its cap, found, what a next pass looks like, and the spend, dollars set light. A fix run's are its own. */
export const liveStatsOf = (l: SaturationLedger, now: number): Stat[] => {
  const r = l.running!;
  const elapsed: Stat = ['elapsed', minutesSince(r.since, now), STAT_TONE.clock];
  if (r.does === 'fix') return [elapsed, ...fixStatsOf(l, r.max)];
  const light = STAT_TONE.light;
  return [
    elapsed,
    ['passes', String(l.occasions), undefined, r.max ? `up to ${r.max}` : undefined],
    ['found', String(l.distinct)],
    ['next new', percent(l.nextNew)],
    ['next defect', usdOrDash(l.nextUsd), light],
    ['limit', usd(l.limit.usd), light],
    ['spent', usd(l.costUsd), light],
  ];
};

/** A running fix run's tally from its own verdicts: batches back (of the run's), and its defects by where they stand. */
export const fixStatsOf = (l: SaturationLedger, max: number | null): Stat[] => {
  const shelf = l.fix;
  const run = shelf?.lastRun?.n;
  const mine = (id: string) => { const e = shelf?.statuses[id]; return e && e.run === run ? e : undefined; };
  const touched = shelf ? shelf.batches.filter((b) => b.defects.some((d) => mine(d.id))) : [];
  const back = touched.filter((b) => b.defects.every((d) => mine(d.id) && mine(d.id)!.status !== 'fixing')).length;
  const count = (...of: string[]) => Object.keys(shelf?.statuses ?? {}).filter((id) => of.includes(mine(id)?.status ?? '')).length;
  return [
    ['batches', String(back), undefined, max ? `of ${max}` : undefined],
    ['fixing', String(count('fixing'))],
    ['fixed', String(count('fixed'))],
    ['not a defect', String(count('not a defect'))],
    ['other', String(count('question', 'not fixed', 'duplicate', 'unread', 'flagged'))],
  ];
};

function JobLine({ job }: { job: ScourJob }) {
  return (
    <li className={s.job}>
      <span className={s.step}>{job.step ?? 'starting'}</span>
      <span className={s.progress}>{job.progress ? `${job.progress.done}/${job.progress.of}` : ''}</span>
      <span className={s.line}>{job.line ?? ''}</span>
    </li>
  );
}

/** Each ledger a live scour process holds: what it does, for how long, its jobs out, and its last log lines. */
export function ScourNow({ ledgers, onPick, now = Date.now() }: { ledgers: readonly SaturationLedger[]; onPick: (id: string) => void; now?: number }) {
  const live = ledgers.filter((l) => l.running);
  if (!live.length) return null;
  return (
    <section className={s.now} aria-label="Scouring now">
      {live.map((l) => {
        const r = l.running!;
        return (
          <article key={l.id} className={s.run}>
            <header className={s.head}>
              <span className={s.area} role="button" tabIndex={0} onClick={() => onPick(l.id)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onPick(l.id)}>{l.id}</span>
              {r.jobs.map((j) => <PassPill key={j.key} jobKey={j.key} />)}
              <span className={s.facts}>{r.does ?? 'held'} · pid {r.pid}</span>
              <span className={s.about}><DelveAbout ledger={l} /></span>
            </header>
            <div className={s.liveBox}><StatRow label="This scour" stats={liveStatsOf(l, now)} /></div>
            {r.does !== 'fix' && <div className={s.chart}><DelveChart ledger={l} max={r.max} live /></div>}
            {r.does === 'fix' && l.fix && <div className={s.chart}><FixShelf shelf={l.fix} /></div>}
            {r.jobs.length > 0 && <ul className={s.jobs}>{r.jobs.map((j) => <JobLine key={j.key} job={j} />)}</ul>}
            {r.log.length > 0 && <pre className={s.log}>{timedLines(r.log, r.since).join('\n')}</pre>}
          </article>
        );
      })}
    </section>
  );
}
