// `npm run snapshot -- <tenant> [dir]`: writes what the dashboard reads for one registered tenant as static files, for
// a build that needs no dev server (`npm run build:demo`): `<dir>/snapshot/tenants.json`, `<tenant>/map.json`, and
// `<tenant>/area/<id>.json` per area. The home directory in any path becomes `~`. `dir` defaults to `demo/`, which
// the demo build serves as its public directory; each run replaces the tenant's files there.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mainCheckout } from '../../src/batch.mjs';
import { loadConfig } from '../../src/config.mjs';
import { areaDefects } from '../../src/defects.mjs';
import { buildMap } from '../../src/map.mjs';
import { loadRunner } from '../../src/runner/index.mjs';
import { requireTenant } from '../../src/tenants.mjs';

const [tenant, dir = fileURLToPath(new URL('../demo', import.meta.url))] = process.argv.slice(2);
if (!tenant) throw new Error('usage: npm run snapshot -- <tenant> [dir]');

const home = homedir();
const scrub = (value) => JSON.stringify(value).split(home).join('~');

const cfg = await loadConfig({ config: requireTenant(tenant).config });
const root = mainCheckout(cfg);
const map = buildMap(cfg, root, await loadRunner(cfg));
const out = join(dir, 'snapshot');
const at = join(out, tenant);
rmSync(at, { recursive: true, force: true });
mkdirSync(join(at, 'area'), { recursive: true });
writeFileSync(join(out, 'tenants.json'), JSON.stringify([{ name: tenant }]));
writeFileSync(join(at, 'map.json'), scrub(map));
map.areas.forEach((area, i) => {
  writeFileSync(join(at, 'area', `${encodeURIComponent(area.id)}.json`), scrub(areaDefects(root, area.id, cfg.state, cfg.record.dir)));
  if ((i + 1) % 50 === 0 || i + 1 === map.areas.length) console.log(`area ${i + 1}/${map.areas.length}`);
});
console.log(`wrote ${at}`);
