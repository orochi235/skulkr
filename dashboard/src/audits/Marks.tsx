import { LOCK_WIDTH, PIN_WIDTH, padlockShapeAt, pinShapeAt } from './markShapes';

/** The map's pin, `size` px tall, in the text's color. */
export function PinMark({ size = 11, className, label }: { size?: number; className?: string; label?: string }) {
  const width = size * PIN_WIDTH;
  const { head, needle } = pinShapeAt(width / 2, 0, size);
  return (
    <svg className={className} width={width} height={size} viewBox={`0 0 ${width} ${size}`} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <circle cx={head.cx} cy={head.cy} r={head.r} fill="currentColor" />
      <path d={`M ${needle.x} ${needle.from} V ${needle.to}`} stroke="currentColor" strokeWidth={needle.width} />
    </svg>
  );
}

/** The map's padlock, `size` px tall, in the text's color. */
export function LockMark({ size = 11, className, label }: { size?: number; className?: string; label?: string }) {
  const width = size * LOCK_WIDTH;
  const { body, shackle } = padlockShapeAt(width / 2, 0, size);
  return (
    <svg className={className} width={width} height={size} viewBox={`0 0 ${width} ${size}`} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <rect {...body} fill="currentColor" />
      <path d={shackle.d} fill="none" stroke="currentColor" strokeWidth={shackle.width} />
    </svg>
  );
}
