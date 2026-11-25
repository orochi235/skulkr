/** The dashboard's pages: the audit map, and the saturation ledgers. */
export type PageView = 'audits' | 'saturation';

/**
 * The page's URL hash: the tenant shown, the page, the round the map shows it after where that is a past one
 * (`#weasel@41`), and on the saturation page the area picked (`#weasel/scour/core.animation`).
 */
export interface HashState {
  readonly tenant: string;
  readonly round: number | null;
  readonly view?: PageView;
  readonly area?: string | null;
}

const decode = (part: string): string => {
  try {
    return decodeURIComponent(part);
  } catch {
    return '';
  }
};

/** What `hash` (the page's own by default) names. */
export function readHash(hash: string = window.location.hash): Required<HashState> {
  const [head = '', page, ...rest] = hash.replace(/^#/, '').split('/');
  const [name = '', at] = head.split('@');
  const tenant = decode(name);
  const round = Number(at);
  // `scour` names the page; `saturation`, its first name, is still read.
  const view: PageView = page === 'scour' || page === 'saturation' ? 'saturation' : 'audits';
  const area = view === 'saturation' && rest.length ? decode(rest.join('/')) || null : null;
  return { tenant, round: at !== undefined && at !== '' && Number.isInteger(round) && round >= 0 ? round : null, view, area };
}

/** The hash naming `state`. */
export const hashFor = ({ tenant, round, view = 'audits', area = null }: HashState): string => {
  const head = `#${encodeURIComponent(tenant)}${round === null ? '' : `@${round}`}`;
  if (view === 'audits') return head;
  return `${head}/scour${area ? `/${encodeURIComponent(area)}` : ''}`;
};
