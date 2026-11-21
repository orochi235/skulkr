import { Slider } from '@weasel-js/ui/components/Slider';
import s from './RoundPicker.module.css';

/** What the picker reads for `round`: the round the map is shown after, or now. */
export const asOfText = (round: number | null): string => (round === null ? 'now' : `after round ${round}`);

/** A slider over `rounds` and then now, the map shown as it stood after the round picked. */
export function RoundPicker({ rounds, value, onChange }: {
  rounds: readonly number[]; value: number | null; onChange: (round: number | null) => void;
}) {
  const at = value === null ? rounds.length : Math.max(0, rounds.indexOf(value));
  const pick = (i: number) => onChange(i >= rounds.length ? null : rounds[i]!);
  return (
    <div className={s.picker}>
      <span className={s.caption}>map as of</span>
      <Slider
        className={s.slider} aria-label="Show the map as it stood after a round"
        min={0} max={rounds.length} step={1} snap="strict" thumbShape="dot"
        trackHeight="var(--wzl-slider-track-h)" thumbSize="var(--wzl-slider-thumb-size)"
        thumbs={[{ value: at, valueText: asOfText(value) }]}
        onInput={([t]) => pick(t!.value)} onChange={([t]) => pick(t!.value)}
        readoutPlacement="none"
      />
      <output className={s.readout}>{asOfText(value)}</output>
    </div>
  );
}
