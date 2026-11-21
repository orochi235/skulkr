/** The lane every area of a run shares once its own is done: the batch, then the batch's fleet runs. */
import type { SpanStripSpan } from '@weasel-js/ui/components/SpanStrip';
import { phaseColor } from './phases';
import { NODE_SEP } from './runData';
import type { AuditRun, FleetProgress, GateFailures } from './skulkrMap.types';

/** The steps every area shares once its own lane is done, in order. The fleet run's column also holds the waits before
 *  it (for the merge lock, then for the fleet), a red run's capstone repair before it runs again, and the fast-forward
 *  after it, which is instant. */
const SHARED_STEPS = [
  { id: 'batch', label: 'batch', steps: ['batch'] },
  { id: 'fleet', label: 'fleet run', steps: ['merge-wait', 'fleet-wait', 'fleet', 'repair', 'merge'] },
] as const;

/** The steps where the fleet run's column is waiting for its turn rather than running. */
const FLEET_WAITS: readonly string[] = ['merge-wait', 'fleet-wait'];

/** Whether the run has reached the steps its areas share: the batch and the fleet run. */
export const inSharedSteps = (run: AuditRun): boolean =>
  !run.running || SHARED_STEPS.some((s) => (s.steps as readonly string[]).includes(run.step));

/** The ramp's cold colors the gate's runs take in turn, a stripe each in the fleet column, so none reads as a step of
 *  an area's own. */
const GATE_PHASES = ['match', 'review'] as const;

/** The batch gate's runs, each a stripe in the fleet column, with its color; one stripe where the map names none. */
export const gateRunsOf = (run: AuditRun) => {
  const named = run.gateRuns?.length ? run.gateRuns : [{ id: 'tests', label: 'fleet run' }];
  return named.map((g, i) => ({ ...g, phase: GATE_PHASES[i % GATE_PHASES.length]! }));
};

/** A running fleet run's label: the node running it first, where known, then what it is and how far it has got. */
const activeGateLabel = (name: string, node: string | null, fleet: FleetProgress | null, fill: number): string =>
  [...(node ? [node] : []), name, ...(fleet ? [`${Math.round(fill * 100)}%`] : [])].join(NODE_SEP);

/** A gate run's failures in a few words: how many failed, and in how many files where that is fewer. */
const failedText = (f: GateFailures): string =>
  `${f.count.toLocaleString()} failed${f.files < f.count ? ` in ${f.files.toLocaleString()} file${f.files === 1 ? '' : 's'}` : ''}`;

/** Whether a shared-lane span's label leads with the node running it, the part that pulses. */
export const leadsWithNode = (span: SpanStripSpan, run: AuditRun): boolean =>
  !span.id.startsWith('fleet-') || !!run.gateNodes?.[span.id.slice('fleet-'.length)];

const GATE_SPAN_STATE = { running: 'active', passed: 'done', failed: 'failed' } as const;

/** The run's lane for every area at once: the batch, then its gate's runs side by side, a fleet run filled by how
 *  far it has got, or saying it waits for its turn. A finished round says how each fleet run ended, and a red round
 *  whose batch runs again shows it running. */
export function sharedSpansOf(run: AuditRun): SpanStripSpan[] {
  const gateRuns = gateRunsOf(run);
  const red = !run.running && /^red\b/.test(run.report ?? '');
  const again = !run.running && !!run.rerun;
  const at = run.running ? SHARED_STEPS.findIndex((s) => (s.steps as readonly string[]).includes(run.step))
    : red || again ? SHARED_STEPS.findIndex((s) => s.id === 'fleet') : SHARED_STEPS.length;
  const waiting = run.running && FLEET_WAITS.includes(run.step);
  const stepState = (i: number) => (i < at ? 'done' : i === at ? (waiting ? 'pending' : 'active') : 'pending');
  return SHARED_STEPS.flatMap((s, i): SpanStripSpan[] => {
    if (s.id !== 'fleet') {
      const state = stepState(i);
      const fill = state === 'done' ? 1 : 0;
      return [{ id: s.id, start: i, ms: 1, trackSpan: gateRuns.length, state, fill, label: s.label, color: phaseColor('fix') }];
    }
    return gateRuns.map((g, track): SpanStripSpan => {
      const ended = run.gates?.[g.id] ?? null;
      const state = !run.running && ended ? GATE_SPAN_STATE[ended] : red && !again ? 'failed' : stepState(i);
      const fleet = state === 'active' ? run.fleet?.[g.id] ?? null : null;
      const fill = state === 'done' || state === 'failed' ? 1 : fleet && fleet.total > 0 ? Math.min(1, fleet.done / fleet.total) : 0;
      const failed = run.failures?.[g.id] ?? null;
      const said = failed ? failedText(failed) : '';
      return {
        id: `fleet-${g.id}`, start: i, ms: 1, track, state, fill,
        label: state === 'active' ? `${activeGateLabel(g.label, run.gateNodes?.[g.id] ?? null, fleet, fill)}${said ? `${NODE_SEP}${said}` : ''}`
          : waiting && i === at ? `${g.label}${NODE_SEP}waiting`
            : state === 'failed' && said ? `${g.label}${NODE_SEP}${said}` : g.label,
        color: phaseColor(state === 'failed' ? 'conflict' : g.phase),
        ...(failed || fleet ? { title: [
          ...(fleet ? [`${fleet.done.toLocaleString()} of ${fleet.total.toLocaleString()} done`] : []),
          ...(failed ? [...failed.names, ...(failed.files > failed.names.length ? [`and ${failed.files - failed.names.length} more`] : [])] : []),
        ].join('\n') } : {}),
      };
    });
  });
}
