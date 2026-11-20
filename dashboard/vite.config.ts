import { fileURLToPath } from 'node:url';
import { alpo } from '@msb235/alpo/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { wake } from 'vite-plugin-wake';
import { skulkMapPlugin } from './server/plugin.ts';

const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export const DEV_PORT = 5214;

export default defineConfig({
  plugins: [react(), alpo({ from: at('.') }), skulkMapPlugin(), wake({ fullReload: true })],
  resolve: {
    alias: { '@dash': at('./src'), '@shared': at('./shared') },
    // Linked from a weasel checkout, its own React would otherwise load twice, and its own React Aria too: a trigger
    // from one copy and weasel's popover from the other share no state, so the popover never opens.
    dedupe: ['react', 'react-dom', 'react-aria', 'react-aria-components', 'react-stately'],
  },
  server: { host: '::', port: DEV_PORT, strictPort: true },
  preview: { host: '::', port: DEV_PORT, strictPort: true },
});
