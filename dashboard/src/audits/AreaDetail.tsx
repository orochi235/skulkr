import type { ReactNode } from 'react';
import { Badge } from '@weasel-js/ui/components/Badge';
import { DetailList, DetailRow } from '@weasel-js/ui/components/DetailList';
import { SidebarPanel } from '@weasel-js/ui/components/SidebarPanel';
import type { Grade } from '@weasel-js/theme';
import { STATUS_LABEL, correctedEstOf, correctedLeftOf, correctedText, lastPassOf, stageLabelOf } from './areaData';
import type { AreaStatus, AuditArea, AuditPass, AuditRun } from './skulkrMap.types';
import s from './AreaDetail.module.css';

const GRADE: Readonly<Record<AreaStatus, Grade | undefined>> = { unaudited: undefined, due: 'info', settled: 'success', tonight: 'danger' };

function Passes({ area }: { area: AuditArea }) {
  if (area.passes.length === 0) return <p className={s.hint}>No round has read it yet.</p>;
  return (
    <table className={s.table}>
      <thead>
        <tr><th>round</th><th className={s.vennCell}><Venn a="A" both={<span className={s.cap} role="img" aria-label="found by both">∩</span>} b="B" /></th><th>found</th><th>est.</th><th>left</th></tr>
      </thead>
      <tbody>
        {area.passes.map((p, i) => (
          <tr key={`${p.round}-${i}`}>
            <td>{p.round}{p.share !== undefined && <abbr className={s.share} title="the part of that pass's files this area holds; est. and left are scaled by it"> {Math.round(p.share * 100)}%</abbr>}</td><td className={s.vennCell}><Venn a={p.a - p.shared} both={p.shared} b={p.b - p.shared} /></td><td>{p.distinct}</td>
            <td>{p.est.toFixed(1)}<Corrected pass={p} value={correctedEstOf(p)} /></td><td>{p.left.toFixed(1)}<Corrected pass={p} value={correctedLeftOf(p)} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A calibrated figure after its raw one, where the map gives the pass one. */
function Corrected({ pass, value }: { pass: AuditPass; value: number }) {
  if (pass.leftCorrected === undefined) return null;
  return <span className={s.corrected} title="corrected by how much later passes found"> {correctedText(value)}</span>;
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

/** The area under the pointer, or else the one picked: its status, its counts, and every pass over it. */
export function AreaDetail({ area, holder }: { area: AuditArea | undefined; holder: AuditRun | undefined }) {
  const last = area && lastPassOf(area);
  return (
    <SidebarPanel title="Area">
      {!area ? <p className={s.hint}>Hover or click an area for its passes.</p> : (
        <div className={s.body}>
          <div className={s.id}>{area.id}</div>
          <div><Badge shape="pill" size="sm" variant="solid" {...(GRADE[area.status] ? { grade: GRADE[area.status] } : {})}>
            {holder ? `in round ${holder.round}` : STATUS_LABEL[area.status]}
          </Badge></div>
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
