import type { ReactElement, ReactNode } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { IconRegistryProvider } from '@weasel-js/icons/react';
import { ICONS } from '@dash/icons';

function WithIcons({ children }: { children: ReactNode }) {
  return <IconRegistryProvider icons={ICONS}>{children}</IconRegistryProvider>;
}

/** `render` with every glyph table the app draws from registered, as `main.tsx` registers them. */
export const renderWithIcons = (ui: ReactElement, options: RenderOptions = {}) => render(ui, { wrapper: WithIcons, ...options });
