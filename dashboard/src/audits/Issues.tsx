import type { ReactNode } from 'react';
import { gateRunsOf } from './sharedLane';
import type { AuditArea, AuditLeftOut, AuditRun, LaneStepKey } from './skulkrMap.types';
import s from './Issues.module.css';

/** One thing still wrong: what it says, what it says in full on hover, and the area it names, where it names one. */
interface Issue {
  readonly key: string;
  readonly text: string;
  readonly title?: string;
  readonly area?: string;
  readonly count?: number;
}

/** The kinds of issue, in the order the panel lists them: the most urgent first. */
interface IssueGroup {
  readonly id: string;
  readonly label: string;
  readonly items: readonly Issue[];
}

const STEP_NAMES: Readonly<Record<LaneStepKey, string>> = { A: 'review A', B: 'review B', match: 'match', fix: 'fix', repair: 'verify', patch: 'patch' };

/** What a running or unmerged round's gate runs fail now, a file each, with its failing tests on hover. */
const gateFailuresIn = (runs: readonly AuditRun[]): Issue[] => runs.flatMap((run) => gateRunsOf(run).flatMap((g) => {
  const failures = run.failures?.[g.id];
  if (!failures) return [];
  const label = gateRunsOf(run).length > 1 ? `${g.label}: ` : '';
  return failures.list.map((f) => ({
    key: `gate ${run.round} ${g.id} ${f.file}`, text: `${label}${f.file}`, count: f.count,
    title: [`round ${run.round}, ${g.label}`, ...f.tests.map((t) => `${t.test}: ${t.error}`)].join('\n'),
  }));
}));

/** The steps that failed in a running round's lanes, with why. */
const failedStepsIn = (runs: readonly AuditRun[]): Issue[] => runs.filter((r) => r.running).flatMap((run) => run.lanes.flatMap((lane) =>
  (Object.entries(lane.steps) as [LaneStepKey, { state: string; why?: string } | undefined][])
    .filter(([, step]) => step?.state === 'failed')
    .map(([key, step]) => ({
      key: `step ${run.round} ${lane.id} ${key}`, area: lane.id, text: `${lane.id}: ${STEP_NAMES[key]} failed${step?.why ? `, ${step.why}` : ''}`,
      title: `round ${run.round}, ${lane.id}, ${STEP_NAMES[key]}: ${step?.why ?? 'failed'}`,
    }))));

/** The branches batches have left out and still retry. */
const leftOutIn = (leftOut: readonly AuditLeftOut[]): Issue[] => leftOut.map((e) => ({
  key: `left ${e.round} ${e.area}`, area: e.area, text: `${e.area}: left out of round ${e.round}`, title: e.why,
}));

/** The areas holding findings no fixer has acted on, most first. */
const openFindingsIn = (areas: readonly AuditArea[]): Issue[] => areas
  .filter((a) => (a.openFindings ?? 0) > 0)
  .sort((x, y) => (y.openFindings ?? 0) - (x.openFindings ?? 0) || x.id.localeCompare(y.id))
  .map((a) => ({ key: `open ${a.id}`, area: a.id, text: a.id, count: a.openFindings ?? 0, title: (a.open ?? []).map((f) => `round ${f.round}: ${f.claim}`).join('\n') }));

/** Every issue the map knows of, grouped, empty groups left out. */
export const issueGroupsOf = (areas: readonly AuditArea[], runs: readonly AuditRun[], leftOut: readonly AuditLeftOut[]): IssueGroup[] => [
  { id: 'gate', label: 'Failing in the gate', items: gateFailuresIn(runs) },
  { id: 'steps', label: 'Failed steps', items: failedStepsIn(runs) },
  { id: 'left', label: 'Left out of a batch', items: leftOutIn(leftOut) },
  { id: 'open', label: 'Open findings', items: openFindingsIn(areas) },
].filter((g) => g.items.length > 0);

/** What is still wrong, grouped by kind: what the gate fails, failed steps, left-out branches, open findings. An item
 *  naming an area picks its cell, and lights it while hovered. */
export function Issues({ areas, runs, leftOut, onPick, onLight }: {
  areas: readonly AuditArea[]; runs: readonly AuditRun[]; leftOut: readonly AuditLeftOut[];
  onPick: (id: string) => void; onLight: (id: string | null) => void;
}) {
  const groups = issueGroupsOf(areas, runs, leftOut);
  const row = (issue: Issue): ReactNode => {
    const { area } = issue;
    const text = <span className={s.text}>{issue.text}</span>;
    return (
      <li key={issue.key} className={s.row} title={issue.title}>
        {area ? (
          <button
            type="button" className={s.pick} onClick={() => onPick(area)}
            onPointerEnter={() => onLight(area)} onPointerLeave={() => onLight(null)} onFocus={() => onLight(area)} onBlur={() => onLight(null)}
          >
            {text}
          </button>
        ) : text}
        {issue.count !== undefined && <span className={s.count}>{issue.count}</span>}
      </li>
    );
  };
  return (
    <section className={s.box} aria-label="Issues">
      <div className={s.panel}>
        {groups.length === 0 ? <p className={s.empty}>Nothing failing, left out, or open.</p> : groups.map((g) => (
          <section key={g.id} className={s.group} aria-label={g.label}>
            <h3 className={s.groupHeading}>{g.label}</h3>
            <ul className={s.list}>{g.items.map(row)}</ul>
          </section>
        ))}
      </div>
    </section>
  );
}
