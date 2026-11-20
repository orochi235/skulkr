import { existsSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { activeLinks } from '@msb235/alpo/vite';
import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The third-party modules a linked checkout brings, which vitest would load outside vite and so past `dedupe`:
 * react-aria there would take the checkout's React, a second copy. Inlined, they take the app's. React itself stays
 * external, the one copy everything then shares.
 */
function linkedDeps(): RegExp[] {
  return activeLinks(fileURLToPath(new URL('.', import.meta.url))).flatMap(({ checkout }) => {
    const react = join(checkout, 'node_modules/react');
    if (!existsSync(react)) return [];
    const modules = dirname(realpathSync(react));
    return [new RegExp(`^${escape(modules)}/(?!(react|react-dom|scheduler)/)`)];
  });
}

export default mergeConfig(viteConfig, defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts'],
    server: { deps: { inline: linkedDeps() } },
  },
}));
