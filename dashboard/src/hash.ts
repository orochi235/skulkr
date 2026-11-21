/** The page's URL hash: the tenant shown, and the round the map shows it after where that is a past one (`#weasel@41`). */
export interface HashState {
  readonly tenant: string;
  readonly round: number | null;
}

/** What `hash` (the page's own by default) names. */
export function readHash(hash: string = window.location.hash): HashState {
  const [name = '', at] = hash.replace(/^#/, '').split('@');
  let tenant = '';
  try {
    tenant = decodeURIComponent(name);
  } catch {
    tenant = '';
  }
  const round = Number(at);
  return { tenant, round: at !== undefined && at !== '' && Number.isInteger(round) && round >= 0 ? round : null };
}

/** The hash naming `state`. */
export const hashFor = ({ tenant, round }: HashState): string => `#${encodeURIComponent(tenant)}${round === null ? '' : `@${round}`}`;
