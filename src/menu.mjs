/**
 * The menu bar item's wording (`skulkr menu`, laid out by `menubar/menubar.yaml`): each tenant's status as the service
 * answers `onto call`, worded here so the menu bar file only places lines and cannot disagree with the dashboard.
 */
import { execFileSync } from 'node:child_process';
import { readTenants } from './tenants.mjs';

/** The service `onto call` asks: `SKULKR_SERVICE`, else `skulkr`. */
export const serviceName = (env = process.env) => env.SKULKR_SERVICE ?? 'skulkr';

/** Where the dashboard serves: `SKULKR_DASHBOARD_URL`, else as `emilia up` starts it (`DEV_PORT` in `dashboard/vite.config.ts`). */
export const dashboardUrl = (env = process.env) => env.SKULKR_DASHBOARD_URL ?? 'http://localhost:5214/';

const money = (usd) => `$${(usd ?? 0).toFixed(2)}`;
const clock = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

/** One live round's line: `weasel · round 65 · review · $50.45 of $160 · 16 areas`. */
const runText = (tenant, run) =>
  `${tenant} · round ${run.round} · ${run.step} · ${money(run.costUsd)} of $${run.capUsd} · ${run.areas?.length ?? 0} areas`;

/** A finished round's verdict, the first word of its report (`green`, `red`, …), or `ended` without one. */
const verdictOf = (report) => /^(\w+)/.exec(report ?? '')?.[1] ?? 'ended';

/**
 * The menu from `answers`, one per tenant: `{ tenant, status }`, `status` the service's reply or null when it gave
 * none. Answers `{ title, live, rows, last, problems, dashboard }`; `live` counts the rounds running, `rows` are one
 * per live round with its last log line under it, `last` one per tenant's last finished round.
 */
export const menuOf = (answers, now = Date.now(), dashboard = dashboardUrl()) => {
  const rows = [];
  const last = [];
  const problems = [];
  for (const { tenant, status } of answers) {
    if (!status) {
      problems.push(`${tenant}: the skulkr service did not answer`);
      continue;
    }
    for (const run of status.runs ?? []) {
      rows.push({ text: runText(tenant, run), detail: run.lastLine ?? '', started: `started ${clock(run.started)}` });
    }
    if (status.last?.round !== undefined) {
      const ended = status.last.ended ? ` · ended ${clock(status.last.ended)}` : '';
      last.push({ text: `${tenant} · round ${status.last.round} · ${verdictOf(status.last.report)} · ${money(status.last.costUsd)}${ended}`, report: status.last.report ?? '' });
    }
  }
  const live = rows.length;
  const title = live ? `${live} round${live === 1 ? '' : 's'} running` : 'No round running';
  return { title, live, rows, last, problems, dashboard, at: new Date(now).toISOString() };
};

/** The service's status for `tenant`, or null when `onto call` fails or does not answer in time. */
const statusOf = (tenant) => {
  try {
    const out = execFileSync('onto', ['call', serviceName(), JSON.stringify({ id: 1, status: true, tenant })],
      { encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'ignore'] });
    const reply = JSON.parse(out);
    return reply.error ? null : reply;
  } catch {
    return null;
  }
};

/** `skulkr menu`: the menu for every registered tenant, as one line of JSON. */
export const menuCommand = () => menuOf(readTenants().map(({ name }) => ({ tenant: name, status: statusOf(name) })));
