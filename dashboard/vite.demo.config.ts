import { mergeConfig } from 'vite';
import base from './vite.config.ts';

// `npm run build:demo`: the page reading the snapshot in `demo/` (`npm run snapshot`) rather than the dev server, for a
// project site under `/skulkr/`. Its `--mode demo` loads `.env.demo`, which sets VITE_SKULKR_SNAPSHOT.
export default mergeConfig(base, { base: '/skulkr/', publicDir: 'demo' });
