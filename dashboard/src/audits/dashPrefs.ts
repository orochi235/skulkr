/** The viewer's dashboard settings: one prefs store, kept in this browser, that the prefs dialog edits and the page reads. */
import { pref, type PrefPath } from '@weasel-js/prefs';
import { usePref, usePrefsStore } from '@weasel-js/prefs/react';
import { localStorageAdapter } from '@weasel-js/storage';

/** The most the map numbers: eight rounds of the queue, in half rounds. */
export const MAX_HALVES = 16;

export const DASH_PREFS = pref.group('Dashboard', {
  map: pref.group('Map', {
    grayOut: pref.boolean('Gray out areas the round shown skipped', false, {
      description: 'The round picked on the slider, or the last round at now.',
    }),
    gray: pref.number('How gray', 100, {
      description: 'How much color a skipped area loses: 100% is fully gray.',
      min: 0, max: 100, step: 5, control: 'slider', unit: { scale: 1, suffix: '%' },
    }),
    upcoming: pref.number('Number the queue', 6, {
      description: 'How many half rounds of the queue to number on the map.',
      min: 0, max: MAX_HALVES, step: 1, control: 'slider',
    }),
  }),
  lanes: pref.group('Lanes', {
    hideComplete: pref.boolean('Hide complete', false, { description: 'Hide a lane once its pass is done.' }),
    mode: pref.enum('View', 'clock', ['clock', 'steps'], { description: "On the run's clock, or as a grid of steps." }),
  }),
});

export type DashPrefs = typeof DASH_PREFS;

/** The page's one store over `DASH_PREFS`; every component naming it shares it. */
export const useDashPrefs = () => usePrefsStore(DASH_PREFS, { storage: localStorageAdapter, prefix: 'skulkr.dashboard.prefs.' });

/** One dashboard setting as React state. */
export const useDashPref = <P extends PrefPath<DashPrefs>>(path: P) => usePref(useDashPrefs(), path);
