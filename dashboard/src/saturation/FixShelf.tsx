import { Focusable, Tooltip, TooltipTrigger } from '@weasel-js/ui/components/Tooltip';
import { SegmentedBar } from '@weasel-js/ui/components/Segmented';
import { AboutButton } from '@dash/AboutButton';
import type { FixShelf as FixShelfData, FixStage, FixStatus, FixStatusEntry } from './saturation.types';
import s from './FixShelf.module.css';

/** A tile is a delve tile stood on end, the same size for every defect: only its color says anything. */
const BOOK_W = 7;
const BOOK_H = 26;
const GAP = 2;
const GROUP_GAP = 14;
/** How far a tile's top and side faces recede, up and to the right, as a delve tile's do. */
const DEPTH = 6;
const LABEL = 13;
/** Room above the tiles for a recurrent defect's dot. */
const DOT = 6;

/** What a defect's tile is colored by: its fix status, its stage while its batch is out (`fixing` where none was
 *  read), `waiting` before any run has touched it. */
export type ShelfStatus = FixStatus | FixStage | 'waiting';

/** The one answer to what a defect's tile and chip show, from its shelf entry. */
export const shelfStatusOf = (entry: FixStatusEntry | undefined): ShelfStatus =>
  !entry ? 'waiting' : entry.status === 'fixing' ? entry.stage ?? 'fixing' : entry.status;

/** Whether a defect's fix is done with: fixed on a branch whose verify passed, or fixed in the registry. */
export const isFixSettled = (entry: FixStatusEntry | undefined, registry: { readonly status: string } | null = null): boolean =>
  (entry?.status === 'fixed' && entry.branch !== null && entry.verified === true) || registry?.status === 'fixed';

/** Whether a defect is closed: its fix settled, a verified run calling it no defect or a duplicate, or its registry
 *  line past `open`. */
export const isDefectClosed = (entry: FixStatusEntry | undefined, registry: { readonly status: string } | null = null): boolean =>
  isFixSettled(entry, registry)
  || (entry?.verified === true && (entry.status === 'not a defect' || entry.status === 'duplicate'))
  || (registry !== null && registry.status !== 'open');

const STAGE: Readonly<Record<FixStage | 'fixing', string>> = {
  fixing: s.fixing!, analyzing: s.analyzing!, writing: s.writing!, written: s.written!, checking: s.checking!, repairing: s.repairing!,
};

const CLASS: Readonly<Record<ShelfStatus, string>> = {
  ...STAGE, waiting: s.waiting!, fixed: s.fixed!, 'not a defect': s.notDefect!, question: s.question!,
  'not fixed': s.notFixed!, duplicate: s.duplicate!, unread: s.unread!, 'flagged for repair': s.flagged!,
};

const KEY: readonly ShelfStatus[] = ['waiting', 'analyzing', 'writing', 'written', 'checking', 'repairing', 'fixed', 'not a defect', 'flagged for repair', 'question', 'not fixed', 'duplicate', 'unread'];

/** How the shelf orders tiles within a group: as triage batched them, or by status in the key's order. */
export type ShelfOrder = 'batch' | 'status';

/** Whether a batch is done: every defect in it has a fix run's verdict. */
const isBatchDone = (shelf: FixShelfData, defects: FixShelfData['batches'][number]['defects']) =>
  defects.every((d) => { const at = shelf.statuses[d.id]; return at !== undefined && at.status !== 'fixing'; });

/** Each group's tiles laid along the shelf, their x and status, the group's label and its x, and the shelf's width: a
 *  group per batch still to finish, then every done batch's defects in one group at the end, each in `order`. */
export const shelfLayoutOf = (shelf: FixShelfData, order: ShelfOrder = 'batch') => {
  const tiles = (b: FixShelfData['batches'][number]) => b.defects.map((d) => ({ ...d, batch: b.n, status: shelfStatusOf(shelf.statuses[d.id]) }));
  const done = shelf.batches.filter((b) => isBatchDone(shelf, b.defects));
  const sets = [
    ...shelf.batches.filter((b) => !done.includes(b)).map((b) => ({ key: `b${b.n}`, label: `b${b.n}`, tiles: tiles(b) })),
    ...(done.length ? [{ key: 'done', label: 'done', tiles: done.flatMap(tiles) }] : []),
  ];
  let x = 0;
  const groups = sets.map((set) => {
    const start = x;
    const sorted = order === 'status' ? [...set.tiles].sort((a, b) => KEY.indexOf(a.status) - KEY.indexOf(b.status)) : set.tiles;
    const books = sorted.map((t) => {
      const book = { ...t, x, h: BOOK_H };
      x += BOOK_W + GAP;
      return book;
    });
    const end = x - GAP + DEPTH;
    x = end + GROUP_GAP;
    return { key: set.key, label: set.label, books, labelX: (start + end) / 2 };
  });
  return { groups, width: Math.max(0, x - GROUP_GAP) };
};

const ORDERS = [{ value: 'batch', label: 'batch' }, { value: 'status', label: 'status' }] as const satisfies readonly { value: ShelfOrder; label: string }[];

/** The switch between the shelf's orders. */
export function ShelfOrderSwitch({ order, onChange }: { order: ShelfOrder; onChange: (order: ShelfOrder) => void }) {
  return <SegmentedBar aria-label="Order tiles by" size="sm" items={ORDERS} value={order} onChange={(v) => v && onChange(v)} />;
}

