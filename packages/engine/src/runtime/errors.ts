/** A reservation did not fit in the budget of `scope` or one of its parents. */
export class BudgetExceededError extends Error {
  readonly scope: string;
  readonly neededUsd: number;
  readonly remainingUsd: number;

  constructor(scope: string, neededUsd: number, remainingUsd: number) {
    super(`budget "${scope}" has $${remainingUsd.toFixed(4)} left, needed $${neededUsd.toFixed(4)}`);
    this.name = 'BudgetExceededError';
    this.scope = scope;
    this.neededUsd = neededUsd;
    this.remainingUsd = remainingUsd;
  }
}

/** An agent asked for a tool or sub-agent it did not declare. */
export class ToolRefusedError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ToolRefusedError';
  }
}

/** An agent went over its step limit. */
export class StepLimitError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'StepLimitError';
  }
}

/** A run asked for a limit above the ceiling the engine was configured with. Nothing ran. */
export class LimitRefusal extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'LimitRefusal';
  }
}

/** The model declined the request (`stop_reason: "refusal"`), including after any server-side fallback. */
export class ModelRefusalError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ModelRefusalError';
  }
}

/** The model's answer failed the schema twice, or was cut off. */
export class InvalidModelOutputError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'InvalidModelOutputError';
  }
}

/** Thrown by a ModelClient. `retryable` decides whether the engine moves on to the next model. */
export class ModelCallError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ModelCallError';
    this.retryable = retryable;
  }
}

/** The message of anything thrown. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
