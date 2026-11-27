import { useState } from 'react';
import { AboutButton } from '@dash/AboutButton';
import { isFixSettled } from './FixShelf';
import type { SaturationDefect, SaturationLedger } from './saturation.types';
import s from './DelveChart.module.css';

const PITCH = 38;
const TILE_W = 28;
const TILE_H = 7;
/** How far a tile's top and side faces recede, up and to the right. */
const DEPTH = 8;
const AXIS = 13;

/** What a pass's finding was: the first sighting of a defect a later pass saw again, the first of one no other pass
 *  has seen, or a defect an earlier pass had already found. */
export type Novelty = 'new' | 'lone' | 'again';

export const noveltyOf = (d: SaturationDefect, pass: number): Novelty =>
  d.firstOccasion === pass ? (d.seenAt.length > 1 ? 'new' : 'lone') : 'again';

const ORDER: Readonly<Record<Novelty, number>> = { again: 0, new: 1, lone: 2 };
const LABEL: Readonly<Record<Novelty, string>> = { new: 'new, seen again since', lone: 'new, not seen again', again: 'seen before' };

/** Each pass's findings, bottom to top: the defects it saw again, then the ones it found first. */
export const stacksOf = (defects: readonly SaturationDefect[], passes: number) =>
  Array.from({ length: passes }, (_, i) => defects.filter((d) => d.seenAt.includes(i + 1))
    .map((d) => ({ defect: d, novelty: noveltyOf(d, i + 1) }))
    .sort((a, b) => ORDER[a.novelty] - ORDER[b.novelty] || Number(a.defect.id.slice(1)) - Number(b.defect.id.slice(1))));

/** The passes the axis spans: a finished ledger's own, a live one's with room to grow, never past its cap. */
export const spanOf = (done: number, max: number | null, live: boolean): number => {
  const cap = max ?? Infinity;
  return Math.max(2, live ? Math.min(cap, Math.max(10, done + Math.ceil(done / 4) + 2)) : done);
};

/** A tile's hover text: which pass, which defect, and for a repeat sighting, the pass that found it first. */
export const tileTitleOf = (d: SaturationDefect, pass: number, novelty: Novelty): string =>
  `pass ${pass} · ${d.id}, ${LABEL[novelty]}${novelty === 'again' ? ` in pass ${d.firstOccasion}` : ''} · ${d.claim}`;

type TileProps = { x: number; y: number; className: string; title: string; onEnter: () => void; onLeave: () => void; onPick?: (() => void) | undefined };

function Tile({ x, y, className, title, onEnter, onLeave, onPick }: TileProps) {
  return (
    <g className={onPick ? `${className} ${s.pickable}` : className} onPointerEnter={onEnter} onPointerLeave={onLeave} onClick={onPick}>
      <title>{title}</title>
      <rect className={s.front} x={x} y={y} width={TILE_W} height={TILE_H} />
      <polygon className={s.top} points={`${x},${y} ${x + DEPTH},${y - DEPTH} ${x + TILE_W + DEPTH},${y - DEPTH} ${x + TILE_W},${y}`} />
      <polygon className={s.side} points={`${x + TILE_W},${y} ${x + TILE_W + DEPTH},${y - DEPTH} ${x + TILE_W + DEPTH},${y + TILE_H - DEPTH} ${x + TILE_W},${y + TILE_H}`} />
    </g>
  );
}

/** A ledger's passes along the axis, each a stack of tiles, one per defect it reported, by whether it was new, and the
 *  count of defects the ledger is estimated to hold that no pass has found. */
