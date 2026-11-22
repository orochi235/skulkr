/** The treemap as it stood after a past round: which rounds can be picked, and each area as that round left it. */
import { lastPassOf } from './areaData';
import type { AuditArea, SkulkrMap } from './skulkrMap.types';

/** The rounds the map can be shown after, oldest first: every round it charts, or none on a map without
 *  `lastByRound` (a kept map, the demo's). */
export function pastRoundsOf(map: Pick<SkulkrMap, 'areas' | 'rounds'>): number[] {
  if (!map.areas.some((a) => a.lastByRound !== undefined)) return [];
  return [...new Set(map.rounds.map((r) => r.round))].sort((x, y) => x - y);
}

/** Each area as of `round`: its estimate then (`lastPassOf`) and the passes up to it. What is known only of now —
 *  settled, a live run's hold, the queue, lines changed since, open findings — is left out. */
export const areasAsOf = (areas: readonly AuditArea[], round: number): AuditArea[] => areas.map((a) => {
  const last = lastPassOf(a, round);
  return {
    id: a.id, group: a.group, files: a.files, ...(a.icon !== undefined ? { icon: a.icon } : {}),
    status: last ? 'due' : 'unaudited', queue: null, stage: null, passes: a.passes.filter((p) => p.round <= round), last,
  };
});

/** The ids of the areas a pass of `round` read any of; null when there is no round to ask about. */
export const readIn = (areas: readonly AuditArea[], round: number | null): ReadonlySet<string> | null =>
  round === null ? null : new Set(areas.filter((a) => a.passes.some((p) => p.round === round)).map((a) => a.id));
