import { describe, expect, it } from 'vitest';
import { menuOf } from './menu.mjs';

const live = {
  round: 65, step: 'review', costUsd: 50.45, capUsd: 160, areas: Array(16).fill('a'), started: '2026-11-21T13:23:12Z',
  lastLine: 'fix 1/16 diagram-formats.drawXml on teitou: 8 commits',
};
const last = { round: 64, report: 'red: batch kept', costUsd: 128.96, ended: '2026-11-21T12:00:00Z' };

describe('menuOf', () => {
  it('words a live round, its last log line, and the last finished round per tenant', () => {
    const menu = menuOf([{ tenant: 'weasel', status: { runs: [live], last } }]);
    expect(menu).toMatchObject({ title: '1 round running', live: 1, problems: [], dashboard: 'http://localhost:5214/' });
    expect(menu.rows).toEqual([{ text: 'weasel · round 65 · review · $50.45 of $160 · 16 areas', detail: live.lastLine, started: expect.stringMatching(/^started /) }]);
    expect(menu.last[0]!.text).toMatch(/^weasel · round 64 · red · \$128\.96 · ended /);
  });

  it('says nothing runs, and names a tenant whose service gave no answer', () => {
    const menu = menuOf([{ tenant: 'weasel', status: { runs: [], last } }, { tenant: 'other', status: null }]);
    expect(menu).toMatchObject({ title: 'No round running', live: 0, rows: [], problems: ['other: the skulkr service did not answer'] });
  });
});
