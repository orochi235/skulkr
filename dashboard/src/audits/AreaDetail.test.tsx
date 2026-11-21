import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AreaDetail } from './AreaDetail';
import type { AuditArea } from './skulkrMap.types';

afterEach(cleanup);

const area: AuditArea = {
  id: 'theme.engine', group: 'theme', files: 29, status: 'due', queue: null, passes: [], stage: null,
  openFindings: 2,
  open: [
    { round: 56, claim: 'An offset rule with a fractional offset throws', where: 'packages/theme/src/engine/ramps.ts:40' },
    { round: 57, claim: 'A gray anchor drags its hue', where: 'packages/theme/src/engine/color/generate.ts:88' },
  ],
};

describe('AreaDetail', () => {
  it('counts the open findings and lists each with the round that reported it', () => {
    render(<AreaDetail area={area} holder={undefined} />);
    const items = screen.getByRole('list', { name: 'open findings' }).querySelectorAll('li');
    expect([...items].map((li) => li.textContent)).toEqual(['r56 An offset rule with a fractional offset throws', 'r57 A gray anchor drags its hue']);
    expect(items[0]!.getAttribute('title')).toBe('packages/theme/src/engine/ramps.ts:40');
  });

  it('shows no list for an area with none open', () => {
    const { openFindings: _count, open: _list, ...bare } = area;
    render(<AreaDetail area={bare} holder={undefined} />);
    expect(screen.queryByRole('list', { name: 'open findings' })).toBeNull();
  });
});
