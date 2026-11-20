import '@weasel-js/theme/tokens.css';
import '@weasel-js/theme/fonts.css';
import '@weasel-js/core/style.css';
import '@weasel-js/ui/style.css';
import './app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { WeaselProvider } from '@weasel-js/core';
import { IconRegistryProvider } from '@weasel-js/icons/react';
import { defineTheme } from '@weasel-js/theme';
import { ThemeProvider } from '@weasel-js/theme/react';
import { AuditsPage } from '@dash/audits/AuditsPage';
import { ICONS } from '@dash/icons';

const theme = defineTheme({ name: 'skulk-dashboard' });

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <IconRegistryProvider icons={ICONS}>
      <ThemeProvider theme={theme} selection={{ mode: 'auto' }} className="app-theme">
        <WeaselProvider>
          <AuditsPage />
        </WeaselProvider>
      </ThemeProvider>
    </IconRegistryProvider>
  </StrictMode>,
);
