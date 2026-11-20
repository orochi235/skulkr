import { InlineMarkdown } from '@weasel-js/ui/components/InlineMarkdown';
import { Badge } from '@weasel-js/ui/components/Badge';
import { Popover, PopoverDialog } from '@weasel-js/ui/components/Popover';
import { SidebarPanel } from '@weasel-js/ui/components/SidebarPanel';
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Grade } from '@weasel-js/theme';
import { useAreaDefects } from './useAreaDefects';
import type { AuditDefect } from './skulkrMap.types';
import s from './AreaDefects.module.css';

const GRADE: Readonly<Record<AuditDefect['verdict'], Grade | undefined>> = {
  fixed: 'success', 'not a defect': undefined, duplicate: undefined, question: 'warn', 'not fixed': 'danger', open: 'info',
};

/** One defect as a square tile: its verdict and source, then as much of its claim as fits. Where the claim is cut off,
 *  or the fixer left a note, pressing the tile opens the whole of both. */
function Defect({ d }: { d: AuditDefect }) {
  const grade = GRADE[d.verdict];
  const tile = useRef<HTMLDivElement>(null);
  const claim = useRef<HTMLDivElement>(null);
  const [clipped, setClipped] = useState(false);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    const el = claim.current;
    if (el) setClipped(el.scrollHeight > el.clientHeight + 1);
  }, [d.claim]);
  const more = clipped || !!d.note;
  const toggle = () => setOpen((was) => !was);
  const badge = <Badge shape="pill" size="xs" variant={d.verdict === 'fixed' ? 'solid' : 'outline'} {...(grade ? { grade } : {})}>{d.verdict}</Badge>;
  return (
    <li className={s.item} data-verdict={d.verdict}>
      <div
        ref={tile} className={s.tile}
        {...(more ? {
          role: 'button', tabIndex: 0, 'aria-haspopup': 'dialog' as const, 'aria-expanded': open, 'aria-label': `${d.verdict}: details`,
          onClick: toggle,
          onKeyDown: (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggle();
            }
          },
        } : {})}
      >
        <div className={s.head}>
          {badge}
          {d.from && <span className={s.from}>{d.from}</span>}
        </div>
        <div ref={claim} className={s.claim}><InlineMarkdown text={d.claim} /></div>
      </div>
      {more && (
        <Popover triggerRef={tile} open={open} onOpenChange={setOpen} placement="bottom" offset={4}>
          <PopoverDialog aria-label="Defect details" className={s.details}>
            <div className={s.head}>
              {badge}
              {d.from && <span className={s.from}>{d.from}</span>}
            </div>
            <div className={s.full}><InlineMarkdown text={d.claim} /></div>
            {d.note && <div className={s.note}><InlineMarkdown text={d.note} /></div>}
          </PopoverDialog>
        </Popover>
      )}
    </li>
  );
}

/** What each round found in the picked area and what became of each: the fixer's report once it has one. */
export function AreaDefects({ url, id, version }: { url: string; id: string; version: string }) {
  const state = useAreaDefects(url, id, version);
  return (
    <SidebarPanel title="Defects">
      <div className={s.id}>{id}</div>
      {state.status === 'loading' && <p className={s.hint}>Reading its rounds…</p>}
      {state.status === 'failed' && <p className={s.hint}>Couldn&apos;t read them: {state.error}</p>}
      {state.status === 'ready' && state.rounds.length === 0 && <p className={s.hint}>No round has read it yet.</p>}
      {state.status === 'ready' && state.rounds.map((r) => (
        <section key={r.round} className={s.round}>
          <h3 className={s.title}>
            Round {r.round}
            <span className={s.hint}>{r.recorded ? '' : r.fixed ? ' · not merged yet' : r.commits ? ' · its fixer stopped before reporting' : ' · no fixer report yet'}</span>
          </h3>
          {r.commits && r.commits.length > 0 && (
            <>
              <p className={s.hint}>Its commits:</p>
              <ul className={s.commits}>{r.commits.map((c, i) => <li key={i}><InlineMarkdown text={c} /></li>)}</ul>
              <p className={s.hint}>What the reviewers found:</p>
            </>
          )}
          {r.items.length === 0 ? <p className={s.hint}>Nothing found.</p> : <ol className={s.list}>{r.items.map((d, i) => <Defect key={i} d={d} />)}</ol>}
        </section>
      ))}
    </SidebarPanel>
  );
}
