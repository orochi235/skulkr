import { describe, expect, it } from 'vitest';
import { asNodeId } from '@weasel-js/core';
import { auditNodeSpecs, createAuditScene, frameIdOf, syncAuditScene, type AuditPalette } from './auditScene';
import { AUDIT_PAINTER, outline, pipCountOf, pipsPerRowIn, type AuditCellData } from './auditPainter';
import { ICON, layoutMap } from './mapLayout';
import { phasesOf } from './phases';
import { rampAt } from './heat';
import fixture from './fixture.map.json';
import type { SkulkrMap } from './skulkrMap.types';

const map = fixture as unknown as SkulkrMap;
const PALETTE: AuditPalette = {
  panel: '#ffffff', band: '#eeeeee', ink: '#111111', inkInverse: '#ffffff', uncharted: '#dddddd', hatch: '#aaaaaa',
  depth: ['#eef4fa', '#c6dcef', '#8fb6d9', '#3f78a8', '#173f63'], settled: '#6fae84', live: '#e0457b', recut: '#a6e22e',
  font: { ui: 'Oswald', numeric: 'Oswald Tabular' },
  phase: { review: '#2e1a6b', reviewed: '#8a1a7c', match: '#d2373a', fix: '#f08a2c', patch: '#f4e7a1', conflict: '#d23b2a', done: '#777777' },
};

const cellOf = (scene: ReturnType<typeof createAuditScene>, id: string) => scene.get(asNodeId(id))!.data as AuditCellData;

describe('the audit scene', () => {
  it('holds a frame per package, which never picks, and a cell per area', () => {
    const scene = createAuditScene();
    syncAuditScene(scene, auditNodeSpecs(map.areas, layoutMap(map.areas, 900, 400), PALETTE));
    expect(scene.get(frameIdOf('core'))?.pickable).toBe(false);
    expect(scene.nodesOnLayer('map').map((n) => n.id)).toEqual(expect.arrayContaining(map.areas.map((a) => a.id)));
    expect(cellOf(scene, 'core.ops')).toMatchObject({ live: PALETTE.live, dots: 1, fill: { color: PALETTE.depth[2] } });
    expect(cellOf(scene, 'ui.menu')).toMatchObject({ fill: { color: PALETTE.uncharted }, over: { kind: 'hatch' }, queue: 1 });
    expect(cellOf(scene, 'core.scene').ink).toBe(PALETTE.inkInverse);
    expect(scene.history.canUndo()).toBe(false);
  });

  it("hatches a never-audited area in the heat of what its live run already estimates it holds", () => {
    const scene = createAuditScene();
    const layout = layoutMap(map.areas, 900, 400);
    syncAuditScene(scene, auditNodeSpecs(map.areas, layout, PALETTE));
    expect(cellOf(scene, 'ui.menu').over).toMatchObject({ kind: 'hatch', color: PALETTE.hatch });
    syncAuditScene(scene, auditNodeSpecs(map.areas, layout, PALETTE, new Map(), null, Infinity, new Map([['ui.menu', 0]])));
    const hatch = cellOf(scene, 'ui.menu').over as { color: string };
    expect(hatch.color).not.toBe(PALETTE.hatch);
    expect(PALETTE.depth.map((c) => c.toLowerCase())).toContain(hatch.color.toLowerCase());
    expect(cellOf(scene, 'ui.menu').fill).toEqual({ color: PALETTE.uncharted });
  });

  it("outlines a live area's cell in its phase's color", () => {
    const scene = createAuditScene();
    syncAuditScene(scene, auditNodeSpecs(map.areas, layoutMap(map.areas, 900, 400), PALETTE, phasesOf(map.runs)));
    expect(cellOf(scene, 'core.ops').live).toBe(PALETTE.phase.fix);
    expect(cellOf(scene, 'core.debug').live).toBe(PALETTE.phase.reviewed);
    expect(cellOf(scene, 'geom').live).toBeUndefined();
  });

  it('keeps each node through a refresh, so the selection on it survives', () => {
    const scene = createAuditScene();
    syncAuditScene(scene, auditNodeSpecs(map.areas, layoutMap(map.areas, 900, 400), PALETTE));
    scene.setSelection([asNodeId('geom')]);
    const before = scene.incarnation(asNodeId('geom'));
    const fewer = map.areas.filter((a) => a.id !== 'ui.menu');
    syncAuditScene(scene, auditNodeSpecs(fewer, layoutMap(fewer, 600, 300), PALETTE));
    expect(scene.incarnation(asNodeId('geom'))).toBe(before);
    expect(scene.getSelection()).toEqual(['geom']);
    expect(scene.get(asNodeId('ui.menu'))).toBeUndefined();
  });
});

describe('syncAuditScene', () => {
  it('keeps a cell, and its selection, when a frame above it moves under a new frame', () => {
    const scene = createAuditScene();
    const specs = auditNodeSpecs(map.areas, layoutMap(map.areas, 900, 400), PALETTE);
    syncAuditScene(scene, specs);
    const cell = specs.find((sp) => sp.pickable && sp.parent !== null)!;
    const frame = specs.find((sp) => sp.id === cell.parent)!;
    scene.setSelection([cell.id]);
    const before = scene.incarnation(cell.id);
    const between = { ...frame, id: asNodeId(`${frame.id}~new`) };
    const next = specs.flatMap((sp) => (sp.id === frame.id ? [between, { ...frame, parent: between.id }] : [sp]));
    syncAuditScene(scene, next);
    expect(scene.get(frame.id)?.parent).toBe(between.id);
    expect(scene.incarnation(cell.id)).toBe(before);
    expect(scene.getSelection()).toEqual([cell.id]);
  });
});

