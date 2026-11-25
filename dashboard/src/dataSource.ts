import { TENANTS_PATH, tenantAreaPath, tenantMapPath, tenantPinPath, tenantTailPath, tenantLogPath } from '@shared/routes';

/**
 * Whether this build reads a snapshot written by `scripts/snapshot.mjs` instead of the dev server: static files a
 * plain host can serve, one per area, since it cannot answer the dev server's `?id=`.
 */
export const SNAPSHOT = import.meta.env.VITE_SKULKR_SNAPSHOT === '1';

const enc = encodeURIComponent;

/** Where the page reads the tenants, under the app's base path. */
export const tenantsUrl = (base: string): string => (SNAPSHOT ? `${base}snapshot/tenants.json` : `${base}${TENANTS_PATH}`);

/** Where it reads tenant `name`'s audit map. */
export const mapUrl = (base: string, name: string): string =>
  SNAPSHOT ? `${base}snapshot/${enc(name)}/map.json` : `${base}${tenantMapPath(name)}`;

/** Where it reads one area's defects in tenant `name`. */
export const areaUrlFor = (base: string, name: string) => (id: string): string =>
  SNAPSHOT ? `${base}snapshot/${enc(name)}/area/${enc(id)}.json` : `${base}${tenantAreaPath(name)}?id=${enc(id)}`;

/** Where a POST pins or unpins one area in tenant `name`; null for a snapshot, which pins nothing. */
export const pinUrlFor = (base: string, name: string): ((id: string, on: boolean) => string) | null =>
  SNAPSHOT ? null : (id, on) => `${base}${tenantPinPath(name)}?id=${enc(id)}&on=${on ? 1 : 0}`;

/** Where it reads the end of an area's newest job log in the running round; null for a snapshot, which has none. */
export const tailUrlFor = (base: string, name: string): ((id: string) => string) | null =>
  SNAPSHOT ? null : (id) => `${base}${tenantTailPath(name)}?id=${enc(id)}`;

/** Where it reads the end of the running round's log; null for a snapshot, which has none. */
export const logUrlFor = (base: string, name: string): string | null => (SNAPSHOT ? null : `${base}${tenantLogPath(name)}`);
