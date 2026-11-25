/** Where the dashboard's dev server serves the tenants it reads, under the app's base path: `[{ name }]`. */
export const TENANTS_PATH = 'api/tenants';

/** Where it serves tenant `name`'s audit map. */
export const tenantMapPath = (name: string): string => `api/t/${encodeURIComponent(name)}/map`;

/** Where it serves one area's defects in tenant `name`, every round's: `<path>?id=<area>`. */
export const tenantAreaPath = (name: string): string => `api/t/${encodeURIComponent(name)}/area`;

/** Where a POST pins (`?id=<area>&on=1`) or unpins (`on=0`) an area in tenant `name`. */
export const tenantPinPath = (name: string): string => `api/t/${encodeURIComponent(name)}/pin`;

/** The header a map answer carries, URI-encoded, when the builds since that map failed: why the last one did. */
export const STALE_HEADER = 'X-Skulkr-Build-Error';

/** A tenant route's parts: `{ tenant, what }` for `…/api/t/<name>/<map|area|pin>`, else null. */
export function parseTenantPath(path: string): { readonly tenant: string; readonly what: 'map' | 'area' | 'pin' } | null {
  const m = /\/api\/t\/([^/]+)\/(map|area|pin)$/.exec(path);
  return m ? { tenant: decodeURIComponent(m[1]!), what: m[2] as 'map' | 'area' | 'pin' } : null;
}
