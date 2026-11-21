import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { tryParseColor, watchThemeOf } from '@weasel-js/core';
import { deepEqual } from '@weasel-js/registry';
import type { AuditPalette } from './auditScene';
import { AUDIT_PHASES, phaseClass, type AuditPhase } from './phases';
import s from './palette.module.css';

/** Where the theme gives nothing the renderer can parse (jsdom resolves no `var()`): plain grays, never a copy of
 *  `palette.module.css`, which alone defines the colors. */
const FALLBACK: AuditPalette = {
  panel: '#fff', band: '#eee', ink: '#000', inkInverse: '#fff', uncharted: '#ddd', hatch: '#999',
  depth: ['#222', '#555', '#888', '#bbb', '#eee'], settled: '#ddd', live: '#444',
  font: { ui: 'sans-serif', numeric: 'monospace' },
  phase: Object.fromEntries(AUDIT_PHASES.map((p) => [p, '#777'])) as Record<AuditPhase, string>,
};

const KEYS = ['panel', 'band', 'ink', 'inkInverse', 'uncharted', 'hatch', 'depth0', 'depth1', 'depth2', 'depth3', 'depth4', 'settled', 'live'] as const;
type Key = typeof KEYS[number];

/** The first family a `font-family` list names, unquoted: the one face a canvas is given, which serves no list. */
function firstFamily(list: string): string | undefined {
  const first = list.split(',')[0]?.trim().replace(/^(["'])(.*)\1$/, '$2');
  return first || undefined;
}

function read(host: HTMLElement): AuditPalette {
  const probe = (selector: string, fallback: string): string => {
    const color = getComputedStyle(host.querySelector(selector)!).color;
    return color && tryParseColor(color) ? color : fallback;
  };
  const at = (key: Key, fallback: string): string => probe(`[data-key="${key}"]`, fallback);
  const phase = Object.fromEntries(AUDIT_PHASES.map((p) => [p, probe(`[data-phase="${p}"]`, FALLBACK.phase[p])])) as Record<AuditPhase, string>;
  return {
    panel: at('panel', FALLBACK.panel),
    band: at('band', FALLBACK.band),
    ink: at('ink', FALLBACK.ink),
    inkInverse: at('inkInverse', FALLBACK.inkInverse),
    uncharted: at('uncharted', FALLBACK.uncharted),
    hatch: at('hatch', FALLBACK.hatch),
    depth: [at('depth0', FALLBACK.depth[0]), at('depth1', FALLBACK.depth[1]), at('depth2', FALLBACK.depth[2]), at('depth3', FALLBACK.depth[3]), at('depth4', FALLBACK.depth[4])],
    settled: at('settled', FALLBACK.settled),
    live: at('live', FALLBACK.live),
    phase,
    font: {
      ui: firstFamily(getComputedStyle(host.querySelector('[data-font="ui"]')!).fontFamily) ?? FALLBACK.font.ui,
      numeric: firstFamily(getComputedStyle(host.querySelector('[data-font="numeric"]')!).fontFamily) ?? FALLBACK.font.numeric,
    },
  };
}


/**
 * The map's colors, resolved from `palette.module.css` by the browser and read again whenever the theme or
 * the color mode may have changed. Render `probes` inside the element that carries the palette class.
 */
export function useAuditPalette(): { probes: ReactNode; palette: AuditPalette } {
  const ref = useRef<HTMLDivElement>(null);
  const [palette, setPalette] = useState<AuditPalette>(FALLBACK);
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host) return;
    const refresh = () => setPalette((was) => {
      const next = read(host);
      return deepEqual(was, next) ? was : next;
    });
    refresh();
    return watchThemeOf(() => host, refresh);
  }, []);
  const probes = (
    <div ref={ref} className={s.probes} aria-hidden="true">
      {KEYS.map((key) => <span key={key} data-key={key} className={s[key]} />)}
      <span data-font="ui" className={s.fontUi} />
      <span data-font="numeric" className={s.fontNumeric} />
      {AUDIT_PHASES.map((p) => <span key={p} data-phase={p} className={`${s.phase} ${phaseClass(p)}`} />)}
    </div>
  );
  return { probes, palette };
}
