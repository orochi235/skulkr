/**
 * The run's heartbeat: while its jobs run, a line for each now and then, from the runner's own record of them, so a
 * fixer twenty minutes into its checks is not silence between its matcher's line and its own.
 */

/** How often the jobs are looked at, and how long a job that has not moved goes before its line is printed anyway. */
export const HEARTBEAT_MS = 120_000;
export const QUIET_MS = 600_000;

const UNIT = { fix: 'commits', repair: 'commits', A: 'files', B: 'files' };

/** A counter of `checks` or `tests` as words: `checks 6/7, 2 failing`, a test count as the tests run. */
const counterText = (name, c) => {
  if (!c) return '';
  const count = name === 'tests' ? `${c.total}` : `${c.done}/${c.total}`;
  return `${name} ${count}${c.failed ? `, ${c.failed} failing` : ''}`;
};

/** How much of a job's latest note its heartbeat line keeps: a fixer's `says:` notes run longer than the log needs. */
const NOW_CHARS = 100;

/**
 * What a running job's heartbeat says of it, without its minutes so a job whose line has not changed can be told
 * from one that has: its count, in its role's unit, its checks and tests where it counts them, and its latest note.
 */
export const jobStateOf = (job, label) => {
  const p = job.progress ?? {};
  const step = label.slice(label.lastIndexOf('-') + 1);
  return [
    Number.isFinite(p.total) ? `${UNIT[step] ?? 'done'} ${p.done}/${p.total}` : '',
    counterText('checks', p.checks),
    counterText('tests', p.tests),
    p.now ? `now: ${p.now.text.length > NOW_CHARS ? `${p.now.text.slice(0, NOW_CHARS - 1)}…` : p.now.text}` : '',
  ].filter(Boolean).join(' · ');
};

/**
 * Starts the heartbeat. `jobs()` answers the runner's jobs, `progress()` the running ones' progress by task (where the
 * job records do not carry it), `prefix` this round's task prefix, and `say` prints. Each job's line is printed when
 * it changes, or once it has gone `quietMs` unchanged. Answers the function that stops it.
 */
export const startHeartbeat = ({ jobs, progress = () => new Map(), prefix, say, everyMs = HEARTBEAT_MS, quietMs = QUIET_MS, now = Date.now }) => {
  const last = new Map();
  const tick = () => {
    let listed;
    let counts;
    try {
      listed = jobs().filter((j) => j.state === 'running' && j.task?.startsWith(prefix));
      counts = progress();
    } catch {
      return;
    }
    const t = now();
    for (const job of listed) {
      const label = job.task.slice(prefix.length);
      const state = jobStateOf({ ...job, progress: job.progress ?? counts.get(job.task) }, label);
      const was = last.get(job.task);
      if (was && was.state === state && t - was.at < quietMs) continue;
      last.set(job.task, { state, at: t });
      const minutes = Math.round((t - Date.parse(job.started)) / 60_000);
      say(`job ${label} on ${job.node} · ${minutes} min${state ? ` · ${state}` : ''}`);
    }
    for (const task of last.keys()) if (!listed.some((j) => j.task === task)) last.delete(task);
  };
  const timer = setInterval(tick, everyMs);
  timer.unref?.();
  return () => clearInterval(timer);
};
