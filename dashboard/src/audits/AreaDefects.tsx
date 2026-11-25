import { Icon } from '@weasel-js/ui/components/Icon';
import { InlineMarkdown } from '@weasel-js/ui/components/InlineMarkdown';
import { Badge } from '@weasel-js/ui/components/Badge';
import { Popover, PopoverDialog } from '@weasel-js/ui/components/Popover';
import { SidebarPanel } from '@weasel-js/ui/components/SidebarPanel';
import { Focusable, Tooltip, TooltipTrigger } from '@weasel-js/ui/components/Tooltip';
import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Grade } from '@weasel-js/theme';
import { icon } from '@dash/icons.gen';
import { useAreaDefects } from './useAreaDefects';
import type { AuditDefect } from './skulkrMap.types';
import { EXTRA } from './runData';
import s from './AreaDefects.module.css';

const GRADE: Readonly<Record<AuditDefect['verdict'], Grade | undefined>> = {
  fixed: 'success', 'not a defect': undefined, duplicate: undefined, question: 'warn', 'not fixed': 'danger', open: 'info', reviewing: undefined,
};

/** A verdict as its badge reads, where that differs from the fixer's word for it. */
const LABEL: Readonly<Partial<Record<AuditDefect['verdict'], string>>> = { 'not a defect': "won't fix" };

/** Who listed a defect, both reviewers as `∩`; a carried one, an earlier round's that no fixer had acted on, with a clock turned back. */
function Source({ from }: { from: string }) {
  if (from === 'A+B') return <span className={s.from} title="both reviewers">∩</span>;
  if (from === 'extra') return <span className={s.from} title="one the fixer found itself, beyond the reviewers' lists">{EXTRA}</span>;
  if (from !== 'carried') return <span className={s.from}>{from}</span>;
  return (
    <span className={s.from} title="an earlier round's finding no fixer had acted on, handed to this round's fixer">
      <Icon name={icon('ui:commitHistory')} size={12} />carried
    </span>
  );
}

/** Whether `node`'s one line of text runs past its box, measured again whenever the box changes size. Takes the node
 *  itself rather than a ref, so the measure follows the text when wrapping it in a trigger mounts it anew. */
function useClipped(node: HTMLElement | null, text: string): boolean {
  const [clipped, setClipped] = useState(false);
  useLayoutEffect(() => {
    if (!node) return undefined;
    const measure = () => setClipped(node.scrollWidth > node.clientWidth + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const seen = new ResizeObserver(measure);
    seen.observe(node);
    return () => seen.disconnect();
  }, [node, text]);
  return clipped;
}

/** One defect as a table row: its verdict, with `source` who listed it, and its claim on one line. Where the claim is cut off, or the
 *  fixer left a note, hovering it shows the whole of both, and pressing it opens them. */
function Defect({ d, source }: { d: AuditDefect; source: boolean }) {
  const grade = GRADE[d.verdict];
  const claim = useRef<HTMLDivElement | null>(null);
  const [claimNode, setClaimNode] = useState<HTMLDivElement | null>(null);
  const clipped = useClipped(claimNode, d.claim);
  const [open, setOpen] = useState(false);
  const more = clipped || !!d.note;
  const toggle = () => setOpen((was) => !was);
  const whole = (
    <div className={s.details}>
      <div className={s.full}><InlineMarkdown text={d.claim} /></div>
      {d.note && <div className={s.note}><InlineMarkdown text={d.note} /></div>}
    </div>
  );
  const claimRef = useCallback((el: HTMLDivElement | null) => {
    claim.current = el;
    setClaimNode(el);
  }, []);
  const text = <div ref={claimRef} className={s.claim}><InlineMarkdown text={d.claim} /></div>;
  return (
    <tr data-verdict={d.verdict}>
      <td className={s.verdict}>
        <Badge shape="pill" size="xs" variant={d.verdict === 'fixed' ? 'solid' : 'outline'} {...(grade ? { grade } : {})}>{LABEL[d.verdict] ?? d.verdict}</Badge>
      </td>
      {source && <td className={s.source}>{d.from && <Source from={d.from} />}</td>}
      <td className={s.claimCell}>
        {!more ? text : (
          <>
            <TooltipTrigger>
              <Focusable>
                <div
                  className={s.more} role="button" tabIndex={0} aria-haspopup="dialog" aria-expanded={open}
                  onClick={toggle}
                  onKeyDown={(e: KeyboardEvent) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggle();
                    }
                  }}
                >
                  {text}
                </div>
              </Focusable>
              <Tooltip placement="bottom">{whole}</Tooltip>
            </TooltipTrigger>
            <Popover triggerRef={claim} open={open} onOpenChange={setOpen} placement="bottom" offset={4}>
              <PopoverDialog aria-label="Defect details">{whole}</PopoverDialog>
            </Popover>
          </>
        )}
      </td>
    </tr>
  );
}

/** What each round found in the picked area and what became of each: the fixer's report once it has one. Who listed
 *  each defect shows only for a round not yet recorded. */
export function AreaDefects({ urlOf, id, version, eventsUrl = null }: { urlOf: (id: string) => string; id: string; version: string; eventsUrl?: string | null }) {
  const state = useAreaDefects(urlOf, id, version, eventsUrl);
  return (
    <SidebarPanel title="Defects">
      <div className={s.id}>{id}</div>
      {state.status === 'loading' && <p className={s.hint}>Reading its rounds…</p>}
      {(state.status === 'failed' || state.status === 'ready' && state.error) && <p className={s.hint}>Couldn&apos;t read them: {state.error}</p>}
      {state.status === 'ready' && state.rounds.length === 0 && <p className={s.hint}>No round has read it yet.</p>}
      {state.status === 'ready' && state.rounds.map((r) => (
        <section key={r.round} className={s.round}>
          <h3 className={s.title}>
            Round {r.round}
            <span className={s.hint}>{r.recorded ? '' : r.fixed ? ' · not merged yet' : r.commits ? ' · its fixer stopped before reporting' : r.reviewing ? ' · its reviewers are still finding' : ' · no fixer report yet'}</span>
          </h3>
          {r.commits && r.commits.length > 0 && (
            <>
              <p className={s.hint}>Its commits:</p>
              <ul className={s.commits}>{r.commits.map((c, i) => <li key={i}><InlineMarkdown text={c} /></li>)}</ul>
              <p className={s.hint}>What the reviewers found:</p>
            </>
          )}
          {r.items.length === 0 ? <p className={s.hint}>Nothing found.</p> : (
            <table className={s.table} aria-label={`Round ${r.round}'s defects`}>
              <thead><tr><th className={s.narrow}>verdict</th>{!r.recorded && <th className={s.narrow}>from</th>}<th>claim</th></tr></thead>
              <tbody>{r.items.map((d, i) => <Defect key={i} d={d} source={!r.recorded} />)}</tbody>
            </table>
          )}
        </section>
      ))}
    </SidebarPanel>
  );
}
