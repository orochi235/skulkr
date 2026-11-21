import { describe, expect, it } from 'vitest';
import { glyphCommands, glyphPathsOf } from './glyph';

describe('a glyph', () => {
  it("reads each shape as stroked in the icon root's defaults, or filled where it says so", () => {
    const paths = glyphPathsOf('<line x1="2" y1="2" x2="18" y2="18"/><circle cx="10" cy="10" r="3" fill="currentColor" stroke="none"/>');
    expect(paths).toHaveLength(2);
    expect(paths[0]).toMatchObject({ fill: false, stroke: { width: 1.5, cap: 'round', join: 'round' } });
    expect(paths[1]).toMatchObject({ fill: true });
    expect(paths[1]!.stroke).toBeUndefined();
  });

  it('keeps a group\'s own stroke width and drops shapes that paint nothing', () => {
    const paths = glyphPathsOf('<g stroke-width="2"><rect x="3" y="3" width="14" height="14"/></g><path d="M 0 0 L 1 1" stroke="none"/>');
    expect(paths).toHaveLength(1);
    expect(paths[0]!.stroke?.width).toBe(2);
  });

  it('draws in one ink at one opacity, its 20-unit frame scaled to the box it is given', () => {
    const cmd = glyphCommands(glyphPathsOf('<circle cx="10" cy="10" r="3" fill="currentColor" stroke="none"/>'), { x: 30, y: 40, size: 24 }, '#123456', 0.3);
    expect(cmd).toMatchObject({ kind: 'group', alpha: 0.3, children: [{ kind: 'path', fill: { paint: { color: '#123456' } } }] });
    const m = (cmd as { transform: ArrayLike<number> }).transform;
    expect(Array.from(m)).toEqual([1.2, 0, 0, 0, 1.2, 0, 30, 40, 1]);
  });
});
