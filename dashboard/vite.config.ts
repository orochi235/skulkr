import { fileURLToPath } from 'node:url';
import { alpo } from '@msb235/alpo/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { wake } from 'vite-plugin-wake';
import { skulkrMapPlugin } from './server/plugin.ts';

const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export const DEV_PORT = 5214;

export default defineConfig({
  plugins: [react(), alpo({ from: at('.') }), skulkrMapPlugin(), wake({ fullReload: true })],
  resolve: {
    alias: { '@dash': at('./src'), '@shared': at('./shared') },
    // Linked from a weasel checkout, its own React would otherwise load twice.
    dedupe: ['react', 'react-dom'],
  },
  server: { host: '::', port: DEV_PORT, strictPort: true },
  preview: { host: '::', port: DEV_PORT, strictPort: true },
});
