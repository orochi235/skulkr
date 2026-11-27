import { minutesText } from '@dash/audits/runData';
import { elapsedReading, type Stamp } from '@dash/audits/liveTime';
import { duration } from '@weasel-js/quantity';
import { LiveQuantity } from '@weasel-js/ui/components/LiveQuantity';
import { DefectCallout, useDefectCallout } from './DefectCallout';
import { DelveAbout, DelveChart } from './DelveChart';
import { FixShelf } from './FixShelf';
import { PassPill } from './PassPill';
import { STAT_TONE, StatRow, limitStatOf, nextDefectStatOf, shelfToneOf, type Stat } from './LedgerHero';
import { percent, usd } from './format';
import type { ScourJob, SaturationLedger, Tally } from './saturation.types';
import s from './ScourNow.module.css';

/** What each live job's log said last (`recent`), newest first, each led by the job's key: a run's log says nothing
 *  between batches or passes, so these show it working. Untimed, since a job's log lines carry no time. */
export const jobLinesOf = (jobs: readonly ScourJob[]): string[] =>
  jobs.flatMap((j) => [...(j.recent ?? [])].reverse().map((line) => `${j.key.padEnd(9)} ${line}`));

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

const HELD = duration();

/** A live delve's figures in one row: how long the process has held it, counting on from `stamp`, its size in
 *  thousands of lines and files, the pass under way (its cap in a tooltip), found, what a next pass looks like, and
 *  the spend, dollars set light. A fix run's are its own. */
export const liveStatsOf = (l: SaturationLedger, stamp: Stamp): Stat[] => {
  const r = l.running!;
  const held = elapsedReading(r.since, null, true, stamp);
  const elapsed: Stat = ['elapsed', held ? <LiveQuantity reading={held} display={HELD} /> : '', STAT_TONE.clock];
  if (r.does === 'fix') return [elapsed, ...fixStatsOf(l, r.max)];
  const light = STAT_TONE.light;
  return [
    elapsed,
    ['kloc', l.lines === null ? '–' : (l.lines / 1000).toFixed(1), light],
    ['files', String(l.files), light],
    ['pass', String(l.occasions + 1), undefined, r.max ? `up to ${r.max}` : undefined],
    ['found', String(l.distinct)],
    ['next new', percent(l.nextNew)],
    nextDefectStatOf(l, light),
    limitStatOf(l, light),
    ['spent', usd(l.costUsd), light],
  ];
};

/** A running fix run's tally from its own verdicts: batches back of the run's, and its defects by where they stand,
 *  those out in a batch by stage (`checking` reads as verifying); a count at 0 is left out. */
export const fixStatsOf = (l: SaturationLedger, max: number | null): Stat[] => {
  const shelf = l.fix;
  const run = shelf?.lastRun?.n;
  const mine = (id: string) => { const e = shelf?.statuses[id]; return e && e.run === run ? e : undefined; };
  const touched = shelf ? shelf.batches.filter((b) => b.defects.some((d) => mine(d.id))) : [];
  const back = touched.filter((b) => b.defects.every((d) => mine(d.id) && mine(d.id)!.status !== 'fixing')).length;
  const count = (...of: string[]) => Object.keys(shelf?.statuses ?? {}).filter((id) => of.includes(mine(id)?.status ?? '')).length;
  const at = (stage: string) => String(Object.keys(shelf?.statuses ?? {}).filter((id) => mine(id)?.status === 'fixing' && mine(id)?.stage === stage).length);
  const stats: Stat[] = [
    ['batch', max ? `${back}/${max}` : String(back), STAT_TONE.light],
    ['analyzing', at('analyzing'), shelfToneOf('analyzing')],
    ['writing', at('writing'), shelfToneOf('writing')],
    ['written', at('written'), shelfToneOf('written')],
    ['verifying', at('checking'), shelfToneOf('checking')],
    ['repairing', at('repairing'), shelfToneOf('repairing')],
    ['fixed', String(count('fixed')), shelfToneOf('fixed')],
    ['not a defect', String(count('not a defect')), shelfToneOf('not a defect')],
    ['other', String(count('question', 'not fixed', 'duplicate', 'unread', 'flagged'))],
  ];
  return stats.filter(([word, value]) => word === 'batch' || value !== '0');
};

/** A job's step in words: a fix batch's `fixing`, `verifying` (on the fleet where it went there) or `repairing N`; any
 *  other step by its own name. */
