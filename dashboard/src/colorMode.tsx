import { createContext, useContext, type ReactElement, type ReactNode } from 'react';
import { isColorModePreference, type ColorModePreference } from '@weasel-js/theme';
import { useResolvedColorMode, type ColorMode, type ColorModePreferenceState } from '@weasel-js/theme/react';
import { useViewerPref } from '@dash/audits/viewerPref';

const ColorModeContext = createContext<ColorModePreferenceState | null>(null);

const readPreference = (s: string): ColorModePreference | undefined => (isColorModePreference(s) ? s : undefined);

/**
 * Holds the viewer's color mode, kept between visits: light, dark, or `auto`, which follows the system live. Hands
 * `children` the mode it resolves to, for the `ThemeProvider` selection.
 */
export function ColorModeProvider({ children }: { children: (mode: ColorMode) => ReactNode }): ReactElement {
  const [preference, set, keep] = useViewerPref<ColorModePreference>('colorMode', 'auto', readPreference);
  const mode = useResolvedColorMode(preference);
  const state: ColorModePreferenceState = { preference, mode, setPreference: (next) => { set(next); keep(next); } };
  return <ColorModeContext.Provider value={state}>{children(mode)}</ColorModeContext.Provider>;
}

/** The viewer's color mode and how to change it; `null` outside a {@link ColorModeProvider}. */
export function useColorModeChoice(): ColorModePreferenceState | null {
  return useContext(ColorModeContext);
}