describe('rampAt', () => {
  it('mixes between the two oklch stops a place falls between, the short way round the hue', () => {
    const stops = ['oklch(0.2 0.1 300)', 'oklch(0.6 0.2 20)', 'oklch(0.9 0.1 100)'];
    expect(rampAt(stops, 0)).toBe('oklch(0.2000 0.1000 300.00)');
    expect(rampAt(stops, 0.25)).toBe('oklch(0.4000 0.1500 340.00)');
    expect(rampAt(stops, 1)).toBe('oklch(0.9000 0.1000 100.00)');
    expect(rampAt(['#000000', '#ffffff'], 0.7)).toBe('#ffffff');
  });

  it('cuts the corner of a cell whose files changed since its pass, keeping its heat color, and hatches only the unaudited', () => {
    const due = map.areas.find((a) => a.status === 'due')!;
    const areas = map.areas.map((a) => (a.id === due.id ? { ...a, staleLines: 1000 } : a));
    const scene = createAuditScene();
    syncAuditScene(scene, auditNodeSpecs(areas, layoutMap(areas, 900, 400), PALETTE));
    expect(cellOf(scene, due.id).worn).toBe(true);
    expect(cellOf(scene, due.id).over).toBeUndefined();
    const unaudited = map.areas.find((a) => a.status === 'unaudited')!;
    expect(cellOf(scene, unaudited.id).over).toMatchObject({ kind: 'hatch' });
  });
});

describe('area icons', () => {
  const GLYPHS = { dot: '<circle cx="10" cy="10" r="4" fill="currentColor" stroke="none"/>' };
  const areas = map.areas.map((a) => (a.id === 'geom' ? { ...a, icon: 'dot' } : a.id === 'ui.menu' ? { ...a, icon: 'unknown' } : a));
  const paintOf = (data: AuditCellData, pose: { x: number; y: number; width: number; height: number }) =>
    AUDIT_PAINTER.paint({ data } as Parameters<typeof AUDIT_PAINTER.paint>[0], pose);
  const isIcon = (c: { kind: string; transform?: unknown }) => c.kind === 'group' && c.transform !== undefined;

  it("gives a cell its icon's shapes, and none to an area with no icon or one the map has no glyph for", () => {
    const scene = createAuditScene();
    syncAuditScene(scene, auditNodeSpecs(areas, layoutMap(areas, 900, 400), PALETTE, new Map(), null, Infinity, new Map(), GLYPHS));
    expect(cellOf(scene, 'geom').icon).toHaveLength(1);
    expect(cellOf(scene, 'ui.menu').icon).toBeUndefined();
    expect(cellOf(scene, 'core.scene').icon).toBeUndefined();
  });

  it("draws it centered at one size in the cell's ink, muted, under the badges and the label", () => {
    const scene = createAuditScene();
    syncAuditScene(scene, auditNodeSpecs(areas, layoutMap(areas, 900, 400), PALETTE, new Map(), null, Infinity, new Map(), GLYPHS));
    const data = cellOf(scene, 'geom');
    for (const pose of [{ x: 100, y: 50, width: 120, height: 80 }, { x: 0, y: 0, width: 300, height: 200 }]) {
      const cmds = paintOf(data, pose);
      const at = cmds.findIndex(isIcon);
      const icon = cmds[at] as { alpha: number; transform: ArrayLike<number>; children: { fill: { paint: { color: string } } }[] };
      const [k, , , , , , tx, ty] = Array.from(icon.transform);
      expect(k! * 20).toBe(ICON.size);
      expect([tx, ty]).toEqual([pose.x + (pose.width - ICON.size) / 2, pose.y + (pose.height - ICON.size) / 2]);
      expect(icon.alpha).toBeLessThan(0.5);
      expect(icon.children[0]!.fill.paint.color).toBe(data.ink);
      // Only the cell's fill, hatch, and edge come before it.
      expect(at).toBe(data.over ? 3 : 2);
    }
  });

  it('leaves it out of a cell too small to hold it', () => {
    const scene = createAuditScene();
    syncAuditScene(scene, auditNodeSpecs(areas, layoutMap(areas, 900, 400), PALETTE, new Map(), null, Infinity, new Map(), GLYPHS));
    expect(paintOf(cellOf(scene, 'geom'), { x: 0, y: 0, width: ICON.size + 2 * ICON.margin - 1, height: 200 }).some(isIcon)).toBe(false);
  });
});

describe('pips', () => {
  it('wrap to a row below once a row holds what the cell is wide enough for', () => {
    expect(pipsPerRowIn(40)).toBe(6);
    expect(pipsPerRowIn(16)).toBe(2);
    expect(pipsPerRowIn(6)).toBe(1);
    expect(pipCountOf(4, false, true)).toBe(5);
    expect(pipCountOf(9, true, false)).toBe(10);
  });
});

describe('outline', () => {
  const p = { x: 0, y: 0, width: 100, height: 60 };
  it('is the inset rectangle on a cell with no cut corner', () => {
    expect(outline(p, 5, 0)).toEqual({ kind: 'rect', x: 5, y: 5, width: 90, height: 50 });
  });

  it('cuts its bottom-left corner parallel to the worn corner, moved in as far as the outline is', () => {
    const path = outline(p, 5, 12);
    expect(path.kind).not.toBe('rect');
    // The diagonal sits `by` in from the cut: x + (bottom - y) = cut + by·√2 on every point of it.
    const c = 12 - 5 * (2 - Math.SQRT2);
    for (const [x, y] of [[5 + c, 55], [5, 55 - c]] as const) expect(x + (60 - y)).toBeCloseTo(12 + 5 * Math.SQRT2);
  });

  it('keeps square corners where the outline sits inside the cut', () => {
    expect(outline(p, 30, 12).kind).toBe('rect');
  });
});