export function DelveChart({ ledger, max = null, live = false, onPickDefect, traced: tracedGiven, onTrace }: {
  ledger: SaturationLedger; max?: number | null; live?: boolean;
  /** Called with a tile's defect when it is clicked; without it, tiles only trace on hover. */
  onPickDefect?: (id: string) => void;
  /** The defect traced, and what hears a hover change it, when the page shares the trace with another chart (the fix
   *  shelf); without them the chart keeps its own. */
  traced?: string | null;
  onTrace?: (id: string | null) => void;
}) {
  const [own, setOwn] = useState<string | null>(null);
  const traced = tracedGiven !== undefined ? tracedGiven : own;
  const setTraced = (id: string | null) => (onTrace ?? setOwn)(id);
  const done = ledger.occasions;
  if (done === 0) return null;
  const stacks = stacksOf(ledger.defects, done);
  const ghosts = Math.max(0, Math.round(ledger.unseen ?? 0));
  const span = spanOf(done, max, live);
  const tallest = Math.max(1, ...stacks.map((st) => st.length));
  const base = DEPTH + tallest * TILE_H + 2;
  const labelX = done * PITCH + 6;
  const width = Math.max(span * PITCH, ghosts ? labelX + 120 : 0);
  const height = base + AXIS;
  const ticks = [1, ...Array.from({ length: Math.floor(span / 5) }, (_, i) => (i + 1) * 5)].filter((t) => t <= span);
  const colX = (pass: number) => (pass - 1) * PITCH;
  return (
    <svg className={traced ? `${s.chart} ${s.tracing}` : s.chart} viewBox={`0 0 ${width} ${height}`} width={width} role="img"
      aria-label={`${done} passes, ${ledger.distinct} defects found, about ${ghosts} not found yet`}>
      <line className={s.base} x1={0} x2={span * PITCH} y1={base} y2={base} />
      {ticks.map((t) => <text key={t} className={s.tick} x={colX(t) + TILE_W / 2} y={height - 1}>{t}</text>)}
      {stacks.map((stack, i) => (stack.length ? null : (
        <polygon key={`empty-${i}`} className={s.empty}
          points={`${colX(i + 1)},${base} ${colX(i + 1) + DEPTH},${base - DEPTH} ${colX(i + 1) + TILE_W + DEPTH},${base - DEPTH} ${colX(i + 1) + TILE_W},${base}`}>
          <title>{`pass ${i + 1} · no findings`}</title>
        </polygon>
      )))}
      {stacks.map((stack, i) => stack.map(({ defect, novelty }, k) => (
        <Tile key={`${i}-${defect.id}`} x={colX(i + 1)} y={base - (k + 1) * TILE_H}
          className={[s[novelty], defect.id === traced ? s.traced : '', ledger.passes[i]?.source === 'codex' ? s.codex : '',
            isFixSettled(ledger.fix?.statuses[defect.id], defect.registry) ? s.settled : ''].filter(Boolean).join(' ')}
          title={tileTitleOf(defect, i + 1, novelty)}
          onEnter={() => setTraced(defect.id)} onLeave={() => setTraced(null)}
          onPick={onPickDefect ? () => onPickDefect(defect.id) : undefined} />
      )))}
      {ghosts > 0 && <text className={s.ghostLabel} x={labelX} y={base - 2}>≈ {ghosts} not found yet</text>}
    </svg>
  );
}

const NOVELTIES = ['again', 'new', 'lone'] as const;

/** The key to the chart's tiles, and, where the ledger has a Codex pass (`codex`), the hues its tiles take. */
export function DelveKey({ codex = false }: { codex?: boolean }) {
  return (
    <span className={s.key}>
      {NOVELTIES.map((n) => <span key={n}><i className={`${s.swatch} ${s[n]}`} />{LABEL[n]}</span>)}
      {codex && <span>{NOVELTIES.map((n) => <i key={n} className={`${s.swatch} ${s[n]} ${s.codex}`} />)}codex pass</span>}
    </span>
  );
}

/** What a delve chart shows, behind an ⓘ in its section's title row: how to read it, and its key. */
export function DelveAbout({ ledger, picks = false }: { ledger: SaturationLedger; picks?: boolean }) {
  return (
    <AboutButton label="What the delve chart shows">
      <p className={s.aboutPara}>
        Each pass is a stack, one tile per defect it reported: those an earlier pass found at the bottom, then the new ones.
        Hover a tile to trace its defect across every pass{picks ? '; click it to jump to its row' : ''}. A defect
        fixed on a verified branch, or in the registry, shows faint.
      </p>
      <DelveKey codex={hasCodexPass(ledger)} />
    </AboutButton>
  );
}

/** Whether a ledger has a Codex pass, whose tiles the key then explains. */
export const hasCodexPass = (ledger: SaturationLedger): boolean => (ledger.sources.codex ?? 0) > 0;
