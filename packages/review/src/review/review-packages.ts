import { type CodeAgent, defineCodeAgent } from '@pkgwarden/engine';
import { PackageTarget, PackageVerdict, targetLabel } from '@pkgwarden/contracts';
import { z } from 'zod';

const CONCURRENCY = 4;

/** Input of the root agent: up to 100 package changes. */
export const ReviewSetInput = z.object({ targets: z.array(PackageTarget).min(1).max(100) });
/** Output of the root agent: one verdict per target, in the same order. */
export const ReviewSetOutput = z.object({ verdicts: z.array(PackageVerdict) });

/**
 * The root agent. Reviews every target, four at a time. A review that did not finish becomes
 * an `undecided` verdict with its reason, so one failure never hides the others.
 */
export const reviewPackages: CodeAgent<typeof ReviewSetInput, typeof ReviewSetOutput> = defineCodeAgent({
  def: {
    id: 'review-packages',
    version: '1',
    description: 'Reviews every package change in a set, four at a time.',
    agents: ['review-package'],
    budget: { maxSteps: 1, maxUsd: 10, timeoutMs: 900_000 },
  },
  input: ReviewSetInput,
  output: ReviewSetOutput,
  async run(input, ctx) {
    const verdicts: PackageVerdict[] = new Array(input.targets.length);
    let next = 0;
    const worker = async () => {
      while (next < input.targets.length) {
        const i = next++;
        const target = input.targets[i] as PackageTarget;
        const outcome = await ctx.runAgent<PackageVerdict>('review-package', target, targetLabel(target));
        if (outcome.status === 'done') {
          verdicts[i] = outcome.output;
          continue;
        }
        const failed: PackageVerdict = {
          name: target.name,
          to: target.to ?? 'latest',
          ...(target.from ? { from: target.from } : {}),
          verdict: 'undecided',
          reasons: [`the review did not finish (${outcome.status})${outcome.error ? `: ${outcome.error}` : ''}`],
          checks: [],
          judges: [],
        };
        verdicts[i] = failed;
        ctx.emit({ type: 'verdict', result: failed });
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, input.targets.length) }, worker));
    return { verdicts };
  },
});
