import { useEffect, useState } from 'react';
import { SegmentedBar } from '@weasel-js/ui/components/Segmented';
import { hashFor, readHash, type PageView } from './hash';

/** The dashboard's pages, in the order the switch shows them: the one list every page's switch reads. */
export const PAGES = [{ value: 'audits', label: 'Audits' }, { value: 'saturation', label: 'Saturation' }] as const satisfies readonly { value: PageView; label: string }[];

/** The page the URL hash names, following it as it changes. */
export function usePageView(): PageView {
  const [view, setView] = useState(() => readHash().view);
  useEffect(() => {
    const onHash = () => setView(readHash().view);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return view;
}

/** The header's switch between the pages, for tenant `tenant`: each choice is a new history entry, so Back returns. */
export function PageSwitch({ tenant, current }: { tenant: string | null; current: PageView }) {
  const go = (view: PageView | null) => {
    if (!view || view === current) return;
    window.location.hash = hashFor({ tenant: tenant ?? readHash().tenant, round: null, view });
  };
  return <SegmentedBar aria-label="Page" size="sm" items={PAGES} value={current} onChange={go} />;
}
