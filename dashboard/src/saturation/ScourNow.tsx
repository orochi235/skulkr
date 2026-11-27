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

/** A live ledger's figures in one row: found and left, what a next pass looks like, then this run's passes (or a fix
 *  run's batches) against its cap, the spend, and how long it has held the ledger, last so its changing width moves
 *  nothing. */
export const liveStatsOf = (l: SaturationLedger, now: number): Stat[] => {
  const r = l.running!;
  const fix = r.does === 'fix';
  const done = fix ? r.jobs.length : l.occasions;
  return [
    ['found', String(l.distinct)],
    ['left (est.)', l.unseen === null ? '–' : String(Math.round(l.unseen)), STAT_TONE.estimate],
    ['next new', percent(l.nextNew), STAT_TONE.estimate],
    ['next defect', usdOrDash(l.nextUsd), STAT_TONE.estimate],
    ['limit', usd(l.limit.usd)],
    [fix ? 'batches' : 'passes', r.max ? `${done}/${r.max}` : String(done)],
    ['spent', usd(l.costUsd)],
    ['running', minutesSince(r.since, now), STAT_TONE.light],
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
            <div className={s.chart}><DelveChart ledger={l} max={r.max} live /></div>
            {r.does === 'fix' && l.fix && <div className={s.chart}><FixShelf shelf={l.fix} /></div>}
            {r.jobs.length > 0 && <ul className={s.jobs}>{r.jobs.map((j) => <JobLine key={j.key} job={j} />)}</ul>}
            {r.log.length > 0 && <pre className={s.log}>{timedLines(r.log, r.since).join('\n')}</pre>}
          </article>
        );
      })}
    </section>
  );
}
