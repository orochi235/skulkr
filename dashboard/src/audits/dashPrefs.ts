/** The viewer's dashboard settings: one prefs store, kept in this browser, that the prefs dialog edits and the page reads. */
import { pref, type PrefPath } from '@weasel-js/prefs';
import { usePref, usePrefsStore } from '@weasel-js/prefs/react';
import { localStorageAdapter } from '@weasel-js/storage';
import { HEAT_METRIC_SPECS, HEAT_METRICS, type HeatMetric } from './heatMetrics';
import { HEAT_SCHEMES, type HeatScheme } from './heatSchemes';

/** The most the map numbers: eight rounds of the queue, in half rounds. */
export const MAX_HALVES = 16;

/** A ramp to choose for each metric the map can shade by but defects left, whose ramp the charts share (`map.scheme`). */
function schemePrefs() {
  const others = HEAT_METRICS.filter((m): m is Exclude<HeatMetric, 'left'> => m !== 'left');
  return Object.fromEntries(others.map((m) => [m, pref.enum<HeatScheme>(HEAT_METRIC_SPECS[m].name, HEAT_METRIC_SPECS[m].scheme, HEAT_SCHEMES, {
    description: `The ramp the map shades ${HEAT_METRIC_SPECS[m].legend} along.`,
  })])) as Record<Exclude<HeatMetric, 'left'>, ReturnType<typeof pref.enum<HeatScheme>>>;
}

export const DASH_PREFS = pref.group('Dashboard', {
  map: pref.group('Map', {
    colorBy: pref.enum<HeatMetric>('Color by', 'left', HEAT_METRICS, {
      description: 'What the map shades its areas by; the legend under the map switches it too.',
    }),
    scheme: pref.enum<HeatScheme>('Heat colors: defects left', 'thermal', HEAT_SCHEMES, {
      description: 'The ramp the map shades estimated defects left along, and the rounds and calibration charts with it.',
    }),
    schemes: pref.group('Heat colors by metric', schemePrefs()),
    grayOut: pref.boolean('Gray out areas the round shown skipped', false, {
      description: 'The round picked on the slider, or the last round at now.',
    }),
    gray: pref.number('How gray', 100, {
      description: 'How much color a skipped area loses: 100% is fully gray.',
      min: 0, max: 100, step: 5, control: 'slider', unit: { scale: 1, suffix: '%' },
    }),
    loupe: pref.boolean('Loupe', false, {
      description: 'A magnifier over the map, following the pointer; F2 toggles it.',
    }),
    recut: pref.boolean('Flash recut areas', true, {
      description: 'Outline in lime, fading, the areas a round made or split as the slider reaches it.',
    }),
    upcoming: pref.number('Number the queue', 6, {
      description: 'How many half rounds of the queue to number on the map.',
      min: 0, max: MAX_HALVES, step: 1, control: 'slider',
    }),
  }),
  lanes: pref.group('Lanes', {
    hideComplete: pref.boolean('Hide complete', false, { description: 'Hide a lane once its pass is done.' }),
    mode: pref.enum('View', 'steps', ['steps', 'clock'], { description: "As a grid of steps, or on the run's clock." }),
  }),
});

export type DashPrefs = typeof DASH_PREFS;

/** The page's one store over `DASH_PREFS`; every component naming it shares it. */
export const useDashPrefs = () => usePrefsStore(DASH_PREFS, { storage: localStorageAdapter, prefix: 'skulkr.dashboard.prefs.' });

/** One dashboard setting as React state. */
export const useDashPref = <P extends PrefPath<DashPrefs>>(path: P) => usePref(useDashPrefs(), path);
