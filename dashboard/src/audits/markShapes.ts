/** The pin's and padlock's shapes, one definition for the map's painter and the page's SVG marks. */

/** A pin's width as a share of its height: a round head over a needle. */
export const PIN_WIDTH = 0.7;
/** A padlock's width as a share of its height. */
export const LOCK_WIDTH = 0.8;

/** A pin `size` tall, centered on `cx`, its top at `top`: its head's circle and its needle's line. */
export function pinShapeAt(cx: number, top: number, size: number) {
  const r = size * 0.26;
  return { head: { cx, cy: top + r, r }, needle: { x: cx, from: top + r, to: top + size, width: Math.max(1, size * 0.1) } };
}

/** A padlock `size` tall, centered on `cx`, its top at `top`: its solid body and its shackle's path. */
export function padlockShapeAt(cx: number, top: number, size: number) {
  const w = size * 0.6;
  const bodyTop = top + size * 0.45;
  const r = w * 0.32;
  const thick = Math.max(1, size * 0.1);
  return {
    body: { x: cx - w / 2, y: bodyTop, width: w, height: top + size - bodyTop },
    shackle: { d: `M ${cx - r} ${bodyTop} V ${top + r + thick / 2} A ${r} ${r} 0 0 1 ${cx + r} ${top + r + thick / 2} V ${bodyTop}`, width: thick },
  };
}
