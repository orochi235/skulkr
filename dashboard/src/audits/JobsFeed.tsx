import { InlineMarkdown } from '@weasel-js/ui/components/InlineMarkdown';
import { useState } from 'react';
import { Badge } from '@weasel-js/ui/components/Badge';
import { SidebarPanel } from '@weasel-js/ui/components/SidebarPanel';
import type { Grade } from '@weasel-js/theme';
import { logTailsOf, recentJobsOf, type Job, type LogTail, type RunJob } from './runData';
import type { AuditRun } from './skulkrMap.types';
import s from './JobsFeed.module.css';

function gradeOf(job: Job): Grade | undefined {
  if (job.bad) return 'danger';
  if (job.kind === 'fix' || job.kind === 'patch') return 'success';
  return job.kind === 'review' || job.kind === 'match' ? 'info' : undefined;
}

/** The jobs each run's log reports finished, newest first; a row that arrived since the last poll flashes. */
export function JobsFeed({ runs, onLight }: { runs: readonly AuditRun[]; onLight: (id: string | null) => void }) {
  const [shown, setShown] = useState<{ runs: readonly AuditRun[]; tails: ReadonlyMap<number, LogTail>; jobs: readonly RunJob[]; fresh: ReadonlySet<string> }>(() => {
    const tails = logTailsOf(new Map(), runs);
    return { runs, tails, jobs: recentJobsOf(runs, undefined, tails), fresh: new Set() };
  });
  if (shown.runs !== runs) {
    const tails = logTailsOf(shown.tails, runs);
    const next = recentJobsOf(runs, undefined, tails);
    const before = new Set(shown.jobs.map((j) => j.key));
    setShown({ runs, tails, jobs: next, fresh: new Set(next.filter((j) => !before.has(j.key)).map((j) => j.key)) });
  }
  const { jobs } = shown;
  return (
    <SidebarPanel title="Recent jobs">
      {jobs.length === 0 ? <p className={s.hint}>No job has come back yet.</p> : (
        <div className={s.feed}>
          <table className={s.table}>
            <thead>
              <tr>
                <th className={s.l}>job</th><th>round</th><th className={s.l}>area</th><th className={s.l}>result</th>
                <th className={s.l}>node</th><th>min</th><th>M weighted tokens</th><th>of</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map(({ key, round, job }) => {
                const grade = gradeOf(job);
                return (
                  <tr key={key} className={shown.fresh.has(key) ? s.fresh : undefined}>
                    <td className={s.l}>
                      <Badge shape="pill" size="xs" variant={job.kind === 'fix' || job.kind === 'patch' ? 'solid' : 'outline'} {...(grade ? { grade } : {})}>
                        {job.label}
                      </Badge>
                    </td>
                    <td>{round}</td>
                    <td
                      className={`${s.l} ${s.area}`}
                      {...(job.area ? { onPointerEnter: () => onLight(job.area), onPointerLeave: () => onLight(null) } : {})}
                    >
                      {job.area}
                    </td>
                    <td className={`${s.l} ${s.what}`}><InlineMarkdown text={job.what} /></td>
                    <td className={`${s.l} ${s.area}`}>{job.node ?? ''}</td>
                    <td>{job.minutes !== undefined ? job.minutes.toFixed(1) : ''}</td>
                    <td>{job.tokens !== undefined ? job.tokens.toFixed(2) : ''}</td>
                    <td>{job.of ?? ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </SidebarPanel>
  );
}
