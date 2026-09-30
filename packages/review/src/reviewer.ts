import { type AnyAgent, type AnyTool, Engine, type ModelTiers, type Store } from '@pkgwarden/engine';
import type { HttpClient } from './http/client.js';
import { diffConfirm, diffJudge } from './judges/diff-judge.js';
import { maintenanceJudge } from './judges/maintenance-judge.js';
import { reviewPackage } from './review/review-package.js';
import { reviewPackages } from './review/review-packages.js';
import { advisoryTools } from './sources/advisories.js';
import { githubTools } from './sources/github.js';
import { npmTools } from './sources/npm.js';

/** Every tool the reviewer's agents may use, all reading through `http`. */
export function reviewTools(http: HttpClient): AnyTool[] {
  return [...npmTools(http), ...advisoryTools(http), ...githubTools(http)];
}

/** Every agent in the reviewer. */
export const REVIEW_AGENTS: readonly AnyAgent[] = [
  reviewPackages,
  reviewPackage,
  diffJudge,
  diffConfirm,
  maintenanceJudge,
];

/** The agent to run: it takes `{ targets }` and returns `{ verdicts }`. */
export const ROOT_AGENT = 'review-packages';

/** The default and ceiling for one run's spend, in USD. */
export const DEFAULT_BUDGET_USD = 0.5;

/** What a reviewer needs. Leave `models` out for rules-only mode. */
export interface ReviewerOptions {
  readonly http: HttpClient;
  readonly store: Store;
  readonly models?: ModelTiers | undefined;
  /** Ceiling for any one run. Defaults to DEFAULT_BUDGET_USD. */
  readonly budgetUsd?: number | undefined;
  readonly clock?: (() => Date) | undefined;
}

/** Builds the npm reviewer: the engine with every review tool and agent registered and checked. */
export function createReviewer(options: ReviewerOptions): Engine {
  return new Engine({
    tools: reviewTools(options.http),
    agents: REVIEW_AGENTS,
    models: options.models,
    store: options.store,
    budgetUsd: options.budgetUsd ?? DEFAULT_BUDGET_USD,
    clock: options.clock,
  });
}
