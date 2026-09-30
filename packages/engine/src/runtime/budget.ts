import { BudgetExceededError } from './errors.js';

const EPSILON = 1e-9;

/** Money set aside for one call, settled to the real cost afterwards. */
export interface Reservation {
  /** Replace the reservation with what the call really cost. */
  settle(actualUsd: number): void;
  /** Give the reservation back, for example when the call failed before any tokens were billed. */
  release(): void;
}

/**
 * Budgets nest: run → package review → agent. A reservation has to fit in every level
 * above it, so a child can never spend more than its parent has left.
 */
export class BudgetNode {
  readonly scope: string;
  readonly limitUsd: number;
  readonly #parent: BudgetNode | undefined;
  #spent = 0;
  #reserved = 0;

  constructor(scope: string, limitUsd: number, parent?: BudgetNode) {
    this.scope = scope;
    this.limitUsd = limitUsd;
    this.#parent = parent;
  }

  /** A child budget, capped by its own limit and by whatever this node has left. */
  child(scope: string, limitUsd: number): BudgetNode {
    return new BudgetNode(scope, limitUsd, this);
  }

  /** What has been settled in this node and its children. */
  get spentUsd(): number {
    return this.#spent;
  }

  /** What this node could still reserve, taking every ancestor into account. */
  get remainingUsd(): number {
    const own = this.limitUsd - this.#spent - this.#reserved;
    return this.#parent ? Math.min(own, this.#parent.remainingUsd) : own;
  }

  /** Reserves `usd` in this node and every ancestor. Refuses with BudgetExceededError if any of them cannot fit it. */
  reserve(usd: number): Reservation {
    this.#walk(n => {
      const own = n.limitUsd - n.#spent - n.#reserved;
      if (usd > own + EPSILON) throw new BudgetExceededError(n.scope, usd, Math.max(0, own));
    });
    this.#walk(n => {
      n.#reserved += usd;
    });
    let open = true;
    return {
      settle: (actualUsd: number) => {
        if (!open) return;
        open = false;
        this.#walk(n => {
          n.#reserved -= usd;
          n.#spent += actualUsd;
        });
      },
      release: () => {
        if (!open) return;
        open = false;
        this.#walk(n => {
          n.#reserved -= usd;
        });
      },
    };
  }

  /** Calls `fn` on this node, then on each ancestor up to the run. */
  #walk(fn: (node: BudgetNode) => void): void {
    fn(this);
    if (this.#parent) this.#parent.#walk(fn);
  }
}
