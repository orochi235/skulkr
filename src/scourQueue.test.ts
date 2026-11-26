import { describe, expect, it } from 'vitest';
import { scourQueueOf } from './scourQueue.mjs';

describe('scourQueueOf', () => {
  it('orders by next-defect price, ties as given, leaving out stopped and held areas', () => {
    const candidates = [
      { id: 'a', usd: 0.4, stopped: null },
      { id: 'b', usd: 0.2, stopped: null },
      { id: 'c', usd: 0.4, stopped: null },
      { id: 'd', usd: 0.1, stopped: 'ready to fix' },
      { id: 'e', usd: 0.3, stopped: null },
    ];
    expect(scourQueueOf(candidates, (id) => id === 'e').map((c) => c.id)).toEqual(['b', 'a', 'c']);
  });
});
