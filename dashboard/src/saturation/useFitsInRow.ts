import { type RefObject, useLayoutEffect, useState } from 'react';

/**
 * Whether `item`, the last box of the wrapping flex row `row`, fits on the row's first line beside the boxes before it,
 * rechecked whenever the row resizes. While it does not fit it is taken out of the flow (its caller hides it), so it is
 * measured at its own natural width rather than where it wrapped to.
 */
export function useFitsInRow(row: RefObject<HTMLElement | null>, item: RefObject<HTMLElement | null>): boolean {
  const [fits, setFits] = useState(false);
  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return undefined;
    const check = () => {
      const last = item.current;
      if (!last) return;
      const others = [...el.children].filter((c) => c !== last) as HTMLElement[];
      if (!others.length) return setFits(true);
      const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
      // The others must sit on one line for the item to join it.
      const oneLine = others.every((c) => c.offsetTop === others[0]!.offsetTop);
      const used = others.reduce((sum, c) => sum + c.offsetWidth, 0) + gap * others.length;
      setFits(oneLine && used + last.scrollWidth <= el.clientWidth);
    };
    check();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(check);
    observer.observe(el);
    for (const c of el.children) observer.observe(c);
    return () => observer.disconnect();
  }, [row, item]);
  return fits;
}
