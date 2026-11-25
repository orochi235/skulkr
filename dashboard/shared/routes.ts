/** Where the dashboard's dev server serves the tenants it reads, under the app's base path: `[{ name }]`. */
export const TENANTS_PATH = 'api/tenants';

/** Where it serves tenant `name`'s audit map. */
export const tenantMapPath = (name: string): string => `api/t/${encodeURIComponent(name)}/map`;

/** Where it serves one area's defects in tenant `name`, every round's: `<path>?id=<area>`. */
export const tenantAreaPath = (name: string): string => `api/t/${encodeURIComponent(name)}/area`;

/** Where a POST pins (`?id=<area>&on=1`) or unpins (`on=0`) an area in tenant `name`. */
export const tenantPinPath = (name: string): string => `api/t/${encodeURIComponent(name)}/pin`;

/** Where it serves the end of an area's newest job log in its running round: `<path>?id=<area>`. */
export const tenantTailPath = (name: string): string => `api/t/${encodeURIComponent(name)}/tail`;

/** Where it serves the end of the running round's `night.log`. */
export const tenantLogPath = (name: string): string => `api/t/${encodeURIComponent(name)}/log`;

/** Where it pushes tenant `name`'s map, and the areas a running round touches, as server-sent events. */
export const tenantEventsPath = (name: string): string => `api/t/${encodeURIComponent(name)}/events`;

/** Where it serves tenant `name`'s saturation ledgers, each summed up with its defects (`skulkr saturate ls --json`). */
export const tenantSaturationPath = (name: string): string => `api/t/${encodeURIComponent(name)}/saturation`;

/** The header a map answer carries, URI-encoded, when the builds since that map failed: why the last one did. */
export const STALE_HEADER = 'X-Skulkr-Build-Error';

/** What a tenant route serves. */
export type TenantRoute = 'map' | 'area' | 'pin' | 'tail' | 'log' | 'events' | 'saturation';

/** A tenant route's parts: `{ tenant, what }` for `…/api/t/<name>/<map|area|pin|tail|log|events|saturation>`, else null. */
export function parseTenantPath(path: string): { readonly tenant: string; readonly what: TenantRoute } | null {
  const m = /\/api\/t\/([^/]+)\/(map|area|pin|tail|log|events|saturation)$/.exec(path);
  return m ? { tenant: decodeURIComponent(m[1]!), what: m[2] as TenantRoute } : null;
}
