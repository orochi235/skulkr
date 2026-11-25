import { useLayoutEffect, useMemo, useRef } from 'react';
import { ResizeHandle } from '@weasel-js/ui/components/ResizeHandle';
import { Shell } from '@dash/Shell';
import { AppTitle } from '@dash/AppTitle';
import { SNAPSHOT, saturationUrl, tenantsUrl } from '@dash/dataSource';
import { PageSwitch } from '@dash/pageView';
import { TenantTitle } from '@dash/tenants/TenantTitle';
import { useTenantChoice, useTenants } from '@dash/tenants/useTenants';
import { titleFor } from '@dash/title';
import { readSize, useViewerPref } from '@dash/audits/viewerPref';
import { usd } from './format';
import { LedgerDetail } from './LedgerDetail';
import { LedgerList } from './LedgerList';
import { useSaturation } from './useSaturation';
import { useSaturationArea } from './useSaturationArea';
import s from './SaturationPage.module.css';

const LIST = { min: 280, max: 900, initial: 460 } as const;

/** Each saturation ledger of a tenant beside the picked one's distinct defects. */
export function SaturationPage({ base = import.meta.env.BASE_URL, dev = true }: { base?: string; dev?: boolean } = {}) {
  const tenants = useTenants({ url: tenantsUrl(base), dev });
  const names = tenants.status === 'ready' ? tenants.names : [];
  const [tenant, choose] = useTenantChoice(names);
  const state = useSaturation(tenant === null ? null : saturationUrl(base, tenant));
  const [picked, pick] = useSaturationArea(tenant);
  const [listWidth, setListWidth, keepListWidth] = useViewerPref('saturation.list', LIST.initial, readSize);
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    root.current?.style.setProperty('--saturation-list-width', `${listWidth}px`);
  }, [listWidth]);

  const ledgers = state.status === 'ready' ? state.ledgers : [];
  const ledger = ledgers.find((l) => l.id === picked) ?? null;
  const totals = useMemo(() => ({
    defects: ledgers.reduce((n, l) => n + l.distinct, 0),
    costUsd: ledgers.reduce((n, l) => n + l.costUsd, 0),
  }), [ledgers]);

  const heading = tenant !== null ? <TenantTitle names={names} current={tenant} onChoose={choose} /> : <AppTitle />;
  const header = state.status === 'ready' ? (
    <span className={s.stamp}>
      {ledgers.length.toLocaleString()} ledgers · {totals.defects.toLocaleString()} defects · {usd(totals.costUsd)}
    </span>
  ) : null;
  return (
    <Shell title={titleFor(tenant)} heading={heading} nav={dev && !SNAPSHOT ? <PageSwitch tenant={tenant} current="saturation" /> : null} header={header}>
      <div ref={root} className={s.root}>
        {state.status === 'loading' && <p className={s.note}>Reading the saturation ledgers…</p>}
        {state.status === 'failed' && <p className={s.note}>Couldn&apos;t read the saturation ledgers: {state.error}</p>}
        {state.status === 'ready' && state.error && <p className={`${s.note} ${s.stale}`}>The last refresh failed ({state.error}); showing the ledgers before it.</p>}
        {state.status === 'ready' && !ledgers.length && (
          <p className={s.note}>No saturation ledger yet. <code>skulkr saturate &lt;area&gt;</code> starts one.</p>
        )}
        {state.status === 'ready' && ledgers.length > 0 && (
          <div className={s.main}>
            <LedgerList ledgers={ledgers} picked={picked} onPick={(id) => pick(id === picked ? null : id)} />
            <ResizeHandle value={listWidth} min={LIST.min} max={LIST.max} onInput={setListWidth} onChange={keepListWidth} aria-label="Resize the ledger list" />
            {ledger ? <LedgerDetail ledger={ledger} /> : <p className={s.note}>Pick an area for its defects.</p>}
          </div>
        )}
      </div>
    </Shell>
  );
}
