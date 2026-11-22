/** How the audit map's nodes paint: an area's cell, and the frame of the package holding it. */
import { resolvePaintPattern, textCommandFromRuns, type DrawCommand, type NodeShapeEntry, type PosedPaint, type RectPose } from '@weasel-js/core';
import { circlePath, pathFromD, type Path } from '@weasel-js/geom';
import { glyphCommands, type GlyphPath } from './glyph';
import { framePadOf, iconBoxIn } from './mapLayout';

/** The most pass dots an area wears on its map cell: one per pass, up to this many. */
export const MAX_PASS_DOTS = 4;

/** The room one pip (a pass dot, the open circle, the padlock) takes along a cell's top edge, and between rows. */
const PIP = 6;

/** How many pips a row holds in a cell `width` wide; pips past that wrap to a row below. */
export const pipsPerRowIn = (width: number): number => Math.max(1, Math.floor((width - 4) / PIP));

/** The pips a cell wears, right to left: the open circle while a pass is under way, the pass dots, then the padlock. */
export const pipCountOf = (dots: number, pending: boolean, locked: boolean): number =>
  (pending ? 1 : 0) + Math.min(dots, MAX_PASS_DOTS - (pending ? 1 : 0)) + (locked ? 1 : 0);

export interface AuditCellData {
  readonly kind: 'audit-cell';
  readonly fill: PosedPaint;
  /** Drawn over `fill`: the hatch on ground nobody has audited. */
  readonly over?: PosedPaint;
  readonly edge: string;
  readonly ink: string;
  /** Its name, a line each. */
  readonly label?: readonly string[];
  /** Its icon's shapes, centered in it under everything but its fill. */
  readonly icon?: readonly GlyphPath[];
  /** The outline's color while a live run holds it, which says how far the run has taken it. */
  readonly live?: string;
  /** A solid color its label lines sit on, where `over` would put a hatch under them. */
  readonly backing?: string;
  /** Its queue place, in the cell's corner. */
  readonly queue?: number;
  /** Its files changed since its last pass: a corner cut off in the edge color. */
  readonly worn?: boolean;
  /** A check in its corner: no audit is due. */
  readonly settled?: boolean;
  /** One per pass, up to four. */
  readonly dots: number;
  /** A live run's pass over the area is under way: an open circle after the dots until its own dot replaces it. */
  readonly pending?: boolean;
  /** An earlier round's unmerged branch holds it: a padlock left of the dots. */
  readonly locked?: boolean;
  /** A glow's color while something naming the area elsewhere on the page is hovered. */
  readonly glow?: string;
  /** The outline flashed on an area a round's recut made or split, fading as the page sets its opacity. */
  readonly recut?: { readonly color: string; readonly opacity: number };
  /** The live outline's opacity, which the page breathes. */
  readonly pulse: number;
  /** The faces its words and its numbers are set in. */
  readonly font: string;
  readonly numericFont: string;
}

export interface AuditFrameData {
  readonly kind: 'audit-frame';
  readonly edge: string;
  /** The title band's fill, under the title so it never sits on a cell's color; `ink` is chosen to read on it. */
  readonly band: string;
  readonly ink: string;
  readonly title?: string;
  readonly font: string;
  /** The title's size, smaller for a frame inside another. */
  readonly size: number;
  /** 0 for a top-level package, which draws a firmer edge than the frames inside it. */
  readonly depth: number;
}

export type AuditNodeData = AuditCellData | AuditFrameData;

/** How strongly an icon's ink shows: enough to read on any heat, faint beside the label. */
const ICON_INK = 0.3;

/** The side of a changed area's cut corner, in pixels. */
const CUT_PX = 12;
/**
 * The cell's edge inset by `by`, its bottom-left corner cut where the cell's `cut` (the worn corner's leg) reaches it:
 * the diagonal moved in by `by` too, so an outline runs parallel to the cut rather than over it.
 */
export const outline = (p: RectPose, by: number, cut: number): Path => {
  const c = cut - by * (2 - Math.SQRT2);
  if (c <= 0) return rect(p, by);
  const x0 = p.x + by, y0 = p.y + by, x1 = p.x + p.width - by, y1 = p.y + p.height - by;
  return pathFromD(`M ${x0} ${y0} H ${x1} V ${y1} H ${x0 + c} L ${x0} ${y1 - c} Z`);
};

