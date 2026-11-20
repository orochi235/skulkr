// `npm run typecheck`. tsc knows nothing of alpo, so with weasel linked it would check against npm's copy, which
// lacks what the link is for. While a link is active this writes `tsconfig.alpo.json` (gitignored, removed after
// the run), whose `paths` send each linked package's `exports` to the checkout's built types, and React's to the
// app's own copy so the two sides share one; then it runs tsc on that. `--write` writes the config and runs
// nothing, for a tsc run elsewhere (an editor, a fleet node).
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { activeLinks } from '@msb235/alpo/vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const rel = (path) => `./${relative(root, path)}`;

/** Each import specifier a package's `exports` answers with types, and the file that holds them. */
function typedExports(name, dir) {
  const { exports = {} } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  return Object.entries(exports).flatMap(([key, target]) => {
    const types = typeof target === 'object' && target !== null ? target.types : undefined;
    return types ? [[key === '.' ? name : `${name}${key.slice(1)}`, [rel(join(dir, types))]]] : [];
  });
}

const links = activeLinks(root);
let project = 'tsconfig.json';
if (links.length) {
  const own = JSON.parse(readFileSync(join(root, 'tsconfig.json'), 'utf8')).compilerOptions.paths ?? {};
  const linked = links.flatMap((a) => [...a.packages].flatMap(([name, dir]) => typedExports(name, dir)));
  const react = Object.fromEntries(['react', 'react-dom'].flatMap((n) => [
    [n, [`./node_modules/@types/${n}`]], [`${n}/*`, [`./node_modules/@types/${n}/*`]],
  ]));
  project = 'tsconfig.alpo.json';
  const paths = { ...own, ...react, ...Object.fromEntries(linked) };
  writeFileSync(join(root, project), `${JSON.stringify({ extends: './tsconfig.json', compilerOptions: { paths } }, null, 2)}\n`);
  for (const a of links) console.log(`typecheck: ${a.lib} from ${a.checkout}`);
}
if (process.argv.includes('--write')) process.exit(0);
const tsc = spawnSync('npx', ['tsc', '--noEmit', '-p', project], { cwd: root, stdio: 'inherit' });
if (project !== 'tsconfig.json') rmSync(join(root, project), { force: true });
process.exit(tsc.status ?? 1);
