import { AuditsPage } from '@dash/audits/AuditsPage';
import { SaturationPage } from '@dash/saturation/SaturationPage';
import { usePageView } from '@dash/pageView';

/** The page the URL hash names. */
export function Pages() {
  return usePageView() === 'saturation' ? <SaturationPage /> : <AuditsPage />;
}
