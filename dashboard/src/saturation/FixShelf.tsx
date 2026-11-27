import { AboutButton } from '@dash/AboutButton';
import type { FixShelf as FixShelfData, FixStatus } from './saturation.types';
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

/** What a defect's tile is colored by: its fix status, `waiting` before any run has touched it. */
export type ShelfStatus = FixStatus | 'waiting';

const CLASS: Readonly<Record<ShelfStatus, string>> = {
  waiting: s.waiting!, fixing: s.fixing!, fixed: s.fixed!, 'not a defect': s.notDefect!, question: s.question!,
  'not fixed': s.notFixed!, duplicate: s.duplicate!, unread: s.unread!,
};

const KEY: readonly ShelfStatus[] = ['waiting', 'fixing', 'fixed', 'not a defect', 'question', 'not fixed', 'duplicate', 'unread'];

/** Each batch's tiles laid along the shelf: their x and status, the batch's label x, and the shelf's width. */
export const shelfLayoutOf = (shelf: FixShelfData) => {
  let x = 0;
  const groups = shelf.batches.map((b) => {
    const start = x;
    const books = b.defects.map((d) => {
      const book = { ...d, x, h: BOOK_H, status: (shelf.statuses[d.id]?.status ?? 'waiting') as ShelfStatus };
      x += BOOK_W + GAP;
      return book;
    });
    const end = x - GAP + DEPTH;
    x = end + GROUP_GAP;
    return { n: b.n, books, labelX: (start + end) / 2 };
  });
  return { groups, width: Math.max(0, x - GROUP_GAP) };
};

/** The defects of a ledger's fix plan as tiles stood on end along a shelf, one group per batch, each colored by its fix status. */
export function FixShelf({ shelf, onPickDefect }: { shelf: FixShelfData; onPickDefect?: (id: string) => void }) {
  const { groups, width } = shelfLayoutOf(shelf);
  const base = DOT + DEPTH + BOOK_H;
  const total = groups.reduce((n, g) => n + g.books.length, 0);
  return (
    <svg className={s.shelf} viewBox={`0 0 ${width} ${base + LABEL}`} width={width} role="img"
      aria-label={`${total} defects in ${groups.length} fix batches`}>
      <line className={s.board} x1={0} x2={width} y1={base} y2={base} />
      {groups.map((g) => (
        <g key={g.n}>
          {g.books.map((b) => {
            const top = base - b.h;
            const run = shelf.statuses[b.id];
            const title = `${b.id} · batch ${g.n} · ${b.status}${run ? ` (fix run ${run.run}${run.branch ? `, ${run.branch}` : ''})` : ''}${b.recurrent ? ' · recurrent' : ''}`;
            return (
              <g key={b.id} className={onPickDefect ? `${CLASS[b.status]} ${s.pickable}` : CLASS[b.status]} onClick={onPickDefect ? () => onPickDefect(b.id) : undefined}>
                <title>{title}</title>
                <rect className={s.front} x={b.x} y={top} width={BOOK_W} height={b.h} />
                <polygon className={s.top} points={`${b.x},${top} ${b.x + DEPTH},${top - DEPTH} ${b.x + BOOK_W + DEPTH},${top - DEPTH} ${b.x + BOOK_W},${top}`} />
                <polygon className={s.side} points={`${b.x + BOOK_W},${top} ${b.x + BOOK_W + DEPTH},${top - DEPTH} ${b.x + BOOK_W + DEPTH},${base - DEPTH} ${b.x + BOOK_W},${base}`} />
                {b.recurrent && <circle className={s.dot} cx={b.x + DEPTH + BOOK_W / 2} cy={top - DEPTH - 3.5} r={1.8} />}
              </g>
            );
          })}
          <text className={s.label} x={g.labelX} y={base + LABEL - 2}>b{g.n}</text>
        </g>
      ))}
    </svg>
  );
}

/** What the shelf shows, behind an ⓘ: how to read a tile, and the colors of the statuses. */
export function FixShelfAbout() {
  return (
    <AboutButton label="What the fix shelf shows">
      <p className={s.aboutPara}>
        Each open defect is a tile, grouped by the fix batch triage puts it in, colored by where its fix stands. A dot
        above a tile marks a defect most reviews keep finding. Click a tile to jump to its row.
      </p>
      <span className={s.key}>
        {KEY.map((k) => <span key={k}><i className={`${s.swatch} ${CLASS[k]}`} />{k}</span>)}
      </span>
    </AboutButton>
  );
}

/** A defect's fix status as a swatch in its shelf color and its word, with the branch its fix is on. */
export function FixStatusChip({ status, branch = null }: { status: ShelfStatus; branch?: string | null }) {
  return (
    <span className={s.chip}>
      <i className={`${s.swatch} ${CLASS[status]}`} />{status}{branch && <code className={s.branch}>{branch}</code>}
    </span>
  );
}
