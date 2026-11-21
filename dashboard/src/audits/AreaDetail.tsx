import type { ReactNode } from 'react';
import { Badge } from '@weasel-js/ui/components/Badge';
import { DetailList, DetailRow } from '@weasel-js/ui/components/DetailList';
import { SidebarPanel } from '@weasel-js/ui/components/SidebarPanel';
import type { Grade } from '@weasel-js/theme';
import { STATUS_LABEL, correctedEstOf, correctedLeftOf, correctedText, lastPassOf, stageLabelOf } from './areaData';
import type { AreaStatus, AuditArea, AuditPass, AuditRun } from './skulkrMap.types';
import s from './AreaDetail.module.css';

const GRADE: Readonly<Record<AreaStatus, Grade | undefined>> = { unaudited: undefined, due: 'info', settled: 'success', tonight: 'danger' };

const SHARE_TITLE = "the part of that pass's files this area holds; est. and left are scaled by it";
const CORRECTED_TITLE = 'corrected by how much later passes found';

/** Every pass over the area, each figure in its own column so the decimal points line up: the share and the corrected
 *  figures each get one where any pass has them. */
function Passes({ area }: { area: AuditArea }) {
  if (area.passes.length === 0) return <p className={s.hint}>No round has read it yet.</p>;
  const shared = area.passes.some((p) => p.share !== undefined);
  const corrected = area.passes.some((p) => p.leftCorrected !== undefined);
  const fix = (p: AuditPass, value: number) => (p.leftCorrected === undefined ? '' : correctedText(value));
  return (
    <table className={s.table}>
      <thead>
        <tr>
          <th>round</th>
          {shared && <th className={s.side}><abbr className={s.muted} title={SHARE_TITLE}>share</abbr></th>}
          <th className={s.vennCell}><Venn a="A" both={<span className={s.cap} role="img" aria-label="found by both">∩</span>} b="B" /></th>
          <th>found</th>
          <th>est.</th>{corrected && <th className={s.side}><abbr className={s.muted} title={CORRECTED_TITLE}>≈</abbr></th>}
          <th>left</th>{corrected && <th className={s.side}><abbr className={s.muted} title={CORRECTED_TITLE}>≈</abbr></th>}
        </tr>
      </thead>
      <tbody>
        {area.passes.map((p, i) => (
          <tr key={`${p.round}-${i}`}>
            <td>{p.round}</td>
            {shared && <td className={`${s.side} ${s.muted}`}>{p.share === undefined ? '' : `${Math.round(p.share * 100)}%`}</td>}
            <td className={s.vennCell}><Venn a={p.a - p.shared} both={p.shared} b={p.b - p.shared} /></td>
            <td>{p.distinct}</td>
            <td>{p.est.toFixed(1)}</td>{corrected && <td className={`${s.side} ${s.muted}`}>{fix(p, correctedEstOf(p))}</td>}
            <td>{p.left.toFixed(1)}</td>{corrected && <td className={`${s.side} ${s.muted}`}>{fix(p, correctedLeftOf(p))}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The findings no fixer has acted on, each with the round that reported it. */
function OpenFindings({ area }: { area: AuditArea }) {
  if (!area.open?.length) return null;
  return (
    <ul className={s.open} aria-label="open findings">
      {area.open.map((f, i) => (
        <li key={`${f.round}-${i}`} title={f.where}><span className={s.openRound}>r{f.round}</span> {f.claim}</li>
      ))}
    </ul>
  );
}

/** Reviewer A's findings and B's as two pills overlapping in the middle: only A's, the ones both found, only B's. */
function Venn({ a, both, b }: { a: ReactNode; both: ReactNode; b: ReactNode }) {
  return (
    <div className={s.venn}>
      <span className={s.pillA} aria-hidden="true" />
      <span className={s.pillB} aria-hidden="true" />
      <span>{a}</span><span className={s.both}>{both}</span><span>{b}</span>
    </div>
  );
}

/** The area under the pointer, or else the one picked: its status, its counts, and every pass over it; as of a past
 *  round (`areasAsOf`), only whether it had been audited by then. */
export function AreaDetail({ area, holder, asOf = null }: { area: AuditArea | undefined; holder: AuditRun | undefined; asOf?: number | null }) {
  const last = area && lastPassOf(area);
  const grade = area && asOf === null ? GRADE[area.status] : undefined;
  const badge = !area ? '' : asOf !== null ? `${area.status === 'unaudited' ? 'not audited' : 'audited'} by round ${asOf}`
    : holder ? `in round ${holder.round}` : STATUS_LABEL[area.status];
  return (
    <SidebarPanel title="Area">
      {!area ? <p className={s.hint}>Hover or click an area for its passes.</p> : (
        <div className={s.body}>
          <div className={s.id}>{area.id}</div>
          <div><Badge shape="pill" size="sm" variant="solid" {...(grade ? { grade } : {})}>{badge}</Badge></div>
          <DetailList values="figures" columns="auto">
            <DetailRow label="source files">{area.files}</DetailRow>
            <DetailRow label="passes">{area.passes.length}</DetailRow>
            {area.queue !== null && <DetailRow label="queue position">{area.queue}</DetailRow>}
            {area.stage && <DetailRow label="this run">{stageLabelOf(area.stage)}</DetailRow>}
            {last && <DetailRow label={`left after round ${last.round}`}>{last.left.toFixed(1)}{last.leftCorrected !== undefined && ` (${correctedText(last.leftCorrected)} corrected)`}</DetailRow>}
            {area.staleLines ? <DetailRow label="lines changed since">{area.staleLines.toLocaleString()}</DetailRow> : null}
            {area.openFindings ? <DetailRow label="open findings">{area.openFindings}</DetailRow> : null}
          </DetailList>
          <OpenFindings area={area} />
          <Passes area={area} />
        </div>
      )}
    </SidebarPanel>
  );
}