const rect = (p: RectPose, by = 0): Path => ({ kind: 'rect', x: p.x + by, y: p.y + by, width: Math.max(0, p.width - 2 * by), height: Math.max(0, p.height - 2 * by) });

/** `y` is the text's top: a text command is top-anchored by default. */
const text = (x: number, y: number, s: string, color: string, font: string, size: number, weight = 400): DrawCommand =>
  textCommandFromRuns(x, y, [{ text: s, fill: { paint: { color } } }], { fontFamily: font, fontSize: size, fontWeight: weight });

/** A label line's height. */
const LINE = 15;

/** A solid backing under `s` set at `size` from (x + 2, y + 1), so the text never sits on a hatch or a fill. Its
 *  width is estimated from Oswald's average character, with room to spare. */
const chip = (x: number, y: number, s: string, size: number, color: string): DrawCommand[] =>
  filled({ kind: 'rect', x, y, width: s.length * size * 0.52 + 4, height: size + 3 }, { color });

/** The width `n` digits take at `size`, roughly: enough to set a number against the right edge. */
const digitsWidth = (n: number, size: number) => String(n).length * size * 0.5;

/** The size a queue number is set at in a cell `p`: 13px, or as large as fits a cell too small for that, down to 6. */
function queueSizeIn(queue: number, p: { width: number; height: number }): number {
  let size = 13;
  while (size > 6 && (digitsWidth(queue, size) > p.width - 2 || size > p.height - 2)) size -= 1;
  return size;
}

function filled(path: Path, paint: PosedPaint): DrawCommand[] {
  const resolved = resolvePaintPattern(paint);
  return resolved ? [{ kind: 'path', path, fill: { paint: resolved } }] : [];
}

const GLOW = [[1.5, 1], [4.5, 0.5], [7.5, 0.22]] as const;

