import type { HeatScale } from './areaData';
import s from './HeatLegend.module.css';

const valueText = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

/** A tick's place along the bar is the one thing about it no class can name. */
const placeAt = (el: HTMLElement | null, f: number) => { el?.style.setProperty('--at', f.toFixed(4)); };

/** A ramp's own stops on its bar, where it is not the page's (`--audit-depth-*`). */
const rampOn = (el: HTMLElement | null, stops: readonly string[] | null) => {
  for (let i = 0; i < 5; i++) {
    if (stops?.[i]) el?.style.setProperty(`--audit-depth-${i}`, stops[i]!);
    else el?.style.removeProperty(`--audit-depth-${i}`);
  }
};

/** The heat ramp as one bar, each tick at the place the scale puts its value: round values spaced evenly, then the top.
 *  `stops` draws the bar in a ramp of its own; by default it is the page's. */
export function HeatLegend({ heat, stops = null }: { heat: HeatScale; stops?: readonly string[] | null }) {
  return (
    <span className={s.legend}>
      <i className={s.bar} ref={(el) => rampOn(el, stops)} />
      <span className={s.ticks}>
        {heat.ticks.map((t) => (
          <span key={t.label} ref={(el) => placeAt(el, heat.at(t.value))} className={s.tick} title={`${t.label}: ${valueText(t.value)}`}>
            {t.label === 'top' ? `${valueText(t.value)}+` : valueText(t.value)}
          </span>
        ))}
      </span>
    </span>
  );
}
