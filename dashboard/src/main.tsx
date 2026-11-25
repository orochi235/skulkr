import '@weasel-js/theme/tokens.css';
import '@weasel-js/theme/fonts.css';
import '@weasel-js/core/style.css';
import '@weasel-js/ui/style.css';
import './app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import * as weaselCore from '@weasel-js/core';
import { WeaselProvider } from '@weasel-js/core';
import { IconRegistryProvider } from '@weasel-js/icons/react';
import { defineTheme } from '@weasel-js/theme';
import { ThemeProvider } from '@weasel-js/theme/react';
import { AuditsPage } from '@dash/audits/AuditsPage';
import { ColorModeProvider } from '@dash/colorMode';
import { ICONS } from '@dash/icons';

// Before React renders and the snapshot loads, so the map's shaders compile meanwhile. Unreleased (weasel 06adf720cf):
// absent from the pinned 2.0.0, so a no-op there, and live through the alpo link.
(weaselCore as { warmPrograms?: () => void }).warmPrograms?.();

const theme = defineTheme({ name: 'skulkr-dashboard' });

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <IconRegistryProvider icons={ICONS}>
      <ColorModeProvider>
        {(mode) => (
          <ThemeProvider theme={theme} selection={{ mode }} className="app-theme">
            <WeaselProvider>
              <AuditsPage />
            </WeaselProvider>
          </ThemeProvider>
        )}
      </ColorModeProvider>
    </IconRegistryProvider>
  </StrictMode>,
);