function paintCell(d: AuditCellData, p: RectPose): DrawCommand[] {
  const out: DrawCommand[] = [
    ...filled(rect(p), d.fill),
    ...(d.over ? filled(rect(p), d.over) : []),
    { kind: 'path', path: rect(p), stroke: { paint: { color: d.edge }, width: 0.5 } },
  ];
  const iconBox = d.icon ? iconBoxIn(p) : null;
  if (d.icon && iconBox) out.push(glyphCommands(d.icon, { x: iconBox.x, y: iconBox.y, size: iconBox.width }, d.ink, ICON_INK));
  // One size for every cell, shrunk only where a cell is too small to hold it.
  const cut = d.worn ? Math.min(Math.min(p.width, p.height) * 0.45, CUT_PX) : 0;
  if (d.worn) {
    const x = p.x, y = p.y + p.height;
    out.push(...filled(pathFromD(`M ${x} ${y} L ${x} ${y - cut} L ${x + cut} ${y} Z`), { color: d.edge }));
  }
  if (d.live) out.push({ kind: 'path', path: outline(p, 5, cut), stroke: { paint: { color: d.live, opacity: d.pulse }, width: 9.5 } });
  if (d.recut) out.push({ kind: 'path', path: outline(p, 2, cut), stroke: { paint: { color: d.recut.color, opacity: d.recut.opacity }, width: 4 } });
  // Drawn inward, since a neighbor paints over anything outside the cell.
  if (d.glow) for (const [by, opacity] of GLOW) out.push({ kind: 'path', path: outline(p, by, cut), stroke: { paint: { color: d.glow, opacity }, width: 3 } });
  if (d.settled && p.width >= 16 && p.height >= 16) {
    const x = p.x + p.width - 13, y = p.y + p.height - 12;
    const check = pathFromD(`M ${x} ${y + 4} L ${x + 3} ${y + 7} L ${x + 9} ${y}`);
    out.push({ kind: 'path', path: check, stroke: { paint: { color: d.ink, opacity: 0.8 }, width: 1.6 } });
  }
  // Read left to right, oldest first: the open circle, when there is one, takes the rightmost place, and the padlock
  // follows the dots. A row holds what the cell's width does; the rest wrap below, as long as the cell is tall enough.
  const ring = d.pending ? 1 : 0;
  const dotCount = Math.min(d.dots, MAX_PASS_DOTS - ring);
  const pips = pipCountOf(d.dots, d.pending ?? false, d.locked ?? false);
  const perRow = pipsPerRowIn(p.width);
  const rows = Math.ceil(pips / perRow);
  if (pips > 0 && p.width >= 10 && p.height >= 4 + rows * PIP) {
    const at = (i: number) => ({ x: p.x + p.width - 5 - (i % perRow) * PIP, y: p.y + 5 + Math.floor(i / perRow) * PIP });
    const ink = { color: d.ink, opacity: 0.85 };
    if (ring) { const c = at(0); out.push({ kind: 'path', path: circlePath(c.x, c.y, 1.6, 12), stroke: { paint: ink, width: 1 } }); }
    for (let i = 0; i < dotCount; i++) { const c = at(i + ring); out.push({ kind: 'path', path: circlePath(c.x, c.y, 2, 12), fill: { paint: ink } }); }
    if (d.locked) {
      const { x, y } = at(ring + dotCount);
      out.push({ kind: 'path', path: pathFromD(`M ${x - 2.5} ${y - 0.5} h 5 v 3.5 h -5 Z`), fill: { paint: ink } });
      out.push({ kind: 'path', path: pathFromD(`M ${x - 1.5} ${y - 0.5} V ${y - 1.5} A 1.5 1.5 0 0 1 ${x + 1.5} ${y - 1.5} V ${y - 0.5}`), stroke: { paint: ink, width: 1 } });
    }
  }
  const texts: DrawCommand[] = [];
  const lines = d.label ?? [];
  lines.forEach((line, i) => {
    const y = p.y + 3 + i * LINE;
    if (d.backing) texts.push(...chip(p.x + 2, y - 1, line, 12, d.backing));
    texts.push(text(p.x + 4, y, line, d.ink, d.font, 12));
  });
  if (d.queue !== undefined) {
    const size = queueSizeIn(d.queue, p);
    const inset = Math.min(4, (p.width - digitsWidth(d.queue, size)) / 2);
    texts.push(text(p.x + p.width - inset - digitsWidth(d.queue, size), p.y + p.height - size - Math.min(4, (p.height - size) / 2), String(d.queue), d.ink, d.numericFont, size, 700));
  }
  // The clip keeps a label inside its own cell where its width was only estimated.
  if (texts.length > 0) out.push({ kind: 'group', clip: rect(p, 1), children: texts });
  return out;
}

function paintFrame(d: AuditFrameData, p: RectPose): DrawCommand[] {
  // Top and bottom edges only: side edges would stand between areas the layout lines up across frames.
  const edges = pathFromD(`M ${p.x} ${p.y + 0.5} H ${p.x + p.width} M ${p.x} ${p.y + p.height - 0.5} H ${p.x + p.width}`);
  const out: DrawCommand[] = [{ kind: 'path', path: edges, stroke: { paint: { color: d.edge, opacity: d.depth === 0 ? 0.55 : 0.3 }, width: 1 } }];
  if (d.title) {
    const room = framePadOf(d.depth).title;
    out.push(...filled(rect({ ...p, height: Math.min(p.height, room) }, 0.5), { color: d.band }));
    out.push({ kind: 'group', clip: rect({ ...p, height: Math.min(p.height, room) }, 1), children: [text(p.x + 4, p.y + 2, d.title, d.ink, d.font, d.size, d.depth === 0 ? 700 : 500)] });
  }
  return out;
}

const isAudit = (data: unknown): data is AuditNodeData => {
  const kind = (data as { kind?: unknown } | null)?.kind;
  return kind === 'audit-cell' || kind === 'audit-frame';
};

/** Claims the audit map's nodes; a cell picks by its whole box. */
export const AUDIT_PAINTER: NodeShapeEntry<AuditNodeData, RectPose> = {
  id: 'app:audit-map',
  matches: (node) => isAudit(node.data),
  paint: (node, pose) => (node.data.kind === 'audit-cell' ? paintCell(node.data, pose) : paintFrame(node.data, pose)),
  drawsLabel: true,
  silhouette: (_node, p) => rect(p),
  bounds: (_node, p) => ({ x: p.x - 2, y: p.y - 2, width: p.width + 4, height: p.height + 4 }),
};