/** The defects of a ledger's fix plan as tiles stood on end along a shelf, one group per batch, each colored by its fix status. */
export function FixShelf({ shelf, order = 'batch', onPickDefect, traced = null, onTrace }: {
  shelf: FixShelfData; order?: ShelfOrder; onPickDefect?: (id: string) => void;
  /** The defect traced across the page's charts, lit here as the rest fade; `onTrace` hears a hover change it. */
  traced?: string | null; onTrace?: (id: string | null) => void;
}) {
  const { groups, width } = shelfLayoutOf(shelf, order);
  const base = DOT + DEPTH + BOOK_H;
  const total = groups.reduce((n, g) => n + g.books.length, 0);
  const tracing = traced !== null && groups.some((g) => g.books.some((b) => b.id === traced));
  return (
    <svg className={tracing ? `${s.shelf} ${s.tracing}` : s.shelf} viewBox={`0 0 ${width} ${base + LABEL}`} width={width} role="img"
      aria-label={`${total} defects in ${groups.length} fix groups`}>
      <line className={s.board} x1={0} x2={width} y1={base} y2={base} />
      {groups.map((g) => (
        <g key={g.key} className={g.books.some((b) => b.id === traced) ? s.tracedGroup : undefined}>
          {g.books.map((b) => {
            const top = base - b.h;
            const run = shelf.statuses[b.id];
            const title = `${b.id} · batch ${b.batch} · ${b.status}${run?.verdict ? ` (fix run said ${run.verdict})` : ''}${run?.run ? ` (fix run ${run.run}${run.branch ? `, ${run.branch}` : ''})` : ''}${b.recurrent ? ' · recurrent' : ''}`;
            return (
              <g
                key={b.id} className={[s.tile, CLASS[b.status], b.status in STAGE ? s.out : '', b.id === traced ? s.traced : '', onPickDefect ? s.pickable : ''].filter(Boolean).join(' ')}
                onClick={onPickDefect ? () => onPickDefect(b.id) : undefined}
                onPointerEnter={onTrace ? () => onTrace(b.id) : undefined} onPointerLeave={onTrace ? () => onTrace(null) : undefined}
              >
                <title>{title}</title>
                <rect className={s.front} x={b.x} y={top} width={BOOK_W} height={b.h} />
                <polygon className={s.top} points={`${b.x},${top} ${b.x + DEPTH},${top - DEPTH} ${b.x + BOOK_W + DEPTH},${top - DEPTH} ${b.x + BOOK_W},${top}`} />
                <polygon className={s.side} points={`${b.x + BOOK_W},${top} ${b.x + BOOK_W + DEPTH},${top - DEPTH} ${b.x + BOOK_W + DEPTH},${base - DEPTH} ${b.x + BOOK_W},${base}`} />
                {b.recurrent && <circle className={s.dot} cx={b.x + DEPTH + BOOK_W / 2} cy={top - DEPTH - 3.5} r={1.8} />}
              </g>
            );
          })}
          <text className={s.label} x={g.labelX} y={base + LABEL - 2}>{g.label}</text>
        </g>
      ))}
      {/* The traced tile's outline, around all three faces and drawn after every tile so its neighbor's faces never
          cover an edge of it. */}
      {groups.flatMap((g) => g.books.filter((b) => b.id === traced)).map((b) => {
        const top = base - b.h;
        return (
          <polygon key="outline" className={s.outline}
            points={`${b.x},${base} ${b.x},${top} ${b.x + DEPTH},${top - DEPTH} ${b.x + BOOK_W + DEPTH},${top - DEPTH} ${b.x + BOOK_W + DEPTH},${base - DEPTH} ${b.x + BOOK_W},${base}`} />
        );
      })}
    </svg>
  );
}

/** What the shelf shows, behind an ⓘ: how to read a tile, and the colors of the statuses. */
export function FixShelfAbout() {
  return (
    <AboutButton label="What the fix shelf shows">
      <p className={s.aboutPara}>
        Each open defect is a tile, grouped by the fix batch triage puts it in, colored by where its fix stands. While
        its batch is out, a tile shows the step it is on: analyzing until the fixer takes it up, writing until its
        commit, written after, then checking (the fixer&apos;s checks and verify) and repairing. A dot
        above a tile marks a defect most reviews keep finding. A batch whose every defect has a verdict joins the done
        group at the end. The switch orders each group&apos;s tiles by batch or by status. Click a tile to jump to its row.
      </p>
      <FixShelfKey />
    </AboutButton>
  );
}

/** The key to the shelf's colors: a swatch and the word for each status and stage. */
export function FixShelfKey() {
  return (
    <span className={s.key}>
      {KEY.map((k) => <span key={k}><i className={`${s.swatch} ${CLASS[k]}`} />{k}</span>)}
    </span>
  );
}

/** A swatch in a fix status's shelf color, a tile in miniature. */
export function FixSwatch({ status }: { status: ShelfStatus }) {
  return <i className={`${s.swatch} ${CLASS[status]}`} aria-hidden="true" />;
}

/** A defect's fix status as a swatch in its shelf color and its word; where its fix is on a branch, the word names it
 *  in a tooltip. */
export function FixStatusChip({ status, branch = null }: { status: ShelfStatus; branch?: string | null }) {
  const chip = <span className={s.chip}><FixSwatch status={status} />{status}</span>;
  if (!branch) return chip;
  return (
    <TooltipTrigger>
      <Focusable><span className={s.tipped} tabIndex={0}>{chip}</span></Focusable>
      <Tooltip placement="top"><code>{branch}</code></Tooltip>
    </TooltipTrigger>
  );
}
