import { describe, expect, it } from 'vitest';
import { BudgetNode } from '../src/index.js';

describe('budget nodes', () => {
  it('caps a child by what its parent has left', () => {
    const run = new BudgetNode('run', 1);
    const a = run.child('a', 0.8);
    const b = run.child('b', 0.8);
    a.reserve(0.5).settle(0.6);
    expect(b.remainingUsd).toBeCloseTo(0.4);
    expect(() => b.reserve(0.5)).toThrow(/budget "run"/);
  });

  it('gives a released reservation back', () => {
    const node = new BudgetNode('run', 1);
    node.reserve(0.9).release();
    expect(node.remainingUsd).toBe(1);
  });

  it('settles a reservation only once', () => {
    const node = new BudgetNode('run', 1);
    const r = node.reserve(0.5);
    r.settle(0.2);
    r.settle(0.2);
    expect(node.spentUsd).toBeCloseTo(0.2);
  });
});
