/** An icon's glyph, an SVG body on a 20×20 viewBox as the map carries it, read into paths to draw in one ink. */
import type { DrawCommand } from '@weasel-js/core';
import { mat3, type Path } from '@weasel-js/geom';
import { parseSvg, type SvgNode, type SvgStroke } from '@weasel-js/svg';

/** The side of the box a glyph is drawn on. */
export const GLYPH_FRAME = 20;

/** One shape of a glyph: its outline, whether it is filled, and its stroke. */
export interface GlyphPath {
  readonly path: Path;
  readonly fill: boolean;
  readonly stroke?: {
    readonly width: number;
    readonly cap?: SvgStroke['cap'];
    readonly join?: SvgStroke['join'];
    readonly dash?: readonly number[];
  };
}

/** What an icon's root `<svg>` gives a glyph's elements, as weasel's `<Icon>` sets them. */
const ROOT = `xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GLYPH_FRAME} ${GLYPH_FRAME}" fill="none" stroke="currentColor" `
  + 'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" color="#000000"';

const leaves = (nodes: readonly SvgNode[]): GlyphPath[] => nodes.flatMap((n): GlyphPath[] => {
  if (n.kind === 'group') return leaves(n.children);
  if (n.kind !== 'path') return [];
  const stroke = n.stroke && n.stroke.paint.kind !== 'none' && typeof n.stroke.width === 'number' ? n.stroke : undefined;
  const fill = n.fill.kind !== 'none';
  if (!fill && !stroke) return [];
  return [{
    path: n.path,
    fill,
    ...(stroke ? {
      stroke: {
        width: stroke.width as number,
        ...(stroke.cap ? { cap: stroke.cap } : {}),
        ...(stroke.join ? { join: stroke.join } : {}),
        ...(stroke.dash ? { dash: stroke.dash } : {}),
      },
    } : {}),
  }];
});

const parsed = new Map<string, readonly GlyphPath[]>();

/** `body`'s shapes, every paint read as the one ink an icon is drawn in; parsed once per glyph. */
export function glyphPathsOf(body: string): readonly GlyphPath[] {
  let paths = parsed.get(body);
  if (!paths) {
    paths = leaves(parseSvg(`<svg ${ROOT}>${body}</svg>`).nodes);
    parsed.set(body, paths);
  }
  return paths;
}

/** `paths` drawn in `color` at `opacity`, their 20×20 frame scaled to the `size` square at (x, y). */
export function glyphCommands(
  paths: readonly GlyphPath[], at: { x: number; y: number; size: number }, color: string, opacity: number,
): DrawCommand {
  const k = at.size / GLYPH_FRAME;
  const children: DrawCommand[] = paths.flatMap((g): DrawCommand[] => [
    ...(g.fill ? [{ kind: 'path' as const, path: g.path, fill: { paint: { color } } }] : []),
    ...(g.stroke ? [{
      kind: 'path' as const, path: g.path,
      stroke: { paint: { color }, width: g.stroke.width, cap: g.stroke.cap, join: g.stroke.join, ...(g.stroke.dash ? { dash: [...g.stroke.dash] } : {}) },
    }] : []),
  ]);
  return { kind: 'group', transform: mat3.fromAffine([k, 0, 0, k, at.x, at.y]), alpha: opacity, children };
}
