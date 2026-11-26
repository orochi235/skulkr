import { minutesSince } from '@dash/audits/runData';
import type { ScourJob, SaturationLedger } from './saturation.types';
import s from './ScourNow.module.css';

/** A log line without its leading ISO time. */
const untimed = (line: string) => line.replace(/^\S+ /, '');

function JobLine({ job }: { job: ScourJob }) {
  return (
    <li className={s.job}>
      <code className={s.key}>{job.key}</code>
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
              <span className={s.facts}>
                {r.does ?? 'held'} · pid {r.pid} · {minutesSince(r.since, now)} · {r.max ? `${l.occasions}/${r.max}` : l.occasions} occasions
              </span>
            </header>
            {r.jobs.length > 0 && <ul className={s.jobs}>{r.jobs.map((j) => <JobLine key={j.key} job={j} />)}</ul>}
            {r.log.length > 0 && <pre className={s.log}>{r.log.slice(-3).map(untimed).join('\n')}</pre>}
          </article>
        );
      })}
    </section>
  );
}