export const stepWordsOf = (job: ScourJob): string => {
  const step = job.step;
  if (!step) return 'starting';
  if (step === 'fix') return 'fixing';
  if (step.startsWith('verify')) return job.fleet ? 'verifying on fleet' : 'verifying';
  const repair = /^repair-(\d+)$/.exec(step);
  return repair ? `repairing ${repair[1]}` : step;
};

/** A tally as `tests 24/24, 1 failed`; empty without one. */
export const tallyText = (word: string, t: Tally | undefined): string =>
  t ? `${word} ${t.done.toLocaleString('en-US')}/${t.total.toLocaleString('en-US')}${t.failed ? `, ${t.failed} failed` : ''}` : '';

function JobLine({ job }: { job: ScourJob }) {
  const tallies = [tallyText('tests', job.tests), tallyText('checks', job.checks)].filter(Boolean).join(' · ');
  return (
    <li className={s.job}>
      <span className={s.step}>{job.key} {stepWordsOf(job)}</span>
      <span className={s.progress}>{job.progress ? `${job.progress.done.toLocaleString('en-US')}/${job.progress.of.toLocaleString('en-US')}` : ''}</span>
      <span className={s.line}>{tallies ? <span className={s.tallies}>{tallies}</span> : null}{job.line ?? ''}</span>
    </li>
  );
}

/** What a live scour process does, as its pill's color. */
const DOES: Readonly<Record<string, string>> = { delve: s.delve!, fix: s.fix!, held: s.held! };

/** One live scour process's ledger: what it does, for how long (counting on from `stamp`), its jobs out, its last log
 *  lines, and its chart, a hovered tile's defect called out over it and a clicked one picked in the ledger's own pane. */
function LiveRun({ ledger: l, onPick, onPickDefect, stamp }: {
  ledger: SaturationLedger; onPick: (id: string) => void; onPickDefect: (area: string, id: string) => void; stamp: Stamp;
}) {
  const r = l.running!;
  const { hostEvents, traced, setTraced, at } = useDefectCallout<HTMLElement>();
  const pickDefect = (id: string) => onPickDefect(l.id, id);
  return (
    <article className={s.run} {...hostEvents}>
      <header className={s.head}>
        <span className={`${s.does} ${DOES[r.does ?? 'held'] ?? s.held}`}>{r.does ?? 'held'}</span>
        <span className={s.area} role="button" tabIndex={0} onClick={() => onPick(l.id)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onPick(l.id)}>{l.id}</span>
        {r.jobs.map((j) => <PassPill key={j.key} jobKey={j.key} />)}
        <span className={s.facts}>pid {r.pid}</span>
        <span className={s.about}><DelveAbout ledger={l} /></span>
      </header>
      <div className={s.figures}>
        <div className={s.liveBox}><StatRow label="This scour" stats={liveStatsOf(l, stamp)} /></div>
        {r.does === 'fix' && l.fix && <div className={s.chart}><FixShelf shelf={l.fix} onPickDefect={pickDefect} traced={traced} onTrace={setTraced} /></div>}
      </div>
      {r.does !== 'fix' && <div className={s.chart}><DelveChart ledger={l} max={r.max} live onPickDefect={pickDefect} traced={traced} onTrace={setTraced} /></div>}
      {r.jobs.length > 0 && <ul className={s.jobs}>{r.jobs.map((j) => <JobLine key={j.key} job={j} />)}</ul>}
      {(r.log.length > 0 || r.jobs.some((j) => j.recent?.length)) && <pre className={s.log}>{[...jobLinesOf(r.jobs), ...timedLines(r.log, r.since)].join('\n')}</pre>}
      <DefectCallout ledger={l} id={traced} at={at} />
    </article>
  );
}

/** Each ledger a live scour process holds, as a `LiveRun`: `onPick` picks its area, `onPickDefect` one of its defects. */
export function ScourNow({ ledgers, stamp, onPick, onPickDefect }: {
  ledgers: readonly SaturationLedger[]; stamp: Stamp; onPick: (id: string) => void; onPickDefect: (area: string, id: string) => void;
}) {
  const live = ledgers.filter((l) => l.running);
  if (!live.length) return null;
  return (
    <section className={s.now} aria-label="Scouring now">
      {live.map((l) => <LiveRun key={l.id} ledger={l} onPick={onPick} onPickDefect={onPickDefect} stamp={stamp} />)}
    </section>
  );
}
