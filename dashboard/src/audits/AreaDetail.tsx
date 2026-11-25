import { useState, type ReactNode } from 'react';
import { Badge } from '@weasel-js/ui/components/Badge';
import { Button } from '@weasel-js/ui/components/Button';
import { DetailList, DetailRow } from '@weasel-js/ui/components/DetailList';
import { SidebarPanel } from '@weasel-js/ui/components/SidebarPanel';
import type { Grade } from '@weasel-js/theme';
import { STATUS_LABEL, chapmanIn, correctedEstOf, fixedIn, formatCount, foundIn, correctedLeftOf, correctedText, correctionShows, lastPassOf, roundCountOf, stageLabelOf } from './areaData';
import type { AreaStatus, AuditArea, AuditPass, AuditRun } from './skulkrMap.types';
import s from './AreaDetail.module.css';

const GRADE: Readonly<Record<AreaStatus, Grade | undefined>> = { unaudited: undefined, due: 'info', settled: 'success', tonight: 'danger' };

const CORRECTED_TITLE = 'corrected by how much later passes found';

/** Every pass over the area, each figure in its own column so the decimal points line up: the corrected figures get
 *  one where any pass has them. */
function Passes({ area }: { area: AuditArea }) {
  if (area.passes.length === 0) return <p className={s.hint}>No round has read it yet.</p>;
  const showsEst = (p: AuditPass) => p.leftCorrected !== undefined && correctionShows(p.est, correctedEstOf(p));
  const showsLeft = (p: AuditPass) => correctionShows(p.left, p.leftCorrected);
  const corrected = area.passes.some((p) => showsEst(p) || showsLeft(p));
  const fixes = area.passes.some((p) => p.fixed !== undefined);
  const fix = (shows: boolean, value: number) => (shows ? correctedText(value) : '');
  return (
    <table className={s.table}>
      <thead>
        <tr>
          <th>round</th>
          <th className={s.vennCell}><Venn a="A" both={<span className={s.cap} role="img" aria-label="found by both">∩</span>} b="B" /></th>
          <th>found</th>{fixes && <th>fixed</th>}
          <th>est.</th>{corrected && <th className={s.side}><abbr className={s.muted} title={CORRECTED_TITLE}>≈</abbr></th>}
          <th>left</th>{corrected && <th className={s.side}><abbr className={s.muted} title={CORRECTED_TITLE}>≈</abbr></th>}
        </tr>
      </thead>
      <tbody>
        {area.passes.map((p, i) => (
          <tr key={`${p.round}-${i}`}>
            <td>{p.round}</td>
            <td className={s.vennCell}><Venn a={p.a - p.shared} both={p.shared} b={p.b - p.shared} /></td>
            <td>{p.distinct}</td>{fixes && <td>{p.fixed ?? ''}</td>}
            <td>{p.est.toFixed(1)}</td>{corrected && <td className={`${s.side} ${s.muted}`}>{fix(showsEst(p), correctedEstOf(p))}</td>}
            <td>{p.left.toFixed(1)}</td>{corrected && <td className={`${s.side} ${s.muted}`}>{fix(showsLeft(p), correctedLeftOf(p))}</td>}
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

/** Pins or unpins an area into every round until it settles (`onPin`), saying why when the server refuses. */
function PinToggle({ area, onPin }: { area: AuditArea; onPin: (id: string, on: boolean) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ id: string; text: string } | null>(null);
  const pinned = area.pinned ?? false;
  const toggle = () => {
    setBusy(true);
    setError(null);
    onPin(area.id, !pinned).catch((e: Error) => setError({ id: area.id, text: e.message })).finally(() => setBusy(false));
  };
  return (
    <div className={s.pin}>
      <Button size="sm" variant="ghost" pressed={pinned} loading={busy} disabled={busy} onClick={toggle}
        title={pinned ? 'Stop forcing it into every round' : 'Pick it in every round until it settles'}>
        {pinned ? 'Pinned' : 'Pin'}
      </Button>
      {error?.id === area.id && <span className={s.pinError} role="alert">{error.text}</span>}
    </div>
  );
}

/** The area under the pointer, or else the one picked: its status, its counts, and every pass over it; as of a past
 *  round (`areasAsOf`), only whether it had been audited by then. `onPin`, where the page can pin, gives it a pin toggle. */
export function AreaDetail({ area, holder, asOf = null, onPin }: {
  area: AuditArea | undefined; holder: AuditRun | undefined; asOf?: number | null; onPin?: ((id: string, on: boolean) => Promise<void>) | undefined;
}) {
  const last = area && lastPassOf(area);
  const fixed = area && fixedIn(area);
  const chapman = area && area.passes.length > 0 ? chapmanIn(area) : null;
  const grade = area && asOf === null ? GRADE[area.status] : undefined;
  const badge = !area ? '' : asOf !== null ? `${area.status === 'unaudited' ? 'not audited' : 'audited'} by round ${asOf}`
    : holder ? `in round ${holder.round}` : STATUS_LABEL[area.status];
  return (
    <SidebarPanel title="Area">
      {!area ? <p className={s.hint}>Hover or click an area for its passes.</p> : (
        <div className={s.body}>
          <div className={s.id}>{area.id}</div>
          <div className={s.status}>
            <Badge shape="pill" size="sm" variant="solid" {...(grade ? { grade } : {})}>{badge}</Badge>
            {onPin && asOf === null && <PinToggle area={area} onPin={onPin} />}
          </div>
          <DetailList values="figures" columns="auto">
            <DetailRow label="source files">{area.files}</DetailRow>
            <DetailRow label="passes">{roundCountOf(area)}</DetailRow>
            {area.passes.length > 0 && <DetailRow label="total found">{formatCount(Math.round(foundIn(area)))}</DetailRow>}
            {chapman && <DetailRow label="total by Chapman's estimate">{formatCount(Math.round(chapman.est))}{correctionShows(chapman.est, chapman.corrected) && ` (${correctedText(chapman.corrected)} corrected)`}</DetailRow>}
            {fixed && <DetailRow label={fixed.reported < area.passes.length ? `total fixed, ${fixed.reported} of ${area.passes.length} passes` : 'total fixed'}>{formatCount(Math.round(fixed.fixed))}</DetailRow>}
            {area.queue !== null && <DetailRow label="queue position">{area.queue}</DetailRow>}
            {area.stage && <DetailRow label="this run">{stageLabelOf(area.stage)}</DetailRow>}
            {last && <DetailRow label={`left after round ${last.round}`}>{last.left.toFixed(1)}{correctionShows(last.left, last.leftCorrected) && ` (${correctedText(last.leftCorrected!)} corrected)`}</DetailRow>}
            {area.depletion && <DetailRow label={`left by depletion, ${area.depletion.rounds} ${area.depletion.rounds === 1 ? 'round' : 'rounds'}`}>{area.depletion.unbounded ? 'unbounded' : `${area.depletion.left} (≤${area.depletion.leftUpper}, ${Math.round((area.depletion.next ?? 0) * 100)}% next)`}</DetailRow>}
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
